import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import type {
  CreateInvoiceInput,
  LightningProvider,
  ProviderInvoice,
  ProviderProof
} from "../src/application/ports/lightning-provider.ts";
import { loadConfig } from "../src/config.ts";
import { createLightningProviders } from "../src/infrastructure/providers/index.ts";
import { BlinkLightningProvider } from "../src/infrastructure/providers/blink-lightning-provider.ts";
import { StrikeLightningProvider } from "../src/infrastructure/providers/strike-lightning-provider.ts";
import {
  createTestRuntime,
  intentBody,
  testConfig,
  type TestRuntime
} from "./helpers.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function fakeFetch(responses: Array<Response | (() => Response)>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const paymentHash = "a".repeat(64);
const now = () => new Date("2026-11-14T00:00:00Z");

describe("Blink live provider", () => {
  it("creates a whole-sat invoice through the GraphQL API", async () => {
    const { calls, fetchImpl } = fakeFetch([
      json({
        data: {
          lnInvoiceCreate: {
            invoice: {
              paymentRequest: "lnbc1blink",
              paymentHash,
              satoshis: 21
            },
            errors: []
          }
        }
      })
    ]);
    const provider = new BlinkLightningProvider({
      baseUrl: "https://blink.test",
      apiKey: "blink-key",
      walletId: "wallet-id",
      fetchImpl,
      now
    });
    const invoice = await provider.createInvoice({
      amountMsat: 21_000n,
      memo: "Order 1",
      expirySeconds: 900
    });
    assert.equal(invoice.providerReference, paymentHash);
    assert.equal(invoice.paymentHash, paymentHash);
    assert.equal(invoice.bolt11, "lnbc1blink");
    assert.equal(invoice.amountMsat, 21_000n);
    assert.equal(calls[0]!.url, "https://blink.test/graphql");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-api-key"), "blink-key");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body.variables.input, {
      amount: 21,
      expiresIn: 15,
      memo: "Order 1",
      walletId: "wallet-id"
    });
  });

  it("rejects fractional-sat amounts before calling Blink", async () => {
    const { calls, fetchImpl } = fakeFetch([]);
    const provider = new BlinkLightningProvider({
      baseUrl: "https://blink.test",
      apiKey: "blink-key",
      walletId: "wallet-id",
      fetchImpl,
      now
    });
    await assert.rejects(
      provider.createInvoice({ amountMsat: 1_500n, memo: "x", expirySeconds: 60 }),
      /whole-sat/
    );
    assert.equal(calls.length, 0);
  });

  it("maps paid, pending and expired statuses", async () => {
    for (const [status, expected] of [
      ["PAID", "SETTLED"],
      ["PENDING", "PENDING"],
      ["EXPIRED", "CANCELLED"]
    ] as const) {
      const { fetchImpl } = fakeFetch([
        json({
          data: { lnInvoicePaymentStatusByHash: { status, paymentHash } }
        })
      ]);
      const provider = new BlinkLightningProvider({
        baseUrl: "https://blink.test/graphql",
        apiKey: "blink-key",
        walletId: "wallet-id",
        fetchImpl,
        now
      });
      assert.equal(await provider.status({ providerReference: paymentHash }), expected);
    }
  });

  it("returns a proof only for a paid invoice", async () => {
    const paid = new BlinkLightningProvider({
      baseUrl: "https://blink.test",
      apiKey: "blink-key",
      walletId: "wallet-id",
      fetchImpl: fakeFetch([
        json({ data: { lnInvoicePaymentStatusByHash: { status: "PAID", paymentHash } } })
      ]).fetchImpl,
      now
    });
    const proof = await paid.verifyProof({
      providerReference: paymentHash,
      paymentHash,
      amountMsat: 1_000n
    });
    assert.equal(proof.providerEventId, `blink_${paymentHash}`);
    assert.equal(proof.amountMsat, 1_000n);

    const pending = new BlinkLightningProvider({
      baseUrl: "https://blink.test",
      apiKey: "blink-key",
      walletId: "wallet-id",
      fetchImpl: fakeFetch([
        json({ data: { lnInvoicePaymentStatusByHash: { status: "PENDING", paymentHash } } })
      ]).fetchImpl,
      now
    });
    await assert.rejects(
      pending.verifyProof({
        providerReference: paymentHash,
        paymentHash,
        amountMsat: 1_000n
      }),
      /pending/
    );
  });

  it("uses the Blink receive time as the proof time", async () => {
    const paidAtSeconds = Math.floor(now().getTime() / 1000) - 60;
    const { calls, fetchImpl } = fakeFetch([
      json({ data: { lnInvoicePaymentStatusByHash: { status: "PAID", paymentHash } } }),
      json({
        data: {
          me: {
            defaultAccount: {
              walletById: {
                transactionsByPaymentHash: [
                  {
                    createdAt: paidAtSeconds,
                    direction: "RECEIVE",
                    status: "SUCCESS"
                  }
                ]
              }
            }
          }
        }
      })
    ]);
    const provider = new BlinkLightningProvider({
      baseUrl: "https://blink.test",
      apiKey: "blink-key",
      walletId: "wallet-id",
      fetchImpl,
      now
    });
    const proof = await provider.verifyProof({
      providerReference: paymentHash,
      paymentHash,
      amountMsat: 1_000n
    });
    assert.equal(proof.occurredAt.toISOString(), new Date(paidAtSeconds * 1000).toISOString());
    assert.equal(calls.length, 2);
    const body = JSON.parse(String(calls[1]!.init.body));
    assert.equal(body.variables.walletId, "wallet-id");
    assert.equal(body.variables.paymentHash, paymentHash);
  });

  it("cancels an invoice when Blink confirms success", async () => {
    const { fetchImpl } = fakeFetch([
      json({ data: { lnInvoiceCancel: { success: true, errors: [] } } })
    ]);
    const provider = new BlinkLightningProvider({
      baseUrl: "https://blink.test",
      apiKey: "blink-key",
      walletId: "wallet-id",
      fetchImpl,
      now
    });
    assert.equal(await provider.cancelInvoice({ providerReference: paymentHash }), true);
  });
});

