import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import type {
  CreateInvoiceInput,
  LightningProvider,
  ProviderInvoice,
  ProviderProof
} from "../src/application/ports/lightning-provider.ts";
import type { CreateIntentInput } from "../src/application/payment-intent-service.ts";
import { createTestRuntime, intentBody, type TestRuntime } from "./helpers.ts";

class LiveTestProvider implements LightningProvider {
  readonly name = "lnbits";
  readonly mode = "live" as const;
  private invoices = new Map<string, ProviderInvoice>();

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const paymentHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
    const invoice = {
      providerReference: `check_${paymentHash.slice(0, 12)}`,
      paymentHash,
      bolt11: `lnbc${input.amountMsat}1test`,
      amountMsat: input.amountMsat,
      expiresAt: new Date(Date.now() + input.expirySeconds * 1000)
    };
    this.invoices.set(paymentHash, invoice);
    return invoice;
  }

  async verifyProof(input: {
    providerReference: string;
    paymentHash: string;
    amountMsat: bigint;
  }): Promise<ProviderProof> {
    const invoice = this.invoices.get(input.paymentHash);
    if (!invoice) throw new Error("unknown live invoice");
    assert.equal(invoice.amountMsat, input.amountMsat);
    return {
      providerEventId: `live_evt_${input.paymentHash}`,
      providerReference: invoice.providerReference,
      paymentHash: input.paymentHash,
      amountMsat: invoice.amountMsat,
      occurredAt: new Date()
    };
  }

  async cancelInvoice(): Promise<boolean> {
    return true;
  }

  async status(): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN"> {
    return "PENDING";
  }
}

