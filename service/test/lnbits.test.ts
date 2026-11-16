import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.ts";
import { createLightningProviders } from "../src/infrastructure/providers/index.ts";
import { LnbitsLightningProvider } from "../src/infrastructure/providers/lnbits-lightning-provider.ts";
import { testConfig } from "./helpers.ts";

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

describe("LNbits live provider", () => {
  it("creates a whole-sat invoice through the LNbits API", async () => {
    const { calls, fetchImpl } = fakeFetch([
      json({ payment_hash: paymentHash, payment_request: "lnbc1test", checking_id: "check_1" })
    ]);
    const provider = new LnbitsLightningProvider({
      baseUrl: "https://lnbits.test/",
      apiKey: "api-key-value",
      fetchImpl,
      now: () => new Date("2026-11-14T00:00:00Z")
    });
    const invoice = await provider.createInvoice({
      amountMsat: 21_000n,
      memo: "Order 1",
      expirySeconds: 900
    });
    assert.equal(invoice.providerReference, paymentHash);
    assert.equal(invoice.paymentHash, paymentHash);
    assert.equal(invoice.bolt11, "lnbc1test");
    assert.equal(invoice.amountMsat, 21_000n);
    assert.equal(calls[0]!.url, "https://lnbits.test/api/v1/payments");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("x-api-key"), "api-key-value");
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
      out: false,
      amount: 21,
      unit: "sat",
      memo: "Order 1",
      expiry: 900
    });
  });

  it("rejects fractional-sat amounts before calling the provider", async () => {
    const { calls, fetchImpl } = fakeFetch([]);
    const provider = new LnbitsLightningProvider({
      baseUrl: "https://lnbits.test",
      apiKey: "api-key-value",
      fetchImpl
    });
    await assert.rejects(
      provider.createInvoice({ amountMsat: 1_500n, memo: "x", expirySeconds: 60 }),
      /whole-sat/
    );
    assert.equal(calls.length, 0);
  });

  it("accepts a paid LNbits proof in msat or sats", async () => {
    for (const amount of [1_000, 1]) {
      const { fetchImpl } = fakeFetch([
        json({ paid: true, details: { payment_hash: paymentHash, amount } })
      ]);
      const provider = new LnbitsLightningProvider({
        baseUrl: "https://lnbits.test",
        apiKey: "api-key-value",
        fetchImpl,
        now: () => new Date("2026-11-14T00:00:00Z")
      });
      const proof = await provider.verifyProof({
        providerReference: paymentHash,
        paymentHash,
        amountMsat: 1_000n
      });
      assert.equal(proof.paymentHash, paymentHash);
      assert.equal(proof.amountMsat, 1_000n);
      assert.equal(proof.providerReference, paymentHash);
      assert.equal(proof.providerEventId, `lnbits_${paymentHash}`);
    }
  });

  it("rejects unpaid, mismatched or unknown payments", async () => {
    const unpaid = new LnbitsLightningProvider({
      baseUrl: "https://lnbits.test",
      apiKey: "api-key-value",
      fetchImpl: fakeFetch([json({ paid: false, details: { pending: true } })]).fetchImpl
    });
    await assert.rejects(
      unpaid.verifyProof({ providerReference: "check_1", paymentHash, amountMsat: 1_000n }),
      /pending/
    );

    const mismatch = new LnbitsLightningProvider({
      baseUrl: "https://lnbits.test",
      apiKey: "api-key-value",
      fetchImpl: fakeFetch([
        json({ paid: true, details: { payment_hash: paymentHash, amount: 2_000 } })
      ]).fetchImpl
    });
    await assert.rejects(
      mismatch.verifyProof({ providerReference: paymentHash, paymentHash, amountMsat: 1_000n }),
      /amount/
    );

    const unknown = new LnbitsLightningProvider({
      baseUrl: "https://lnbits.test",
      apiKey: "api-key-value",
      fetchImpl: fakeFetch([json({ detail: "not found" }, 404)]).fetchImpl
    });
    await assert.rejects(
      unknown.verifyProof({ providerReference: paymentHash, paymentHash, amountMsat: 1_000n }),
      /unknown/
    );
  });

  it("fails closed without an explicit live configuration", () => {
    assert.throws(
      () => loadConfig({ ...testConfig(), liveEnabled: true }),
      /PAY_LIVE_ENABLED requires/
    );
    assert.throws(
      () => loadConfig({ ...testConfig(), lightningProvider: "lnbits", liveEnabled: false }),
      /requires PAY_LIVE_ENABLED/
    );
    assert.throws(
      () =>
        loadConfig({
          ...testConfig(),
          lightningProvider: "lnbits",
          liveEnabled: true,
          lnbitsUrl: null,
          lnbitsApiKey: null,
          lnbitsWebhookSecret: null
        }),
      /required for live/
    );
  });

  it("requires live provider configuration for live console modes", () => {
    assert.throws(
      () => loadConfig({ ...testConfig(), consoleMode: "live", liveEnabled: false }),
      /PAY_CONSOLE_MODE=live or both requires PAY_LIVE_ENABLED=1/
    );
    assert.throws(
      () => loadConfig({ ...testConfig(), consoleMode: "both", liveEnabled: false }),
      /PAY_CONSOLE_MODE=live or both requires PAY_LIVE_ENABLED=1/
    );
  });

  it("selects a live provider only for an explicit LNbits configuration", () => {
    const mock = createLightningProviders(testConfig());
    assert.equal(mock.live, null);
    assert.equal(mock.sandbox.mode, "sandbox");

    const live = createLightningProviders(
      testConfig({
        lightningProvider: "lnbits",
        liveEnabled: true,
        lnbitsUrl: "https://lnbits.test",
        lnbitsApiKey: "api-key-value",
        lnbitsWebhookSecret: "webhook-secret-value"
      })
    );
    assert.equal(live.live?.name, "lnbits");
    assert.equal(live.live?.mode, "live");
    assert.equal(live.sandbox.mode, "sandbox");
  });
});
