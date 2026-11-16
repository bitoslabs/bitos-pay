import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { verifyWebhookSignature } from "../src/domain/index.ts";
import { PayError } from "../src/domain/errors.ts";
import type { CreateIntentInput } from "../src/application/payment-intent-service.ts";
import { createTestRuntime, intentBody, seedMerchant, type TestRuntime } from "./helpers.ts";

function body(overrides: Record<string, unknown> = {}): CreateIntentInput {
  return intentBody(overrides) as unknown as CreateIntentInput;
}

describe("PayService", () => {
  let runtime: TestRuntime;

  before(async () => {
    runtime = await createTestRuntime();
  });

  after(async () => {
    await runtime.close();
  });

  it("creates a pending intent with a Lightning invoice and active ledger-free state", async () => {
    const { auth } = await seedMerchant(runtime);
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-create-0001",
      "req-create-1"
    );
    assert.equal(created.status, "PENDING");
    assert.equal(created.amount, 1000);
    assert.equal(created.currency, "SAT");
    assert.equal(created.scale, 0);
    assert.match(created.payment.invoice, /^lnbcrt1000/);
    assert.match(created.payment.payment_hash, /^[0-9a-f]{64}$/);

    const view = await runtime.services.paymentIntents.getPaymentIntent(auth, created.id);
    assert.equal(view.intent.status, "PENDING");
    assert.equal(view.invoice?.status, "ISSUED");
    assert.equal(view.attempt?.status, "PENDING");
    assert.equal(view.transaction, null);
  });

  it("replays the same idempotency key and rejects a different body", async () => {
    const { auth } = await seedMerchant(runtime);
    const first = await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-replay-0001",
      "req-a"
    );
    const replay = await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-replay-0001",
      "req-b"
    );
    assert.equal(replay.id, first.id);
    assert.equal(replay.payment.payment_hash, first.payment.payment_hash);
    assert.equal(replay.request_id, "req-a");

    await assert.rejects(
      () =>
        runtime.services.paymentIntents.createPaymentIntent(
          auth,
          body({ amount: 2000 }),
          "idem-replay-0001",
          "req-c"
        ),
      (error: unknown) => error instanceof PayError && error.code === "PAY_IDEMPOTENCY_CONFLICT"
    );
  });

  it("settles once, posts a balanced ledger, and ignores a duplicate provider event", async () => {
    const { auth, merchantId } = await seedMerchant(runtime);
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-settle-0001",
      "req-s"
    );
    const settled = await runtime.services.settlements.sandboxSettle(created.payment.payment_hash);
    assert.equal(settled.status, "SETTLED");
    assert.equal(settled.intentStatus, "SUCCEEDED");

    const view = await runtime.services.paymentIntents.getPaymentIntent(auth, created.id);
    assert.equal(view.intent.status, "SUCCEEDED");
    assert.equal(view.invoice?.status, "SETTLED");
    assert.equal(view.attempt?.status, "SUCCEEDED");
    assert.equal(view.transaction?.amountMsat, 1_000_000n);

    const balances = await runtime.services.ledgerQuery.getBalances(auth);
    const payable = balances.find((line) => line.account_code === "merchant_payable");
    const clearing = balances.find((line) => line.account_code === "provider_clearing");
    assert.equal(payable?.balance_msat, "1000000");
    assert.equal(clearing?.balance_msat, "1000000");

    await assert.rejects(
      () => runtime.db.query(`UPDATE ledger_entries SET amount_msat = amount_msat + 1`),
      /immutable/
    );

    const duplicate = await runtime.services.settlements.sandboxSettle(
      created.payment.payment_hash
    );
    assert.equal(duplicate.status, "DUPLICATE");
    const transactions = (await runtime.repositories.payments.listTransactions(merchantId, { limit: 10 })).items;
    assert.equal(
      transactions.filter((transaction) => transaction.paymentHash === created.payment.payment_hash)
        .length,
      1
    );
  });

  it("computes and snapshots a merchant fee", async () => {
    const { auth, merchantId } = await seedMerchant(runtime, { feeBps: 100 });
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-fee-0001",
      "req-f"
    );
    await runtime.services.settlements.sandboxSettle(created.payment.payment_hash);

    const transactions = (await runtime.repositories.payments.listTransactions(merchantId, { limit: 10 })).items;
    const transaction = transactions.find(
      (row) => row.paymentHash === created.payment.payment_hash
    );
    assert.equal(transaction?.amountMsat, 1_000_000n);
    assert.equal(transaction?.feeMsat, 10_000n);
    assert.equal(transaction?.netMsat, 990_000n);

    const balances = await runtime.services.ledgerQuery.getBalances(auth);
    assert.equal(
      balances.find((line) => line.account_code === "platform_fee_revenue")?.balance_msat,
      "10000"
    );
    assert.equal(
      balances.find((line) => line.account_code === "merchant_payable")?.balance_msat,
      "990000"
    );
  });

  it("cancels a non-terminal intent and refuses to settle a cancelled invoice", async () => {
    const { auth } = await seedMerchant(runtime);
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-cancel-0001",
      "req-c"
    );
    const cancelled = await runtime.services.paymentIntents.cancelPaymentIntent(auth, created.id);
    assert.equal(cancelled.intent.status, "CANCELLED");
    assert.equal(cancelled.invoice?.status, "CANCELLED");
    await assert.rejects(
      () => runtime.services.settlements.sandboxSettle(created.payment.payment_hash),
      (error: unknown) => error instanceof PayError && error.code === "PAY_PROVIDER_PROOF"
    );
  });

  it("quarantines a late settlement after expiry without posting money", async () => {
    const { auth, merchantId } = await seedMerchant(runtime);
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-late-0001",
      "req-l"
    );
    const past = new Date(Date.now() - 60_000).toISOString();
    await runtime.db.query(`UPDATE invoices SET expires_at = $1 WHERE payment_hash = $2`, [
      past,
      created.payment.payment_hash
    ]);
    await runtime.db.query(`UPDATE payment_intents SET expires_at = $1 WHERE id = $2`, [
      past,
      created.id
    ]);

    await runtime.services.expiration.expireDueIntents();
    const afterExpiry = await runtime.services.paymentIntents.getPaymentIntent(auth, created.id);
    assert.equal(afterExpiry.intent.status, "EXPIRED");

    const late = await runtime.services.settlements.sandboxSettle(created.payment.payment_hash);
    assert.equal(late.status, "QUARANTINED");

    const view = await runtime.services.paymentIntents.getPaymentIntent(auth, created.id);
    assert.equal(view.intent.status, "EXPIRED");
    assert.equal(view.invoice?.status, "QUARANTINED");
    assert.equal(view.attempt?.status, "QUARANTINED");
    assert.equal(view.transaction, null);

    const transactions = (await runtime.repositories.payments.listTransactions(merchantId, { limit: 10 })).items;
    assert.equal(
      transactions.filter((row) => row.paymentHash === created.payment.payment_hash).length,
      0
    );
  });

  it("enforces merchant scope for reads", async () => {
    const first = await seedMerchant(runtime, { merchantName: "First" });
    const second = await seedMerchant(runtime, { merchantName: "Second" });
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      first.auth,
      body(),
      "idem-scope-0001",
      "req-t"
    );
    await assert.rejects(
      () => runtime.services.paymentIntents.getPaymentIntent(second.auth, created.id),
      (error: unknown) => error instanceof PayError && error.code === "PAY_NOT_FOUND_INTENT"
    );
  });

  it("enqueues one delivery per active endpoint for the same event", async () => {
    const { auth } = await seedMerchant(runtime);
    const first = await runtime.services.webhooks.registerEndpoint(
      auth,
      { url: "http://127.0.0.1:1/first", events: ["payment.created"] },
      "idem-multi-hook-0001"
    );
    const second = await runtime.services.webhooks.registerEndpoint(
      auth,
      { url: "http://127.0.0.1:1/second", events: ["payment.created"] },
      "idem-multi-hook-0002"
    );
    await runtime.services.paymentIntents.createPaymentIntent(
      auth,
      body(),
      "idem-multi-hook-intent-0001",
      "req-multi-hook"
    );

    const deliveries = await runtime.repositories.webhooks.listDeliveries(
      auth.merchantId,
      20
    );
    const created = deliveries.filter((delivery) => delivery.eventType === "payment.created");
    assert.equal(created.length, 2);
    assert.deepEqual(
      new Set(created.map((delivery) => delivery.endpointId)),
      new Set([first.endpoint.id, second.endpoint.id])
    );
    assert.equal(new Set(created.map((delivery) => delivery.eventId)).size, 1);
  });

  it("delivers a signed webhook whose signature verifies", async () => {
    const { auth } = await seedMerchant(runtime);
    const received: Array<{
      headers: Record<string, string | string[] | undefined>;
      body: string;
    }> = [];
    const receiver = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(204);
        response.end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    try {
      const port = (receiver.address() as AddressInfo).port;
      const registration = await runtime.services.webhooks.registerEndpoint(
        auth,
        { url: `http://127.0.0.1:${port}/hook`, events: ["payment.succeeded"] },
        "idem-webhook-0001"
      );
      const created = await runtime.services.paymentIntents.createPaymentIntent(
        auth,
        body(),
        "idem-hook-0001",
        "req-h"
      );
      await runtime.services.settlements.sandboxSettle(created.payment.payment_hash);
      await runtime.services.webhooks.deliverDue(new Date(Date.now() + 1000));

      assert.equal(received.length, 1);
      const delivery = received[0];
      const timestamp = Number(delivery.headers["bitos-pay-timestamp"]);
      const signature = String(delivery.headers["bitos-pay-signature"]);
      assert.equal(
        verifyWebhookSignature(
          registration.secret,
          timestamp,
          delivery.body,
          signature,
          timestamp
        ),
        true
      );
      const payload = JSON.parse(delivery.body) as {
        type: string;
        data: Record<string, unknown>;
      };
      assert.equal(payload.type, "payment.succeeded");
      assert.equal(payload.data.payment_intent_id, created.id);

      await runtime.services.webhooks.deliverDue(new Date(Date.now() + 2000));
      assert.equal(received.length, 1);
    } finally {
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });
  it("rotates a webhook secret and dual-signs during the grace window", async () => {
    const { auth } = await seedMerchant(runtime);
    const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
    const receiver = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        received.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(204);
        response.end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    try {
      const port = (receiver.address() as AddressInfo).port;
      const registration = await runtime.services.webhooks.registerEndpoint(
        auth,
        { url: `http://127.0.0.1:${port}/hook`, events: ["payment.succeeded"] },
        "idem-webhook-rotate-0001"
      );
      const rotation = await runtime.services.webhooks.rotateEndpointSecret(
        auth,
        registration.endpoint.id
      );
      assert.notEqual(rotation.secret, registration.secret);
      assert.ok(Date.parse(rotation.previousSecretExpiresAt) > Date.now());

      const created = await runtime.services.paymentIntents.createPaymentIntent(
        auth,
        body({ amount: 2500 }),
        "idem-hook-rotate-0001",
        "req-hr"
      );
      await runtime.services.settlements.sandboxSettle(created.payment.payment_hash);
      await runtime.services.webhooks.deliverDue(new Date(Date.now() + 1000));

      assert.equal(received.length, 1);
      const delivery = received[0];
      const timestamp = Number(delivery.headers["bitos-pay-timestamp"]);
      assert.equal(
        verifyWebhookSignature(
          rotation.secret,
          timestamp,
          delivery.body,
          String(delivery.headers["bitos-pay-signature"]),
          timestamp
        ),
        true
      );
      assert.equal(
        verifyWebhookSignature(
          registration.secret,
          timestamp,
          delivery.body,
          String(delivery.headers["bitos-pay-signature-previous"]),
          timestamp
        ),
        true
      );

      await runtime.services.webhooks.disableEndpoint(auth, registration.endpoint.id);
      await assert.rejects(
        runtime.services.webhooks.rotateEndpointSecret(auth, registration.endpoint.id),
        (error: unknown) =>
          error instanceof PayError && error.code === "PAY_WEBHOOK_INVALID"
      );
    } finally {
      await new Promise<void>((resolve) => receiver.close(() => resolve()));
    }
  });
  it("rate limits public payment-link invoice creation per client IP", async () => {
    const limited = await createTestRuntime({ paymentLinkRateLimit: 1 });
    try {
      const seeded = await seedMerchant(limited);
      const created = await limited.services.paymentLinks.create(
        seeded.auth,
        { amount: 1000, currency: "SAT", scale: 0, reference: "RATE-1" },
        "rate-link-0001"
      );
      const token = created.url.split("/").at(-1) ?? "";
      const first = await limited.services.paymentLinks.createCheckout(
        token,
        "rate-checkout-0001",
        "req-rate-1",
        "203.0.113.10"
      );
      assert.ok(first.payment_id.startsWith("pi_"));
      await assert.rejects(
        limited.services.paymentLinks.createCheckout(
          token,
          "rate-checkout-0002",
          "req-rate-2",
          "203.0.113.10"
        ),
        (error: unknown) => error instanceof PayError && error.code === "PAY_RATE_LIMITED"
      );
    } finally {
      await limited.close();
    }
  });
});