describe("live provider settlement", () => {
  let runtime: TestRuntime;
  let app: FastifyInstance;
  const secret = "webhook-secret-value";

  before(async () => {
    runtime = await createTestRuntime(
      {
        lightningProvider: "lnbits",
        liveEnabled: true,
        lnbitsUrl: "https://lnbits.test",
        lnbitsApiKey: "api-key-value",
        lnbitsWebhookSecret: secret
      },
      { liveProvider: new LiveTestProvider() }
    );
    app = await createApp(runtime.dependencies, { logger: false });
  });

  after(async () => {
    await app.close();
    await runtime.close();
  });

  it("settles a live invoice only through the signed webhook path", async () => {
    const merchant = await runtime.services.provisioning.bootstrapMerchant({
      organizationName: "Live Org",
      merchantName: "Live Shop",
      livemode: true
    });
    assert.match(merchant.apiKey, /^bp_live_/);

    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        authorization: `Bearer ${merchant.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": "live-intent-0001"
      },
      payload: intentBody({ external_reference: "LIVE-1" })
    });
    assert.equal(created.statusCode, 201);
    const paymentHash = created.json().payment.payment_hash as string;
    assert.match(paymentHash, /^[0-9a-f]{64}$/);

    const forbidden = await app.inject({
      method: "POST",
      url: "/v1/providers/lnbits/webhook?token=wrong",
      headers: { "content-type": "application/json" },
      payload: { payment_hash: paymentHash }
    });
    assert.equal(forbidden.statusCode, 401);

    const settled = await app.inject({
      method: "POST",
      url: `/v1/providers/lnbits/webhook?token=${secret}`,
      headers: { "content-type": "application/json" },
      payload: { payment_hash: paymentHash }
    });
    assert.equal(settled.statusCode, 200);
    assert.deepEqual(settled.json(), { object: "provider_ack", status: "SETTLED" });

    const read = await app.inject({
      method: "GET",
      url: `/v1/payment-intents/${created.json().id}`,
      headers: { authorization: `Bearer ${merchant.apiKey}` }
    });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().status, "SUCCEEDED");

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/providers/lnbits/webhook?token=${secret}`,
      headers: { "content-type": "application/json" },
      payload: { payment_hash: paymentHash }
    });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().status, "DUPLICATE");
  });

  it("keeps sandbox invoices on the mock provider", async () => {
    const merchant = await runtime.services.provisioning.bootstrapMerchant({
      organizationName: "Sandbox Org",
      merchantName: "Sandbox Shop",
      livemode: false
    });
    assert.match(merchant.apiKey, /^bp_test_/);
    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        authorization: `Bearer ${merchant.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": "sandbox-live-isolation-0001"
      },
      payload: intentBody({ external_reference: "SANDBOX-1" })
    });
    assert.equal(created.statusCode, 201);
    assert.match(created.json().payment.invoice, /^lnbcrt/);
  });
});

class ReconcileLiveProvider implements LightningProvider {
  readonly name = "lnbits";
  readonly mode = "live" as const;
  private readonly invoices = new Map<string, ProviderInvoice>();
  private readonly paid = new Map<string, Date>();

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const paymentHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
    const invoice = {
      providerReference: paymentHash,
      paymentHash,
      bolt11: `lnbc${input.amountMsat}1reconcile`,
      amountMsat: input.amountMsat,
      expiresAt: new Date(Date.now() + input.expirySeconds * 1000)
    };
    this.invoices.set(paymentHash, invoice);
    return invoice;
  }

  async verifyProof(input: {
    providerReference: string;
    paymentHash: string;
    amountMsat: bigint;
  }): Promise<ProviderProof> {
    const invoice = this.invoices.get(input.paymentHash);
    if (!invoice) throw new Error("unknown live invoice");
    assert.equal(invoice.amountMsat, input.amountMsat);
    return {
      providerEventId: `live_evt_${input.paymentHash}`,
      providerReference: invoice.providerReference,
      paymentHash: input.paymentHash,
      amountMsat: invoice.amountMsat,
      occurredAt: this.paid.get(input.paymentHash) ?? new Date()
    };
  }

  async cancelInvoice(): Promise<boolean> {
    return true;
  }

  async status(input: {
    providerReference: string;
  }): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN"> {
    return this.paid.has(input.providerReference) ? "SETTLED" : "PENDING";
  }

  markPaid(paymentHash: string, at: Date = new Date()): void {
    this.paid.set(paymentHash, at);
  }
}

describe("live status reconciliation", () => {
  it("settles a paid live invoice when the provider callback is lost", async () => {
    const provider = new ReconcileLiveProvider();
    const runtime = await createTestRuntime(
      {
        lightningProvider: "lnbits",
        liveEnabled: true,
        lnbitsUrl: "https://lnbits.test",
        lnbitsApiKey: "api-key-value",
        lnbitsWebhookSecret: "webhook-secret-value"
      },
      { liveProvider: provider }
    );
    try {
      const live = await runtime.services.provisioning.bootstrapMerchant({
        organizationName: "Polling Live Org",
        merchantName: "Polling Live Shop",
        livemode: true
      });
      const liveAuth = await runtime.services.auth.authenticate(`Bearer ${live.apiKey}`);
      const liveIntent = await runtime.services.paymentIntents.createPaymentIntent(
        liveAuth,
        intentBody() as unknown as CreateIntentInput,
        "live-poll-intent-0001",
        "req-live-poll"
      );

      const sandbox = await runtime.services.provisioning.bootstrapMerchant({
        organizationName: "Polling Sandbox Org",
        merchantName: "Polling Sandbox Shop",
        livemode: false
      });
      const sandboxAuth = await runtime.services.auth.authenticate(
        `Bearer ${sandbox.apiKey}`
      );
      const sandboxIntent = await runtime.services.paymentIntents.createPaymentIntent(
        sandboxAuth,
        intentBody() as unknown as CreateIntentInput,
        "sandbox-poll-intent-0001",
        "req-sandbox-poll"
      );

      provider.markPaid(liveIntent.payment.payment_hash);
      const reconciled = await runtime.services.settlements.reconcileLiveInvoices();
      assert.equal(reconciled.checked, 1);
      assert.equal(reconciled.settled, 1);

      const liveView = await runtime.services.paymentIntents.getPaymentIntent(
        liveAuth,
        liveIntent.id
      );
      assert.equal(liveView.intent.status, "SUCCEEDED");
      assert.equal(liveView.invoice?.status, "SETTLED");
      assert.equal(liveView.transaction?.amountMsat, 1_000_000n);

      const sandboxView = await runtime.services.paymentIntents.getPaymentIntent(
        sandboxAuth,
        sandboxIntent.id
      );
      assert.equal(sandboxView.intent.status, "PENDING");
      assert.equal(sandboxView.invoice?.status, "ISSUED");
    } finally {
      await runtime.close();
    }
  });

  it("recovers a locally expired invoice whose provider payment predates expiry", async () => {
    const provider = new ReconcileLiveProvider();
    const runtime = await createTestRuntime(
      {
        lightningProvider: "lnbits",
        liveEnabled: true,
        lnbitsUrl: "https://lnbits.test",
        lnbitsApiKey: "api-key-value",
        lnbitsWebhookSecret: "webhook-secret-value"
      },
      { liveProvider: provider }
    );
    try {
      const live = await runtime.services.provisioning.bootstrapMerchant({
        organizationName: "Recovery Live Org",
        merchantName: "Recovery Live Shop",
        livemode: true
      });
      const liveAuth = await runtime.services.auth.authenticate(`Bearer ${live.apiKey}`);
      const intent = await runtime.services.paymentIntents.createPaymentIntent(
        liveAuth,
        intentBody() as unknown as CreateIntentInput,
        "live-recovery-intent-0001",
        "req-live-recovery"
      );
      const paymentHash = intent.payment.payment_hash;
      const paidAt = new Date(Date.now() - 45 * 60 * 1000);

      await runtime.db.query(
        `UPDATE invoices
            SET status = 'EXPIRED',
                created_at = now() - interval '1 hour',
                expires_at = now() - interval '30 minutes'
          WHERE payment_hash = $1`,
        [paymentHash]
      );
      await runtime.db.query(
        `UPDATE payment_intents SET status = 'EXPIRED' WHERE id = $1`,
        [intent.id]
      );
      await runtime.db.query(
        `UPDATE payment_attempts SET status = 'EXPIRED' WHERE payment_intent_id = $1`,
        [intent.id]
      );

      provider.markPaid(paymentHash, paidAt);
      const reconciled = await runtime.services.settlements.reconcileLiveInvoices();
      assert.equal(reconciled.checked, 1);
      assert.equal(reconciled.settled, 1);

      const view = await runtime.services.paymentIntents.getPaymentIntent(
        liveAuth,
        intent.id
      );
      assert.equal(view.intent.status, "SUCCEEDED");
      assert.equal(view.invoice?.status, "SETTLED");
      assert.equal(view.transaction?.settledAt, paidAt.toISOString());
    } finally {
      await runtime.close();
    }
  });
});