describe("Strike live provider", () => {
  it("creates a BTC receive request and keeps the payment hash", async () => {
    const { calls, fetchImpl } = fakeFetch([
      json({
        receiveRequestId: "rr_1",
        targetCurrency: "BTC",
        bolt11: {
          invoice: "lnbc1strike",
          paymentHash,
          expires: "2026-11-14T00:15:00Z"
        }
      })
    ]);
    const provider = new StrikeLightningProvider({
      baseUrl: "https://strike.test/v1/",
      apiKey: "strike-key",
      fetchImpl,
      now
    });
    const invoice = await provider.createInvoice({
      amountMsat: 21_000n,
      memo: "Order 1",
      expirySeconds: 900
    });
    assert.equal(invoice.providerReference, "rr_1");
    assert.equal(invoice.paymentHash, paymentHash);
    assert.equal(invoice.bolt11, "lnbc1strike");
    assert.equal(calls[0]!.url, "https://strike.test/v1/receive-requests");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("authorization"), "Bearer strike-key");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      bolt11: {
        amount: { amount: "0.00000021", currency: "BTC" },
        description: "Order 1",
        expiryInSeconds: 900
      },
      targetCurrency: "BTC"
    });
  });

  it("rejects fractional-sat amounts before calling Strike", async () => {
    const { calls, fetchImpl } = fakeFetch([]);
    const provider = new StrikeLightningProvider({
      baseUrl: "https://strike.test/v1",
      apiKey: "strike-key",
      fetchImpl,
      now
    });
    await assert.rejects(
      provider.createInvoice({ amountMsat: 1_500n, memo: "x", expirySeconds: 60 }),
      /whole-sat/
    );
    assert.equal(calls.length, 0);
  });

  it("verifies a completed receive and rejects a mismatched amount", async () => {
    const completed = new StrikeLightningProvider({
      baseUrl: "https://strike.test/v1",
      apiKey: "strike-key",
      fetchImpl: fakeFetch([
        json({
          items: [
            {
              receiveId: "rcv_1",
              state: "COMPLETED",
              amountReceived: { amount: "0.00000021", currency: "BTC" },
              lightning: { paymentHash }
            }
          ]
        })
      ]).fetchImpl,
      now
    });
    const proof = await completed.verifyProof({
      providerReference: "rr_1",
      paymentHash,
      amountMsat: 21_000n
    });
    assert.equal(proof.providerEventId, "strike_rcv_1");
    assert.equal(proof.amountMsat, 21_000n);

    const mismatch = new StrikeLightningProvider({
      baseUrl: "https://strike.test/v1",
      apiKey: "strike-key",
      fetchImpl: fakeFetch([
        json({
          items: [
            {
              receiveId: "rcv_1",
              state: "COMPLETED",
              amountReceived: { amount: "0.00000022", currency: "BTC" },
              lightning: { paymentHash }
            }
          ]
        })
      ]).fetchImpl,
      now
    });
    await assert.rejects(
      mismatch.verifyProof({
        providerReference: "rr_1",
        paymentHash,
        amountMsat: 21_000n
      }),
      /amount/
    );
  });

  it("resolves a receive request reference to a payment hash", async () => {
    const { fetchImpl } = fakeFetch([
      json({ receiveRequestId: "rr_1", bolt11: { paymentHash } })
    ]);
    const provider = new StrikeLightningProvider({
      baseUrl: "https://strike.test/v1",
      apiKey: "strike-key",
      fetchImpl,
      now
    });
    assert.equal(
      await provider.resolvePaymentHash({ providerReference: "rr_1" }),
      paymentHash
    );
  });

  it("does not claim that Strike cancelled an invoice", async () => {
    const provider = new StrikeLightningProvider({
      baseUrl: "https://strike.test/v1",
      apiKey: "strike-key",
      fetchImpl: fakeFetch([]).fetchImpl,
      now
    });
    assert.equal(await provider.cancelInvoice(), false);
  });
});

