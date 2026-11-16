import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import { createTestRuntime, intentBody, seedMerchant, type TestRuntime } from "./helpers.ts";

describe("API key monitoring, merchant health & audit logs", () => {
  let runtime: TestRuntime;
  let app: FastifyInstance;
  let primaryKey: string;
  let otherKey: string;

  before(async () => {
    runtime = await createTestRuntime();
    const m1 = await seedMerchant(runtime, { merchantName: "Monitor Merchant 1" });
    const m2 = await seedMerchant(runtime, { merchantName: "Monitor Merchant 2" });
    primaryKey = m1.apiKey;
    otherKey = m2.apiKey;
    app = await createApp(runtime.dependencies, { logger: false });
  });

  after(async () => {
    await app.close();
    await runtime.close();
  });

  it("creates labeled keys, updates labels, preserves label on rotate, and tracks telemetry", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: {
        authorization: `Bearer ${primaryKey}`,
        "content-type": "application/json"
      },
      payload: {
        label: "BNOS Checkout",
        scopes: ["payments:read"],
        expires_in_days: 3
      }
    });
    assert.equal(createRes.statusCode, 201);
    const created = createRes.json() as { id: string; key: string; label: string | null };
    assert.equal(created.label, "BNOS Checkout");

    // Trigger 1 success (200) and 1 scope error (403) using the new key
    const okRes = await app.inject({
      method: "GET",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${created.key}` }
    });
    assert.equal(okRes.statusCode, 200);

    const forbiddenRes = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        authorization: `Bearer ${created.key}`,
        "content-type": "application/json",
        "idempotency-key": "mon-forbidden-1"
      },
      payload: intentBody()
    });
    assert.equal(forbiddenRes.statusCode, 403);

    // Rename label
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/v1/api-keys/${created.id}`,
      headers: {
        authorization: `Bearer ${primaryKey}`,
        "content-type": "application/json"
      },
      payload: { label: "BNOS Checkout v2" }
    });
    assert.equal(patchRes.statusCode, 200);
    assert.equal((patchRes.json() as { label: string | null }).label, "BNOS Checkout v2");

    // Read telemetry
    const telRes = await app.inject({
      method: "GET",
      url: `/v1/api-keys/${created.id}/telemetry?hours=24`,
      headers: { authorization: `Bearer ${primaryKey}` }
    });
    assert.equal(telRes.statusCode, 200);
    const telemetry = telRes.json() as {
      key: { id: string; label: string | null };
      totals: {
        total_count: number;
        success_count: number;
        auth_error_count: number;
        last_endpoint: string | null;
      };
      recent_audit: Array<{ action: string }>;
    };
    assert.equal(telemetry.key.label, "BNOS Checkout v2");
    assert.equal(telemetry.totals.total_count, 2);
    assert.equal(telemetry.totals.success_count, 1);
    assert.equal(telemetry.totals.auth_error_count, 1);
    assert.equal(telemetry.totals.last_endpoint, "/v1/payment-intents");
    assert.ok(telemetry.recent_audit.some((a) => a.action === "api_key.label_update"));

    // Cross-tenant access must return 404
    const crossTenantTel = await app.inject({
      method: "GET",
      url: `/v1/api-keys/${created.id}/telemetry`,
      headers: { authorization: `Bearer ${otherKey}` }
    });
    assert.equal(crossTenantTel.statusCode, 404);

    // Rotate preserves label
    const rotateRes = await app.inject({
      method: "POST",
      url: `/v1/api-keys/${created.id}/rotate`,
      headers: { authorization: `Bearer ${primaryKey}` }
    });
    assert.equal(rotateRes.statusCode, 201);
    assert.equal((rotateRes.json() as { label: string | null }).label, "BNOS Checkout v2");
  });

  it("reports merchant health, risk limits, and org-scoped audit logs", async () => {
    const intentRes = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        authorization: `Bearer ${primaryKey}`,
        "content-type": "application/json",
        "idempotency-key": "mon-health-intent-1"
      },
      payload: intentBody({ amount: 500 })
    });
    assert.equal(intentRes.statusCode, 201);

    const healthRes = await app.inject({
      method: "GET",
      url: "/v1/merchants/me/health",
      headers: { authorization: `Bearer ${primaryKey}` }
    });
    assert.equal(healthRes.statusCode, 200);
    const health = healthRes.json() as {
      merchant_status: string;
      risk: {
        day_volume_sat: number;
        daily_volume_limit_sat: number;
        minute_count: number;
        max_payments_per_minute: number;
      };
      alerts: {
        expiring_keys: number;
        quarantined_payments: number;
        dead_webhooks: number;
      };
    };
    assert.equal(health.merchant_status, "ACTIVE");
    assert.ok(health.risk.day_volume_sat >= 500);
    assert.ok(health.risk.daily_volume_limit_sat > 0);
    assert.ok(health.risk.minute_count >= 1);
    assert.ok(health.alerts.expiring_keys >= 1);

    const auditRes = await app.inject({
      method: "GET",
      url: "/v1/audit-logs?action_prefix=api_key.&limit=20",
      headers: { authorization: `Bearer ${primaryKey}` }
    });
    assert.equal(auditRes.statusCode, 200);
    const auditBody = auditRes.json() as { data: Array<{ action: string }> };
    assert.ok(auditBody.data.length >= 2);
    assert.ok(auditBody.data.every((entry) => entry.action.startsWith("api_key.")));
  });
});
