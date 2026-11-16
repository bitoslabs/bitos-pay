import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import { createTestRuntime, intentBody, seedMerchant, type TestRuntime } from "./helpers.ts";

describe("HTTP API", () => {
  let runtime: TestRuntime;
  let app: FastifyInstance;
  let apiKey: string;

  before(async () => {
    runtime = await createTestRuntime();
    const seeded = await seedMerchant(runtime);
    apiKey = seeded.apiKey;
    app = await createApp(runtime.dependencies, { logger: false });
  });

  after(async () => {
    await app.close();
    await runtime.close();
  });

  it("serves liveness and readiness", async () => {
    const health = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: "ok" });
    const ready = await app.inject({ method: "GET", url: "/readyz" });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { status: "ready" });

    const openapiResponse = await app.inject({ method: "GET", url: "/openapi.json" });
    assert.equal(openapiResponse.statusCode, 200);
    const openapi = openapiResponse.json() as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    assert.equal(openapi.openapi, "3.1.0");
    assert.ok(openapi.paths["/v1/invoices"]);
    assert.ok(openapi.paths["/v1/exchange/quotes"]);
    assert.ok(openapi.paths["/v1/settlements/summary"]);
    assert.ok(openapi.paths["/v1/refunds"]);
    assert.ok(openapi.paths["/v1/api-keys/{id}/rotate"]);
    assert.ok(openapi.paths["/v1/checkout/{token}"]);
    assert.ok(openapi.paths["/v1/payment-links/{token}/checkout"]);
    assert.ok(openapi.paths["/v1/merchants/me"]);
    assert.ok(openapi.paths["/v1/settlements"]);
    assert.ok(openapi.paths["/v1/api-keys"]);
    assert.ok(openapi.paths["/v1/locations"]);
    assert.ok(openapi.paths["/v1/locations/{id}"]);
    assert.ok(openapi.paths["/v1/webhook-endpoints/{id}"]);
    assert.ok(openapi.paths["/v1/onboarding/bnos"]);
  });

  it("rejects a missing API key and a missing idempotency key", async () => {
    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: { "content-type": "application/json" },
      payload: intentBody()
    });
    assert.equal(unauthorized.statusCode, 401);
    const error = unauthorized.json() as { error: { code: string } };
    assert.equal(error.error.code, "PAY_AUTH_MISSING");

    const missingIdempotency = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      payload: intentBody()
    });
    assert.equal(missingIdempotency.statusCode, 400);
    const idempotencyError = missingIdempotency.json() as { error: { code: string } };
    assert.equal(idempotencyError.error.code, "PAY_IDEMPOTENCY_MISSING");
  });

  it("creates, reads and settles an intent through the sandbox provider", async () => {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "idempotency-key": "http-idem-0001"
      },
      payload: intentBody()
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as {
      id: string;
      payment: { payment_hash: string };
      status: string;
    };
    assert.equal(created.status, "PENDING");

    const readResponse = await app.inject({
      method: "GET",
      url: `/v1/payment-intents/${created.id}`,
      headers: { authorization: `Bearer ${apiKey}` }
    });
    assert.equal(readResponse.statusCode, 200);
    const read = readResponse.json() as { id: string; status: string };
    assert.equal(read.id, created.id);

    const unauthorizedSettle = await app.inject({
      method: "POST",
      url: `/v1/sandbox/invoices/${created.payment.payment_hash}/settle`,
      headers: { "content-type": "application/json", "x-sandbox-token": "wrong" },
      payload: {}
    });
    assert.equal(unauthorizedSettle.statusCode, 401);

    const settledResponse = await app.inject({
      method: "POST",
      url: `/v1/sandbox/invoices/${created.payment.payment_hash}/settle`,
      headers: { "x-sandbox-token": runtime.config.sandboxToken ?? "" }
    });
    assert.equal(settledResponse.statusCode, 200);
    const settled = settledResponse.json() as { status: string; transactionId: string };
    assert.equal(settled.status, "SETTLED");
    assert.ok(settled.transactionId.startsWith("txn_"));

    const balancesResponse = await app.inject({
      method: "GET",
      url: "/v1/balances",
      headers: { authorization: `Bearer ${apiKey}` }
    });
    assert.equal(balancesResponse.statusCode, 200);
    const balances = balancesResponse.json() as {
      ledger_derived: boolean;
      wallet_balance: boolean;
      data: Array<{ account_code: string; balance_msat: string }>;
    };
    assert.equal(balances.ledger_derived, true);
    assert.equal(balances.wallet_balance, false);
    assert.equal(
      balances.data.find((line) => line.account_code === "merchant_payable")?.balance_msat,
      "1000000"
    );
  });

  it("validates request bodies at the HTTP boundary", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "idempotency-key": "http-invalid-0001"
      },
      payload: { amount: 10.5, currency: "SAT", scale: 0, payment_method: "lightning" }
    });
    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: { code: string } };
    assert.equal(body.error.code, "PAY_VALIDATION_BODY");

    const stringAmount = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "idempotency-key": "http-string-amount-0001"
      },
      payload: { amount: "1000", currency: "SAT", scale: 0, payment_method: "lightning" }
    });
    assert.equal(stringAmount.statusCode, 400);
  });
});

describe("browser CORS", () => {
  it("allows configured origins and rejects unknown ones", async () => {
    const runtime = await createTestRuntime({ corsOrigins: ["https://bnos.example"] });
    const app = await createApp(runtime.dependencies, { logger: false });
    try {
      const preflight = await app.inject({
        method: "OPTIONS",
        url: "/v1/onboarding/bnos",
        headers: {
          origin: "https://bnos.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type"
        }
      });
      assert.equal(preflight.statusCode, 204);
      assert.equal(preflight.headers["access-control-allow-origin"], "https://bnos.example");
      assert.match(String(preflight.headers["access-control-allow-methods"]), /POST/);
      assert.match(String(preflight.headers["access-control-allow-headers"]), /content-type/);

      const denied = await app.inject({
        method: "OPTIONS",
        url: "/v1/onboarding/bnos",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST"
        }
      });
      assert.equal(denied.headers["access-control-allow-origin"], undefined);
    } finally {
      await app.close();
      await runtime.close();
    }
  });
});