describe("live provider configuration", () => {
  it("requires complete Blink and Strike live settings", () => {
    assert.throws(
      () =>
        loadConfig({
          ...testConfig(),
          lightningProvider: "blink",
          liveEnabled: true,
          blinkApiKey: null,
          blinkWalletId: null,
          blinkWebhookSecret: null
        }),
      /PAY_BLINK_API_KEY/
    );
    assert.throws(
      () =>
        loadConfig({
          ...testConfig(),
          lightningProvider: "strike",
          liveEnabled: true,
          strikeApiKey: null,
          strikeWebhookSecret: null
        }),
      /PAY_STRIKE_API_KEY/
    );
    assert.throws(
      () => loadConfig({ ...testConfig(), lightningProvider: "mock", liveEnabled: true }),
      /non-mock/
    );
  });

  it("selects Blink and Strike adapters only when configured", () => {
    const blink = createLightningProviders(
      testConfig({
        lightningProvider: "blink",
        liveEnabled: true,
        blinkApiKey: "blink-key",
        blinkWalletId: "wallet-id",
        blinkWebhookSecret: "blink-webhook-secret"
      })
    );
    assert.equal(blink.live?.name, "blink");

    const strike = createLightningProviders(
      testConfig({
        lightningProvider: "strike",
        liveEnabled: true,
        strikeApiKey: "strike-key",
        strikeWebhookSecret: "strike-webhook-secret"
      })
    );
    assert.equal(strike.live?.name, "strike");
  });
});

class WebhookProvider implements LightningProvider {
  readonly name: "blink" | "strike";
  readonly mode = "live" as const;
  private readonly reference: string;
  private readonly hash: string;

  constructor(name: "blink" | "strike", reference: string, hash: string) {
    this.name = name;
    this.reference = reference;
    this.hash = hash;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    return {
      providerReference: this.reference,
      paymentHash: this.hash,
      bolt11: `lnbc${input.amountMsat}1test`,
      amountMsat: input.amountMsat,
      expiresAt: new Date(Date.now() + input.expirySeconds * 1000)
    };
  }

  async verifyProof(input: {
    providerReference: string;
    paymentHash: string;
    amountMsat: bigint;
  }): Promise<ProviderProof> {
    assert.equal(input.paymentHash, this.hash);
    return {
      providerEventId: `${this.name}_${this.hash}`,
      providerReference: input.providerReference,
      paymentHash: input.paymentHash,
      amountMsat: input.amountMsat,
      occurredAt: new Date()
    };
  }

  async cancelInvoice(): Promise<boolean> {
    return true;
  }

  async status(): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN"> {
    return "SETTLED";
  }

  async resolvePaymentHash(input: { providerReference: string }): Promise<string> {
    assert.equal(input.providerReference, this.reference);
    return this.hash;
  }
}

