import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import { createTestRuntime, seedMerchant, type TestRuntime } from "./helpers.ts";

async function runtimeWithApp() {
  const runtime = await createTestRuntime();
  const app = await createApp(runtime.dependencies, { logger: false });
  return { runtime, app };
}

async function close(app: FastifyInstance, runtime: TestRuntime) {
  await app.close();
  await runtime.close();
}

function auth(apiKey: string) {
  return { authorization: `Bearer ${apiKey}` };
}

describe("organization plans and entitlements", () => {
  it("lists plans and defaults an organization to the free entitlement", async () => {
    const { runtime, app } = await runtimeWithApp();
    try {
      const seeded = await seedMerchant(runtime);
      const plans = await app.inject({ method: "GET", url: "/v1/plans" });
      assert.equal(plans.statusCode, 200);
      const codes = (plans.json().data as Array<{ code: string }>).map((plan) => plan.code);
      assert.deepEqual(codes, ["workspace_free", "workspace_pro", "workspace_business"]);

      const entitlement = await app.inject({
        method: "GET",
        url: "/v1/entitlements/current",
        headers: auth(seeded.apiKey)
      });
      assert.equal(entitlement.statusCode, 200);
      assert.equal(entitlement.json().plan, "workspace_free");
      assert.equal(entitlement.json().source, "default_free");
      assert.deepEqual(entitlement.json().features, ["core"]);
    } finally {
      await close(app, runtime);
    }
  });

  it("creates a pending subscription invoice without activating features", async () => {
    const { runtime, app } = await runtimeWithApp();
    try {
      const seeded = await seedMerchant(runtime);
      const created = await app.inject({
        method: "POST",
        url: "/v1/subscriptions",
        headers: { ...auth(seeded.apiKey), "content-type": "application/json" },
        payload: { plan_code: "workspace_pro" }
      });
      assert.equal(created.statusCode, 201);
      const body = created.json();
      assert.equal(body.status, "PENDING_PAYMENT");
      assert.match(body.invoice.bolt11, /^lnbcrt/);
      assert.equal(body.invoice.amount_msat, "10000000");

      const entitlement = await app.inject({
        method: "GET",
        url: "/v1/entitlements/current",
        headers: auth(seeded.apiKey)
      });
      assert.equal(entitlement.json().plan, "workspace_free");
      assert.equal(entitlement.json().status, "ACTIVE");
    } finally {
      await close(app, runtime);
    }
  });

  it("activates a subscription only after the sandbox provider proof", async () => {
    const { runtime, app } = await runtimeWithApp();
    try {
      const seeded = await seedMerchant(runtime);
      const created = await app.inject({
        method: "POST",
        url: "/v1/subscriptions",
        headers: { ...auth(seeded.apiKey), "content-type": "application/json" },
        payload: { plan_code: "workspace_pro" }
      });
      const subscriptionId = created.json().id as string;

      const missingToken = await app.inject({
        method: "POST",
        url: `/v1/sandbox/subscriptions/${subscriptionId}/settle`,
        headers: auth(seeded.apiKey)
      });
      assert.equal(missingToken.statusCode, 401);

      const settled = await app.inject({
        method: "POST",
        url: `/v1/sandbox/subscriptions/${subscriptionId}/settle`,
        headers: { ...auth(seeded.apiKey), "x-sandbox-token": "sandbox-test-token" }
      });
      assert.equal(settled.statusCode, 200);
      assert.equal(settled.json().subscription.status, "ACTIVE");
      assert.equal(settled.json().entitlement.plan, "workspace_pro");
      assert.equal(settled.json().entitlement.source, "subscription");
      assert.equal(settled.json().entitlement.features.includes("audit_export"), true);

      const current = await app.inject({
        method: "GET",
        url: "/v1/entitlements/current",
        headers: auth(seeded.apiKey)
      });
      assert.equal(current.json().plan, "workspace_pro");
      assert.equal(current.json().revision, 1);

      const audit = await runtime.db.query<{ action: string }>(
        "SELECT action FROM audit_logs WHERE target_ref = $1 ORDER BY occurred_at",
        [subscriptionId]
      );
      assert.deepEqual(
        audit.rows.map((row) => row.action),
        ["subscription.created", "subscription.activated"]
      );
    } finally {
      await close(app, runtime);
    }
  });

  it("does not let another merchant settle or read the subscription", async () => {
    const { runtime, app } = await runtimeWithApp();
    try {
      const first = await seedMerchant(runtime, { organizationName: "First" });
      const second = await seedMerchant(runtime, { organizationName: "Second" });
      const created = await app.inject({
        method: "POST",
        url: "/v1/subscriptions",
        headers: { ...auth(first.apiKey), "content-type": "application/json" },
        payload: { plan_code: "workspace_business" }
      });
      const settled = await app.inject({
        method: "POST",
        url: `/v1/sandbox/subscriptions/${created.json().id}/settle`,
        headers: { ...auth(second.apiKey), "x-sandbox-token": "sandbox-test-token" }
      });
      assert.equal(settled.statusCode, 404);
      assert.equal(settled.json().error.code, "PAY_NOT_FOUND_SUBSCRIPTION");
    } finally {
      await close(app, runtime);
    }
  });

  it("exposes and activates a plan through the console session", async () => {
    const { runtime, app } = await runtimeWithApp();
    try {
      const seeded = await seedMerchant(runtime);
      const login = await app.inject({
        method: "POST",
        url: "/console/api/session",
        headers: { "content-type": "application/json" },
        payload: { api_key: seeded.apiKey }
      });
      assert.equal(login.statusCode, 201);
      const setCookie = login.headers["set-cookie"];
      const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";")[0]!;
      const csrf = login.json().csrf_token as string;

      const overview = await app.inject({
        method: "GET",
        url: "/console/api/overview",
        headers: { cookie }
      });
      assert.equal(overview.statusCode, 200);
      assert.equal(overview.json().entitlement.plan, "workspace_free");
      assert.equal(overview.json().plans.length, 3);

      const created = await app.inject({
        method: "POST",
        url: "/console/api/subscriptions",
        headers: { cookie, "content-type": "application/json", "x-pay-csrf": csrf },
        payload: { plan_code: "workspace_business" }
      });
      assert.equal(created.statusCode, 201);

      const missingCsrf = await app.inject({
        method: "POST",
        url: `/console/api/subscriptions/${created.json().id}/settle`,
        headers: { cookie }
      });
      assert.equal(missingCsrf.statusCode, 403);

      const settled = await app.inject({
        method: "POST",
        url: `/console/api/subscriptions/${created.json().id}/settle`,
        headers: { cookie, "x-pay-csrf": csrf }
      });
      assert.equal(settled.statusCode, 200);
      assert.equal(settled.json().entitlement.plan, "workspace_business");
    } finally {
      await close(app, runtime);
    }
  });

  it("refuses a subscription for the free plan", async () => {
    const { runtime, app } = await runtimeWithApp();
    try {
      const seeded = await seedMerchant(runtime);
      const response = await app.inject({
        method: "POST",
        url: "/v1/subscriptions",
        headers: { ...auth(seeded.apiKey), "content-type": "application/json" },
        payload: { plan_code: "workspace_free" }
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "PAY_VALIDATION_BODY");
    } finally {
      await close(app, runtime);
    }
  });
});
