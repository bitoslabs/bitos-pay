import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { PayError } from "../src/domain/errors.ts";
import { createApp } from "../src/api/app.ts";
import { createTestRuntime, intentBody, seedMerchant, type TestRuntime } from "./helpers.ts";

interface SeededMerchant {
  apiKey: string;
  merchantId: string;
}

describe("refunds and risk limits", () => {
  let runtime: TestRuntime;
  let app: FastifyInstance;

  before(async () => {
    runtime = await createTestRuntime();
    app = await createApp(runtime.dependencies, { logger: false });
  });

  after(async () => {
    await app.close();
    await runtime.close();
  });

  const auth = (apiKey: string) => ({ authorization: `Bearer ${apiKey}` });

  async function merchant(feeBps = 0): Promise<SeededMerchant> {
    return seedMerchant(runtime, { feeBps });
  }

  async function createSettled(
    apiKey: string,
    amount = 1000,
    idempotencyKey = `settle-${Math.random()}`
  ): Promise<{ intentId: string; transactionId: string; paymentHash: string }> {
    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(apiKey),
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      payload: intentBody({ amount })
    });
    assert.equal(created.statusCode, 201);
    const body = created.json() as {
      id: string;
      payment: { payment_hash: string };
    };
    const settled = await app.inject({
      method: "POST",
      url: `/v1/sandbox/invoices/${body.payment.payment_hash}/settle`,
      headers: { "x-sandbox-token": runtime.config.sandboxToken ?? "" }
    });
    assert.equal(settled.statusCode, 200);
    const settlement = settled.json() as { transactionId: string };
    return {
      intentId: body.id,
      transactionId: settlement.transactionId,
      paymentHash: body.payment.payment_hash
    };
  }

  async function balances(apiKey: string): Promise<Record<string, bigint>> {
    const response = await app.inject({
      method: "GET",
      url: "/v1/balances",
      headers: auth(apiKey)
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      data: Array<{ account_code: string; balance_msat: string }>;
    };
    return Object.fromEntries(
      body.data.map((line) => [line.account_code, BigInt(line.balance_msat)])
    );
  }

  async function refund(
    apiKey: string,
    transactionId: string,
    amount: number,
    idempotencyKey: string,
    reason = "customer_request"
  ) {
    return app.inject({
      method: "POST",
      url: "/v1/refunds",
      headers: {
        ...auth(apiKey),
        "content-type": "application/json",
        "idempotency-key": idempotencyKey
      },
      payload: { transaction_id: transactionId, amount, reason }
    });
  }

  it("posts partial and full refund reversals with an exact fee split", async () => {
    const seeded = await merchant(100);
    const settled = await createSettled(seeded.apiKey, 1000, "refund-settle-0001");

    assert.deepEqual(await balances(seeded.apiKey), {
      merchant_payable: 990_000n,
      platform_fee_revenue: 10_000n,
      provider_clearing: 1_000_000n
    });

    const first = await refund(seeded.apiKey, settled.transactionId, 400, "refund-key-0001");
    assert.equal(first.statusCode, 201);
    const firstRefund = first.json() as {
      id: string;
      status: string;
      amount: number;
      fee: number;
      net: number;
      fee_msat: string;
      net_msat: string;
    };
    assert.match(firstRefund.id, /^rfd_/);
    assert.equal(firstRefund.status, "SUCCEEDED");
    assert.equal(firstRefund.amount, 400);
    assert.equal(firstRefund.fee, 4);
    assert.equal(firstRefund.net, 396);
    assert.equal(firstRefund.fee_msat, "4000");
    assert.equal(firstRefund.net_msat, "396000");
    assert.deepEqual(await balances(seeded.apiKey), {
      merchant_payable: 594_000n,
      platform_fee_revenue: 6_000n,
      provider_clearing: 600_000n
    });

    const replay = await refund(seeded.apiKey, settled.transactionId, 400, "refund-key-0001");
    assert.equal(replay.statusCode, 201);
    assert.equal((replay.json() as { id: string }).id, firstRefund.id);

    const conflict = await refund(seeded.apiKey, settled.transactionId, 401, "refund-key-0001");
    assert.equal(conflict.statusCode, 409);
    assert.equal(
      (conflict.json() as { error: { code: string } }).error.code,
      "PAY_IDEMPOTENCY_CONFLICT"
    );

    const second = await refund(seeded.apiKey, settled.transactionId, 600, "refund-key-0002");
    assert.equal(second.statusCode, 201);
    const secondRefund = second.json() as { fee: number; net: number };
    assert.equal(secondRefund.fee, 6);
    assert.equal(secondRefund.net, 594);
    assert.deepEqual(await balances(seeded.apiKey), {
      merchant_payable: 0n,
      platform_fee_revenue: 0n,
      provider_clearing: 0n
    });

    const summary = await app.inject({
      method: "GET",
      url: `/v1/settlements/summary?from=${encodeURIComponent(
        new Date(Date.now() - 60_000).toISOString()
      )}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
      headers: auth(seeded.apiKey)
    });
    assert.equal(summary.statusCode, 200);
    const summaryBody = summary.json() as {
      gross: number;
      fees: number;
      net: number;
      transaction_count: number;
      ledger_balanced: boolean;
    };
    assert.equal(summaryBody.gross, 0);
    assert.equal(summaryBody.fees, 0);
    assert.equal(summaryBody.net, 0);
    assert.equal(summaryBody.transaction_count, 1);
    assert.equal(summaryBody.ledger_balanced, true);

    const excess = await refund(seeded.apiKey, settled.transactionId, 1, "refund-key-0003");
    assert.equal(excess.statusCode, 409);
    assert.equal(
      (excess.json() as { error: { code: string } }).error.code,
      "PAY_REFUND_EXCEEDS"
    );

    const page = await app.inject({
      method: "GET",
      url: "/v1/refunds?limit=1",
      headers: auth(seeded.apiKey)
    });
    assert.equal(page.statusCode, 200);
    const pageBody = page.json() as {
      data: Array<{ id: string }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    assert.equal(pageBody.data.length, 1);
    assert.equal(pageBody.has_more, true);
    assert.ok(pageBody.next_cursor);
    const next = await app.inject({
      method: "GET",
      url: `/v1/refunds?limit=1&starting_after=${pageBody.next_cursor}`,
      headers: auth(seeded.apiKey)
    });
    const nextBody = next.json() as { data: Array<{ id: string }> };
    assert.notEqual(nextBody.data[0]?.id, pageBody.data[0]?.id);

    const read = await app.inject({
      method: "GET",
      url: `/v1/refunds/${firstRefund.id}`,
      headers: auth(seeded.apiKey)
    });
    assert.equal(read.statusCode, 200);
    assert.equal((read.json() as { id: string }).id, firstRefund.id);
  });

  it("presents sub-sat fee splits as decimal SAT without throwing", async () => {
    const seeded = await merchant(100);
    const settled = await createSettled(seeded.apiKey, 250, "refund-fraction-settle-1");
    const created = await refund(seeded.apiKey, settled.transactionId, 50, "refund-fraction-key-1");
    assert.equal(created.statusCode, 201);
    const body = created.json() as { fee: number; net: number; fee_msat: string; net_msat: string };
    assert.equal(body.fee, 0.5);
    assert.equal(body.net, 49.5);
    assert.equal(body.fee_msat, "500");
    assert.equal(body.net_msat, "49500");

    const summary = await app.inject({
      method: "GET",
      url: `/v1/settlements/summary?from=${encodeURIComponent(
        new Date(Date.now() - 60_000).toISOString()
      )}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
      headers: auth(seeded.apiKey)
    });
    assert.equal(summary.statusCode, 200);
    const summaryBody = summary.json() as {
      gross: number;
      fees: number;
      net: number;
      ledger_balanced: boolean;
    };
    assert.equal(summaryBody.gross, 200);
    assert.equal(summaryBody.fees, 2);
    assert.equal(summaryBody.net, 198);
    assert.equal(summaryBody.ledger_balanced, true);
  });

  it("publishes refund.succeeded to an active webhook endpoint", async () => {
    const seeded = await merchant();
    const settled = await createSettled(seeded.apiKey, 1000, "refund-event-settle-1");
    const endpoint = await app.inject({
      method: "POST",
      url: "/v1/webhook-endpoints",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "refund-event-endpoint-1"
      },
      payload: { url: "https://example.test/refund-hook", events: ["refund.succeeded"] }
    });
    assert.equal(endpoint.statusCode, 201);
    const endpointId = (endpoint.json() as { id: string }).id;

    const created = await refund(seeded.apiKey, settled.transactionId, 100, "refund-event-key-1");
    assert.equal(created.statusCode, 201);

    const deliveries = await app.inject({
      method: "GET",
      url: "/v1/webhook-deliveries?limit=20",
      headers: auth(seeded.apiKey)
    });
    assert.equal(deliveries.statusCode, 200);
    const body = deliveries.json() as {
      data: Array<{ endpoint_id: string; event_type: string; status: string }>;
    };
    assert.ok(
      body.data.some(
        (delivery) =>
          delivery.endpoint_id === endpointId &&
          delivery.event_type === "refund.succeeded" &&
          delivery.status === "PENDING"
      )
    );
  });

  it("fails closed for a live refund", async () => {
    const seeded = await merchant();
    const settled = await createSettled(seeded.apiKey, 1000, "refund-live-settle-1");
    const auth = await runtime.services.auth.authenticate(`Bearer ${seeded.apiKey}`);
    await assert.rejects(
      () =>
        runtime.services.refunds.createRefund(
          { ...auth, livemode: true },
          { transaction_id: settled.transactionId, amount: 100 },
          "refund-live-key-1",
          "req-refund-live"
        ),
      (error: unknown) =>
        error instanceof PayError && error.code === "PAY_PROVIDER_UNAVAILABLE"
    );
  });

  it("requires the refund scope and keeps refunds tenant-scoped", async () => {
    const first = await merchant();
    const second = await merchant();
    const settled = await createSettled(first.apiKey, 1000, "refund-scope-settle-1");

    const scopedKey = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: {
        ...auth(first.apiKey),
        "content-type": "application/json"
      },
      payload: { scopes: ["payments:read"] }
    });
    const readOnly = scopedKey.json() as { key: string };
    const denied = await refund(readOnly.key, settled.transactionId, 100, "refund-scope-key-1");
    assert.equal(denied.statusCode, 403);
    assert.equal(
      (denied.json() as { error: { code: string } }).error.code,
      "PAY_AUTH_SCOPE"
    );

    const crossTenant = await refund(second.apiKey, settled.transactionId, 100, "refund-scope-key-2");
    assert.equal(crossTenant.statusCode, 404);
    assert.equal(
      (crossTenant.json() as { error: { code: string } }).error.code,
      "PAY_NOT_FOUND_TRANSACTION"
    );
  });

  it("rejects an amount above the merchant payment limit", async () => {
    const seeded = await merchant();
    await runtime.repositories.merchants.updateRiskLimits(seeded.merchantId, {
      maxPaymentMsat: 500_000n,
      dailyVolumeMsat: 10_000_000n,
      maxPaymentsPerMinute: 60
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "risk-amount-0001"
      },
      payload: intentBody({ amount: 1000 })
    });
    assert.equal(response.statusCode, 403);
    assert.equal((response.json() as { error: { code: string } }).error.code, "PAY_RISK_LIMIT");
    const list = await app.inject({
      method: "GET",
      url: "/v1/payments",
      headers: auth(seeded.apiKey)
    });
    assert.equal((list.json() as { data: unknown[] }).data.length, 0);
  });

  it("rejects a payment that would exceed the daily volume limit", async () => {
    const seeded = await merchant();
    await runtime.repositories.merchants.updateRiskLimits(seeded.merchantId, {
      maxPaymentMsat: 10_000_000n,
      dailyVolumeMsat: 1_500_000n,
      maxPaymentsPerMinute: 60
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "risk-day-0001"
      },
      payload: intentBody({ amount: 1000 })
    });
    assert.equal(first.statusCode, 201);
    const second = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "risk-day-0002"
      },
      payload: intentBody({ amount: 1000 })
    });
    assert.equal(second.statusCode, 403);
    assert.equal(
      (second.json() as { error: { code: string } }).error.code,
      "PAY_RISK_LIMIT"
    );
  });

  it("enforces per-minute velocity but still replays an idempotent request", async () => {
    const seeded = await merchant();
    await runtime.repositories.merchants.updateRiskLimits(seeded.merchantId, {
      maxPaymentMsat: 10_000_000n,
      dailyVolumeMsat: 10_000_000n,
      maxPaymentsPerMinute: 1
    });
    const first = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "risk-minute-0001"
      },
      payload: intentBody({ amount: 1000 })
    });
    assert.equal(first.statusCode, 201);
    const firstId = (first.json() as { id: string }).id;

    const replay = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "risk-minute-0001"
      },
      payload: intentBody({ amount: 1000 })
    });
    assert.equal(replay.statusCode, 201);
    assert.equal((replay.json() as { id: string }).id, firstId);

    const limited = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "risk-minute-0002"
      },
      payload: intentBody({ amount: 1000 })
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers["retry-after"], "60");
    assert.equal(
      (limited.json() as { error: { code: string } }).error.code,
      "PAY_RISK_VELOCITY"
    );
  });

  it("blocks a suspended merchant at authentication", async () => {
    const seeded = await merchant();
    await runtime.db.query(
      `UPDATE ${runtime.config.schema}.merchants SET status = $1 WHERE id = $2`,
      ["SUSPENDED", seeded.merchantId]
    );
    const response = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(seeded.apiKey),
        "content-type": "application/json",
        "idempotency-key": "risk-status-0001"
      },
      payload: intentBody({ amount: 1000 })
    });
    assert.equal(response.statusCode, 403);
    assert.equal((response.json() as { error: { code: string } }).error.code, "PAY_AUTH_SCOPE");
  });
});