function blinkSignature(secret: string, id: string, timestamp: string, raw: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64")}`;
}

function strikeSignature(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

describe("provider webhooks", () => {
  let runtime: TestRuntime;
  let app: FastifyInstance;
  let apiKey: string;
  const hash = "c".repeat(64);
  const blinkSecret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
  const strikeSecret = "strike-webhook-secret";

  before(async () => {
    runtime = await createTestRuntime(
      {
        lightningProvider: "blink",
        liveEnabled: true,
        blinkApiKey: "blink-key",
        blinkWalletId: "wallet-id",
        blinkWebhookSecret: blinkSecret
      },
      { liveProvider: new WebhookProvider("blink", hash, hash) }
    );
    app = await createApp(runtime.dependencies, { logger: false });
  });

  after(async () => {
    await app.close();
    await runtime.close();
  });

  async function createLiveIntent(reference: string): Promise<string> {
    const merchant = await runtime.services.provisioning.bootstrapMerchant({
      organizationName: "Webhook Org",
      merchantName: "Webhook Shop",
      livemode: true
    });
    apiKey = merchant.apiKey;
    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": reference
      },
      payload: intentBody({ external_reference: reference })
    });
    assert.equal(created.statusCode, 201, created.body);
    return created.json().payment.payment_hash as string;
  }

  it("rejects a Blink webhook with a bad Svix signature", async () => {
    const raw = JSON.stringify({
      eventType: "receive.lightning",
      transaction: { initiationVia: { paymentHash: hash } }
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/providers/blink/webhook",
      headers: {
        "content-type": "application/json",
        "svix-id": "msg_1",
        "svix-timestamp": String(Math.floor(Date.now() / 1000)),
        "svix-signature": "v1,invalid"
      },
      payload: raw
    });
    assert.equal(response.statusCode, 401);
  });

  it("settles a Blink payment from a signed Svix webhook", async () => {
    const intentHash = await createLiveIntent("BLINK-1-0001");
    const raw = JSON.stringify({
      eventType: "receive.lightning",
      transaction: { initiationVia: { paymentHash: intentHash } }
    });
    const id = "msg_blink_1";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await app.inject({
      method: "POST",
      url: "/v1/providers/blink/webhook",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": blinkSignature(blinkSecret, id, timestamp, raw)
      },
      payload: raw
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { object: "provider_ack", status: "SETTLED" });
  });

  it("settles a Strike payment after resolving the receive request reference", async () => {
    const strikeRuntime = await createTestRuntime(
      {
        lightningProvider: "strike",
        liveEnabled: true,
        strikeApiKey: "strike-key",
        strikeWebhookSecret: strikeSecret
      },
      { liveProvider: new WebhookProvider("strike", "rr_1", hash) }
    );
    const strikeApp = await createApp(strikeRuntime.dependencies, { logger: false });
    try {
      const merchant = await strikeRuntime.services.provisioning.bootstrapMerchant({
        organizationName: "Strike Org",
        merchantName: "Strike Shop",
        livemode: true
      });
      const created = await strikeApp.inject({
        method: "POST",
        url: "/v1/payment-intents",
        headers: {
          authorization: `Bearer ${merchant.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": "STRIKE-1"
        },
        payload: intentBody({ external_reference: "STRIKE-1" })
      });
      assert.equal(created.statusCode, 201);

      const raw = JSON.stringify({
        eventType: "receive-request.receive-completed",
        data: { entityId: "rr_1" }
      });
      const rejected = await strikeApp.inject({
        method: "POST",
        url: "/v1/providers/strike/webhook",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": "bad-signature"
        },
        payload: raw
      });
      assert.equal(rejected.statusCode, 401);

      const response = await strikeApp.inject({
        method: "POST",
        url: "/v1/providers/strike/webhook",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": strikeSignature(strikeSecret, raw)
        },
        payload: raw
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { object: "provider_ack", status: "SETTLED" });

      const read = await strikeApp.inject({
        method: "GET",
        url: `/v1/payment-intents/${created.json().id}`,
        headers: { authorization: `Bearer ${merchant.apiKey}` }
      });
      assert.equal(read.json().status, "SUCCEEDED");
    } finally {
      await strikeApp.close();
      await strikeRuntime.close();
    }
  });
});
