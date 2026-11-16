import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BitOSPay, BitOSPayError } from "../src/index.ts";

interface Call {
  url: URL;
  init: RequestInit;
}

function recordedFetch(response: unknown, status = 200): {
  calls: Call[];
  fetch: typeof fetch;
} {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init: init ?? {} });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  return { calls, fetch: impl };
}

const intent = {
  id: "pi_test",
  status: "PENDING",
  amount: 1000,
  amount_msat: "1000000",
  currency: "SAT",
  scale: 0,
  external_reference: "ORDER-1",
  livemode: false,
  expires_at: "2026-11-13T10:00:00.000Z",
  created_at: "2026-11-13T09:45:00.000Z",
  updated_at: "2026-11-13T09:45:00.000Z",
  metadata: {},
  request_id: "req_1"
};

describe("BitOSPay client", () => {
  it("creates an intent with auth, JSON and an explicit idempotency key", async () => {
    const transport = recordedFetch(intent);
    const pay = new BitOSPay({
      apiKey: "bp_test_secret",
      baseUrl: "http://127.0.0.1:8788/",
      fetch: transport.fetch
    });

    const result = await pay.paymentIntents.create(
      {
        amount: 1000,
        currency: "SAT",
        scale: 0,
        payment_method: "lightning",
        external_reference: "ORDER-1"
      },
      { idempotencyKey: "idem-explicit" }
    );

    assert.equal(result.id, "pi_test");
    assert.equal(transport.calls.length, 1);
    const call = transport.calls[0]!;
    assert.equal(call.url.toString(), "http://127.0.0.1:8788/v1/payment-intents");
    assert.equal(call.init.method, "POST");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer bp_test_secret");
    assert.equal(headers["idempotency-key"], "idem-explicit");
    assert.equal(headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(String(call.init.body)), {
      amount: 1000,
      currency: "SAT",
      scale: 0,
      payment_method: "lightning",
      external_reference: "ORDER-1"
    });
  });

  it("generates distinct idempotency keys and sends list query parameters", async () => {
    const transport = recordedFetch({
      object: "list",
      data: [],
      has_more: false,
      next_cursor: null,
      request_id: "req_2"
    });
    const pay = new BitOSPay({
      apiKey: "bp_test_secret",
      baseUrl: "https://pay.example",
      fetch: transport.fetch
    });

    await pay.paymentIntents.create({
      amount: 1,
      currency: "SAT",
      scale: 0,
      payment_method: "lightning"
    });
    await pay.paymentIntents.create({
      amount: 1,
      currency: "SAT",
      scale: 0,
      payment_method: "lightning"
    });
    const keys = transport.calls
      .slice(0, 2)
      .map((call) => (call.init.headers as Record<string, string>)["idempotency-key"]);
    assert.ok(keys[0]?.startsWith("sdk_"));
    assert.notEqual(keys[0], keys[1]);

    await pay.paymentIntents.list({ limit: 2, status: "PENDING", starting_after: "pi_a" });
    const listUrl = transport.calls[2]!.url;
    assert.equal(listUrl.pathname, "/v1/payments");
    assert.equal(listUrl.searchParams.get("limit"), "2");
    assert.equal(listUrl.searchParams.get("status"), "PENDING");
    assert.equal(listUrl.searchParams.get("starting_after"), "pi_a");
  });

  it("routes refunds, settlements, webhooks and API keys", async () => {
    const response = { id: "rfd_1", object: "refund" };
    const transport = recordedFetch(response, 201);
    const pay = new BitOSPay({
      apiKey: "bp_test_secret",
      baseUrl: "https://pay.example",
      fetch: transport.fetch
    });

    await pay.refunds.create({ transaction_id: "txn_1", amount: 10 }, { idempotencyKey: "refund-key-1" });
    await pay.settlements.reconcile({
      period_start: "2026-11-13T00:00:00Z",
      period_end: "2026-11-14T00:00:00Z"
    });
    await pay.webhookEndpoints.create(
      { url: "https://merchant.example/hook", events: ["payment.succeeded"] },
      { idempotencyKey: "webhook-key-1" }
    );
    await pay.webhookEndpoints.update("whe_1", ["payment.succeeded"]);
    await pay.webhookEndpoints.rotate("whe_1");
    await pay.paymentLinks.create(
      { amount: 3000, currency: "SAT", scale: 0, reference: "LINK-1" },
      { idempotencyKey: "link-key-1" }
    );
    await pay.paymentLinks.disable("pl_1");
    await pay.merchants.update({ name: "Mekong Roasters", support_email: "help@example.test" });
    await pay.locations.create({ name: "Riverside", code: "RIVER" });
    await pay.locations.list();
    await pay.locations.update("loc_1", { name: "Main", active: true });
    await pay.locations.disable("loc_1");
    await pay.apiKeys.create(["payments:read"], { expiresInDays: 30 });
    await pay.apiKeys.rotate("key_1");

    assert.deepEqual(
      transport.calls.map((call) => `${call.init.method} ${call.url.pathname}`),
      [
        "POST /v1/refunds",
        "POST /v1/settlements/reconcile",
        "POST /v1/webhook-endpoints",
        "PATCH /v1/webhook-endpoints/whe_1",
        "POST /v1/webhook-endpoints/whe_1/rotate",
        "POST /v1/payment-links",
        "POST /v1/payment-links/pl_1/disable",
        "PATCH /v1/merchants/me",
        "POST /v1/locations",
        "GET /v1/locations",
        "PATCH /v1/locations/loc_1",
        "POST /v1/locations/loc_1/disable",
        "POST /v1/api-keys",
        "POST /v1/api-keys/key_1/rotate"
      ]
    );
    assert.equal(
      (transport.calls[0]!.init.headers as Record<string, string>)["idempotency-key"],
      "refund-key-1"
    );
  });

  it("maps API errors to BitOSPayError", async () => {
    const transport = recordedFetch(
      {
        error: {
          type: "PAY_IDEMPOTENCY_CONFLICT",
          code: "PAY_IDEMPOTENCY_CONFLICT",
          message: "idempotency key reused with a different body",
          request_id: "req_conflict"
        }
      },
      409
    );
    const pay = new BitOSPay({
      apiKey: "bp_test_secret",
      baseUrl: "https://pay.example",
      fetch: transport.fetch
    });

    await assert.rejects(
      () =>
        pay.invoices.create(
          { amount: 1, currency: "SAT", scale: 0, payment_method: "lightning" },
          { idempotencyKey: "same-key" }
        ),
      (error: unknown) =>
        error instanceof BitOSPayError &&
        error.status === 409 &&
        error.code === "PAY_IDEMPOTENCY_CONFLICT" &&
        error.requestId === "req_conflict"
    );
  });

  it("exposes a typed escape hatch", async () => {
    const transport = recordedFetch({ status: "ok" });
    const pay = new BitOSPay({
      apiKey: "bp_test_secret",
      baseUrl: "https://pay.example",
      fetch: transport.fetch
    });
    const result = await pay.request<{ status: string }>("/healthz");
    assert.equal(result.status, "ok");
    assert.equal(transport.calls[0]!.url.pathname, "/healthz");
  });
});
