import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { schnorr } from "@noble/curves/secp256k1.js";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import type { LightningProvider } from "../src/application/ports/lightning-provider.ts";
import { randomToken, sha256Hex } from "../src/domain/index.ts";
import { MockLightningProvider } from "../src/infrastructure/providers/mock-lightning-provider.ts";
import { createTestRuntime, intentBody, seedMerchant, type TestRuntime } from "./helpers.ts";

function nostrKey() {
  const privateKey = schnorr.utils.randomSecretKey();
  return { privateKey, pubkey: Buffer.from(schnorr.getPublicKey(privateKey)).toString("hex") };
}

function liveTestProvider(): LightningProvider {
  const mock = new MockLightningProvider();
  return {
    name: "mock-live",
    mode: "live",
    createInvoice: mock.createInvoice.bind(mock),
    verifyProof: mock.verifyProof.bind(mock),
    cancelInvoice: mock.cancelInvoice.bind(mock),
    status: mock.status.bind(mock)
  };
}

function signedNostrChallenge(
  challenge: { challenge: string; origin: string },
  key: { privateKey: Uint8Array; pubkey: string }
) {
  const event = {
    kind: 22242,
    pubkey: key.pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["relay", challenge.origin],
      ["challenge", challenge.challenge]
    ],
    content: ""
  };
  const id = sha256Hex(
    JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  );
  const signature = schnorr.sign(Buffer.from(id, "hex"), key.privateKey);
  return { ...event, id, sig: Buffer.from(signature).toString("hex") };
}

interface LoginResult {
  cookie: string;
  csrf: string;
  sessionId: string;
  merchantId: string;
  scopes: string[];
}

describe("merchant console", () => {
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

  function cookieOnly(setCookie: string | string[] | undefined): string {
    const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(value);
    return value.split(";")[0]!;
  }

  async function login(apiKey: string): Promise<LoginResult> {
    const response = await app.inject({
      method: "POST",
      url: "/console/api/session",
      headers: { "content-type": "application/json" },
      payload: { api_key: apiKey }
    });
    assert.equal(response.statusCode, 201);
    const body = response.json() as {
      id: string;
      merchant: { id: string };
      scopes: string[];
      csrf_token: string;
    };
    assert.equal(JSON.stringify(body).includes(apiKey), false);
    return {
      cookie: cookieOnly(response.headers["set-cookie"]),
      csrf: body.csrf_token,
      sessionId: body.id,
      merchantId: body.merchant.id,
      scopes: body.scopes
    };
  }

  it("creates a sandbox session cookie without returning the API key", async () => {
    const seeded = await seedMerchant(runtime);
    const response = await app.inject({
      method: "POST",
      url: "/console/api/session",
      headers: { "content-type": "application/json" },
      payload: { api_key: seeded.apiKey }
    });
    assert.equal(response.statusCode, 201);
    const setCookie = response.headers["set-cookie"];
    const cookie = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
    assert.match(cookie, /pay_console_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Secure/);
    assert.equal(JSON.stringify(response.json()).includes(seeded.apiKey), false);
  });

  it("reads the session and overview through the cookie only", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);

    const read = await app.inject({
      method: "GET",
      url: "/console/api/session",
      headers: { cookie: session.cookie }
    });
    assert.equal(read.statusCode, 200);
    const body = read.json() as {
      merchant: { id: string };
      csrf_token: string;
      scopes: string[];
    };
    assert.equal(body.merchant.id, seeded.merchantId);
    assert.ok(body.csrf_token);
    assert.ok(body.scopes.includes("payments:read"));
    assert.equal(read.headers["cache-control"], "no-store");
    assert.match(String(read.headers["content-security-policy"]), /default-src 'none'/);

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      settlement: { ledger_balanced: boolean };
      balances: unknown[];
      payments: unknown[];
      api_keys: unknown[];
      connections: Array<{
        id: string;
        provider: string;
        mode: string;
        status: string;
        selected: boolean;
      }>;
    };
    assert.equal(overviewBody.settlement.ledger_balanced, true);
    assert.ok(Array.isArray(overviewBody.balances));
    assert.equal(overviewBody.api_keys.length, 1);
    assert.equal(overviewBody.connections.length, 1);
    assert.equal(overviewBody.connections[0]!.id, seeded.providerConnectionId);
    assert.equal(overviewBody.connections[0]!.provider, "mock-lightning");
    assert.equal(overviewBody.connections[0]!.mode, "sandbox");
    assert.equal(overviewBody.connections[0]!.status, "ACTIVE");
    assert.equal(overviewBody.connections[0]!.selected, true);
    assert.equal(JSON.stringify(overviewBody).includes(seeded.apiKey), false);
    assert.equal(JSON.stringify(overviewBody).includes("credential_ref"), false);
  });

  it("invites and revokes a scoped Nostr member", async () => {
    const seeded = await seedMerchant(runtime);
    const owner = await login(seeded.apiKey);
    const memberKey = nostrKey();

    const rejected = await app.inject({
      method: "POST",
      url: "/console/api/members",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      payload: { pubkey: memberKey.pubkey, role: "CASHIER" }
    });
    assert.equal(rejected.statusCode, 403);

    const invalid = await app.inject({
      method: "POST",
      url: "/console/api/members",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
        "x-pay-csrf": owner.csrf
      },
      payload: { pubkey: memberKey.pubkey, role: "OWNER" }
    });
    assert.equal(invalid.statusCode, 400);

    const invited = await app.inject({
      method: "POST",
      url: "/console/api/members",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
        "x-pay-csrf": owner.csrf
      },
      payload: { pubkey: memberKey.pubkey, role: "CASHIER", label: "Front desk" }
    });
    assert.equal(invited.statusCode, 201);
    const member = invited.json() as {
      id: string;
      pubkey: string;
      role: string;
      label: string;
      status: string;
    };
    assert.equal(member.pubkey, memberKey.pubkey);
    assert.equal(member.role, "CASHIER");
    assert.equal(member.label, "Front desk");
    assert.equal(member.status, "ACTIVE");

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: owner.cookie }
    });
    assert.equal(overview.statusCode, 200);
    const overviewBody = overview.json() as {
      api_keys: Array<{ id: string }>;
      members: Array<{ id: string; role: string }>;
    };
    assert.equal(overviewBody.api_keys.length, 1);
    assert.equal(
      overviewBody.api_keys.some((key) => key.id === member.id),
      false
    );
    assert.equal(overviewBody.members.length, 1);
    assert.equal(overviewBody.members[0]!.role, "CASHIER");

    const challengeResponse = await app.inject({
      method: "POST",
      url: "/console/api/nostr/challenge"
    });
    const challenge = challengeResponse.json() as { challenge: string; origin: string };
    const entered = await app.inject({
      method: "POST",
      url: "/console/api/nostr/enter",
      headers: { "content-type": "application/json" },
      payload: { event: signedNostrChallenge(challenge, memberKey) }
    });
    assert.equal(entered.statusCode, 200);
    const memberBody = entered.json() as {
      scopes: string[];
      merchant: { id: string };
      csrf_token: string;
    };
    assert.equal(memberBody.merchant.id, seeded.merchantId);
    assert.deepEqual(memberBody.scopes, ["payments:read", "payments:write"]);
    const setCookie = entered.headers["set-cookie"];
    const memberCookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";")[0]!;

    const memberKeys = await app.inject({
      method: "GET",
      url: "/console/api/api-keys",
      headers: { cookie: memberCookie }
    });
    assert.equal(memberKeys.statusCode, 403);

    const revoked = await app.inject({
      method: "POST",
      url: `/console/api/members/${member.id}/revoke`,
      headers: { cookie: owner.cookie, "x-pay-csrf": owner.csrf }
    });
    assert.equal(revoked.statusCode, 200);
    assert.equal((revoked.json() as { status: string }).status, "REVOKED");

    const afterRevoke = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: memberCookie }
    });
    assert.equal(afterRevoke.statusCode, 401);

    const challengeAgain = await app.inject({
      method: "POST",
      url: "/console/api/nostr/challenge"
    });
    const enteredAgain = await app.inject({
      method: "POST",
      url: "/console/api/nostr/enter",
      headers: { "content-type": "application/json" },
      payload: {
        event: signedNostrChallenge(
          challengeAgain.json() as { challenge: string; origin: string },
          memberKey
        )
      }
    });
    assert.equal(enteredAgain.statusCode, 401);
    assert.equal(
      (enteredAgain.json() as { error: { code: string } }).error.code,
      "PAY_AUTH_REVOKED"
    );
  });

  it("pages and filters payments in the console", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    let paidHash = "";
    for (let index = 0; index < 21; index += 1) {
      const created = await runtime.services.paymentIntents.createPaymentIntent(
        seeded.auth,
        intentBody({ amount: 1000 + index, external_reference: `PAGE-${index}` }) as never,
        `console-page-intent-${index}`,
        `req-page-${index}`
      );
      if (index === 0) paidHash = created.payment.payment_hash;
    }
    await runtime.services.settlements.sandboxSettle(paidHash);

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    assert.equal(overview.statusCode, 200);
    const body = overview.json();
    assert.equal(body.payments.length, 20);
    assert.equal(body.has_more_payments, true);
    assert.ok(body.next_payment_cursor);

    const next = await app.inject({
      method: "GET",
      url: `/console/api/payments?limit=20&starting_after=${body.next_payment_cursor}`,
      headers: { cookie: session.cookie }
    });
    assert.equal(next.statusCode, 200);
    assert.equal(next.json().data.length, 1);
    assert.equal(next.json().has_more, false);

    const paid = await app.inject({
      method: "GET",
      url: "/console/api/payments?limit=20&status=SUCCEEDED",
      headers: { cookie: session.cookie }
    });
    assert.equal(paid.statusCode, 200);
    assert.equal(paid.json().data.length, 1);
    assert.equal(paid.json().data[0].status, "SUCCEEDED");
  });

  it("cancels an unpaid payment from the console", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      seeded.auth,
      intentBody({ amount: 7300 }) as never,
      "console-cancel-intent-1",
      "req-cancel"
    );
    const cancelled = await app.inject({
      method: "POST",
      url: `/console/api/payment-intents/${created.id}/cancel`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json().status, "CANCELLED");

    const again = await app.inject({
      method: "POST",
      url: `/console/api/payment-intents/${created.id}/cancel`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().error.code, "PAY_STATE_TERMINAL");
  });

  it("exports escaped payment and reconciliation CSV", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const location = await runtime.services.locations.create(seeded.auth, {
      name: "Riverside",
      code: "CSV"
    });
    await runtime.services.paymentIntents.createPaymentIntent(
      seeded.auth,
      intentBody({
        amount: 6100,
        external_reference: "=SUM(1,1)",
        location_id: location.id
      }) as never,
      "console-export-intent-1",
      "req-export"
    );
    const from = new Date(Date.now() - 60 * 60_000).toISOString();
    const to = new Date(Date.now() + 60 * 60_000).toISOString();
    await runtime.services.settlementReports.reconcile(seeded.auth, new Date(from), new Date(to));

    const payments = await app.inject({
      method: "GET",
      url: `/console/api/exports/payments.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&location_id=${location.id}`,
      headers: { cookie: session.cookie }
    });
    assert.equal(payments.statusCode, 200);
    assert.match(String(payments.headers["content-type"]), /text\/csv/);
    assert.match(String(payments.headers["content-disposition"]), /attachment; filename="bitos-pay-payments-/);
    assert.match(payments.body, /^id,created_at,status,amount_sat,amount_msat,currency,/);
    assert.match(payments.body, /"'=SUM\(1,1\)"/);
    assert.match(payments.body, new RegExp(location.id));

    const emptyRange = await app.inject({
      method: "GET",
      url: `/console/api/exports/payments.csv?from=${encodeURIComponent("2030-01-01T00:00:00.000Z")}`,
      headers: { cookie: session.cookie }
    });
    assert.equal(emptyRange.statusCode, 200);
    assert.equal(emptyRange.body.trim().split("\r\n").length, 1);

    const reconciliations = await app.inject({
      method: "GET",
      url: "/console/api/exports/reconciliations.csv",
      headers: { cookie: session.cookie }
    });
    assert.equal(reconciliations.statusCode, 200);
    assert.match(reconciliations.body, /^id,created_at,period_start,period_end,transaction_count,/);
    assert.match(reconciliations.body, /stl_/);
  });

  it("runs and lists a reconciliation from the console", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      seeded.auth,
      intentBody({ amount: 4200 }) as never,
      "console-reconcile-intent-1",
      "req-reconcile"
    );
    await runtime.services.settlements.sandboxSettle(created.payment.payment_hash);
    const from = new Date(Date.now() - 60 * 60_000).toISOString();
    const to = new Date(Date.now() + 60 * 60_000).toISOString();

    const rejected = await app.inject({
      method: "POST",
      url: "/console/api/reconciliations",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      payload: { period_start: from, period_end: to }
    });
    assert.equal(rejected.statusCode, 403);

    const stored = await app.inject({
      method: "POST",
      url: "/console/api/reconciliations",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-pay-csrf": session.csrf
      },
      payload: { period_start: from, period_end: to }
    });
    assert.equal(stored.statusCode, 201);
    const record = stored.json() as {
      id: string;
      transaction_count: number;
      ledger_balanced: boolean;
      created_at: string;
    };
    assert.match(record.id, /^stl_/);
    assert.ok(record.transaction_count >= 1);
    assert.equal(record.ledger_balanced, true);
    assert.ok(record.created_at);

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    assert.equal(overview.statusCode, 200);
    const reconciliations = overview.json().reconciliations as Array<{
      id: string;
      created_at: string;
    }>;
    assert.ok(reconciliations.some((item) => item.id === record.id));

    const invalid = await app.inject({
      method: "POST",
      url: "/console/api/reconciliations",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-pay-csrf": session.csrf
      },
      payload: { period_start: to, period_end: from }
    });
    assert.equal(invalid.statusCode, 400);
  });

  it("scopes provider routing to the signed-in organization", async () => {
    await seedMerchant(runtime, { organizationName: "Other Organization" });
    const seeded = await seedMerchant(runtime, { organizationName: "Selected Organization" });
    const session = await login(seeded.apiKey);
    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    assert.equal(overview.statusCode, 200);
    const body = overview.json() as {
      connections: Array<{ id: string; selected: boolean }>;
    };
    assert.equal(body.connections.length, 1);
    assert.equal(body.connections[0]!.id, seeded.providerConnectionId);
    assert.equal(body.connections[0]!.selected, true);
  });

  it("requires payments:read for console sign-in", async () => {
    const seeded = await seedMerchant(runtime);
    const created = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: {
        authorization: `Bearer ${seeded.apiKey}`,
        "content-type": "application/json"
      },
      payload: { scopes: ["keys:read"] }
    });
    assert.equal(created.statusCode, 201);
    const key = created.json() as { key: string };
    const response = await app.inject({
      method: "POST",
      url: "/console/api/session",
      headers: { "content-type": "application/json" },
      payload: { api_key: key.key }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "PAY_AUTH_SCOPE");
  });

  it("requires CSRF for writes and creates a payment request", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const body = {
      amount: 25000,
      currency: "SAT",
      scale: 0,
      payment_method: "lightning",
      external_reference: "CONSOLE-001",
      metadata: { memo: "Console request", source: "console" }
    };

    const rejected = await app.inject({
      method: "POST",
      url: "/console/api/payment-intents",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-payment-1"
      },
      payload: body
    });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.json().error.code, "PAY_AUTH_SCOPE");

    const created = await app.inject({
      method: "POST",
      url: "/console/api/payment-intents",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-payment-1",
        "x-pay-csrf": session.csrf
      },
      payload: body
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.json() as {
      id: string;
      payment: { invoice: string; payment_hash: string };
    };
    assert.match(createdBody.payment.invoice, /^ln/);

    const detail = await app.inject({
      method: "GET",
      url: `/console/api/payment-intents/${createdBody.id}`,
      headers: { cookie: session.cookie }
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.json() as {
      invoice: { bolt11: string; payment_hash: string };
      status: string;
    };
    assert.equal(detailBody.status, "PENDING");
    assert.equal(detailBody.invoice.payment_hash, createdBody.payment.payment_hash);

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    const payments = overview.json().payments as Array<{ id: string }>;
    assert.ok(payments.some((payment) => payment.id === createdBody.id));
  });

  it("creates and disables a webhook endpoint with CSRF", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const body = { url: "https://example.test/webhooks/pay", events: ["payment.succeeded", "refund.succeeded"] };

    const rejected = await app.inject({
      method: "POST",
      url: "/console/api/webhook-endpoints",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-webhook-1"
      },
      payload: body
    });
    assert.equal(rejected.statusCode, 403);

    const created = await app.inject({
      method: "POST",
      url: "/console/api/webhook-endpoints",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-webhook-1",
        "x-pay-csrf": session.csrf
      },
      payload: body
    });
    assert.equal(created.statusCode, 201);
    const endpoint = created.json() as { id: string; secret: string; status: string; events: string[] };
    assert.match(endpoint.secret, /^whsec_/);
    assert.equal(endpoint.status, "ACTIVE");

    const rejectedRotate = await app.inject({
      method: "POST",
      url: `/console/api/webhook-endpoints/${endpoint.id}/rotate`,
      headers: { cookie: session.cookie }
    });
    assert.equal(rejectedRotate.statusCode, 403);

    const rotated = await app.inject({
      method: "POST",
      url: `/console/api/webhook-endpoints/${endpoint.id}/rotate`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(rotated.statusCode, 200);
    const rotation = rotated.json() as {
      secret: string;
      previous_secret_expires_at: string;
    };
    assert.match(rotation.secret, /^whsec_/);
    assert.notEqual(rotation.secret, endpoint.secret);
    assert.ok(Date.parse(rotation.previous_secret_expires_at) > Date.now());

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    const webhooks = overview.json().webhooks as { endpoints: Array<{ id: string; status: string }> };
    assert.ok(webhooks.endpoints.some((item) => item.id === endpoint.id));
    assert.equal(JSON.stringify(webhooks).includes("whsec_"), false);

    const disabled = await app.inject({
      method: "POST",
      url: `/console/api/webhook-endpoints/${endpoint.id}/disable`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json().status, "DISABLED");
  });

  it("updates the merchant profile from Settings with CSRF protection", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const payload = {
      name: "Console Roasters",
      support_email: "help@example.test",
      website: "https://console.example.test"
    };
    const rejected = await app.inject({
      method: "PATCH",
      url: "/console/api/merchants/me",
      headers: { cookie: session.cookie, "content-type": "application/json" },
      payload
    });
    assert.equal(rejected.statusCode, 403);

    const updated = await app.inject({
      method: "PATCH",
      url: "/console/api/merchants/me",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-pay-csrf": session.csrf
      },
      payload
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().name, "Console Roasters");

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    assert.equal(overview.json().merchant.name, "Console Roasters");
    assert.equal(overview.json().merchant.support_email, "help@example.test");
  });

  it("creates and disables a reusable payment link from the console", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const body = {
      amount: 12000,
      currency: "SAT",
      scale: 0,
      reference: "CONSOLE-LINK-1",
      label: "Console link"
    };

    const rejected = await app.inject({
      method: "POST",
      url: "/console/api/payment-links",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-link-1"
      },
      payload: body
    });
    assert.equal(rejected.statusCode, 403);

    const created = await app.inject({
      method: "POST",
      url: "/console/api/payment-links",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-link-1",
        "x-pay-csrf": session.csrf
      },
      payload: body
    });
    assert.equal(created.statusCode, 201);
    const link = created.json() as { id: string; url: string; amount: number; status: string };
    assert.match(link.url, /\/pay\/plk_/);
    assert.equal(link.amount, 12000);
    assert.equal(link.status, "ACTIVE");

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: session.cookie }
    });
    const links = overview.json().payment_links as Array<{ id: string; url: string }>;
    assert.ok(links.some((item) => item.id === link.id));
    assert.equal(JSON.stringify(links).includes("whsec_"), false);

    const disabled = await app.inject({
      method: "POST",
      url: `/console/api/payment-links/${link.id}/disable`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json().status, "DISABLED");
  });

  it("records a sandbox refund from the console and reports the remaining amount", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const created = await runtime.services.paymentIntents.createPaymentIntent(
      seeded.auth,
      intentBody({ amount: 25000 }) as never,
      "console-refund-intent-1",
      "req-refund"
    );
    await runtime.services.settlements.sandboxSettle(created.payment.payment_hash);

    const detail = await app.inject({
      method: "GET",
      url: `/console/api/payment-intents/${created.id}`,
      headers: { cookie: session.cookie }
    });
    assert.equal(detail.statusCode, 200);
    const before = detail.json() as { refunds: unknown[]; refundable: number };
    assert.deepEqual(before.refunds, []);
    assert.equal(before.refundable, 25000);

    const rejected = await app.inject({
      method: "POST",
      url: "/console/api/refunds",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-refund-1"
      },
      payload: {
        transaction_id: (detail.json() as { transaction: { id: string } }).transaction.id,
        amount: 10000,
        reason: "partial refund"
      }
    });
    assert.equal(rejected.statusCode, 403);

    const refund = await app.inject({
      method: "POST",
      url: "/console/api/refunds",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-refund-1",
        "x-pay-csrf": session.csrf
      },
      payload: {
        transaction_id: (detail.json() as { transaction: { id: string } }).transaction.id,
        amount: 10000,
        reason: "partial refund"
      }
    });
    assert.equal(refund.statusCode, 201);
    const refundBody = refund.json() as { amount: number; status: string; payment_intent_id: string };
    assert.equal(refundBody.amount, 10000);
    assert.equal(refundBody.status, "SUCCEEDED");
    assert.equal(refundBody.payment_intent_id, created.id);

    const after = await app.inject({
      method: "GET",
      url: `/console/api/payment-intents/${created.id}`,
      headers: { cookie: session.cookie }
    });
    const updated = after.json() as { refunds: unknown[]; refundable: number };
    assert.equal(updated.refunds.length, 1);
    assert.equal(updated.refundable, 15000);

    const over = await app.inject({
      method: "POST",
      url: "/console/api/refunds",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "idempotency-key": "console-refund-over-1",
        "x-pay-csrf": session.csrf
      },
      payload: {
        transaction_id: (detail.json() as { transaction: { id: string } }).transaction.id,
        amount: 20000
      }
    });
    assert.equal(over.statusCode, 409);
    assert.equal(over.json().error.code, "PAY_REFUND_EXCEEDS");
  });

  it("links a NIP-07 signer and signs in to create an API key", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const key = nostrKey();

    const rejectedLink = await app.inject({
      method: "POST",
      url: "/console/api/nostr/link",
      headers: { cookie: session.cookie }
    });
    assert.equal(rejectedLink.statusCode, 403);

    const linkChallenge = await app.inject({
      method: "POST",
      url: "/console/api/nostr/link",
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(linkChallenge.statusCode, 200);
    const linkBody = linkChallenge.json() as { challenge: string; origin: string };
    const linkEvent = signedNostrChallenge(linkBody, key);
    const linked = await app.inject({
      method: "POST",
      url: "/console/api/nostr/link/proof",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-pay-csrf": session.csrf
      },
      payload: { event: linkEvent }
    });
    assert.equal(linked.statusCode, 200);
    assert.equal(linked.json().pubkey, key.pubkey);

    const linkedSession = await app.inject({
      method: "GET",
      url: "/console/api/session",
      headers: { cookie: session.cookie }
    });
    assert.equal(linkedSession.json().linked_nostr_pubkey, key.pubkey);
    const rotatedCsrf = linkedSession.json().csrf_token as string;

    const replay = await app.inject({
      method: "POST",
      url: "/console/api/nostr/link/proof",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-pay-csrf": rotatedCsrf
      },
      payload: { event: linkEvent }
    });
    assert.equal(replay.statusCode, 401);

    const loginChallenge = await app.inject({
      method: "POST",
      url: "/console/api/nostr/challenge"
    });
    assert.equal(loginChallenge.statusCode, 200);
    const loginBody = loginChallenge.json() as { challenge: string; origin: string };
    const loginEvent = signedNostrChallenge(loginBody, key);
    const loggedIn = await app.inject({
      method: "POST",
      url: "/console/api/nostr/login",
      headers: { "content-type": "application/json" },
      payload: { event: loginEvent }
    });
    assert.equal(loggedIn.statusCode, 201);
    const loggedInBody = loggedIn.json() as {
      id: string;
      auth_method: string;
      nostr_pubkey: string;
      csrf_token: string;
      merchant: { id: string };
    };
    assert.equal(loggedInBody.auth_method, "nostr");
    assert.equal(loggedInBody.nostr_pubkey, key.pubkey);
    assert.equal(loggedInBody.merchant.id, seeded.merchantId);

    const replayLogin = await app.inject({
      method: "POST",
      url: "/console/api/nostr/login",
      headers: { "content-type": "application/json" },
      payload: { event: loginEvent }
    });
    assert.equal(replayLogin.statusCode, 401);

    const created = await app.inject({
      method: "POST",
      url: "/console/api/api-keys",
      headers: {
        cookie: cookieOnly(loggedIn.headers["set-cookie"]),
        "content-type": "application/json",
        "x-pay-csrf": loggedInBody.csrf_token
      },
      payload: { scopes: ["payments:read"] }
    });
    assert.equal(created.statusCode, 201);
    assert.match(created.json().key, /^bp_test_/);

    const sessionRead = await app.inject({
      method: "GET",
      url: "/console/api/session",
      headers: { cookie: cookieOnly(loggedIn.headers["set-cookie"]) }
    });
    assert.equal(sessionRead.statusCode, 200);
    assert.equal(sessionRead.json().auth_method, "nostr");
    assert.equal(sessionRead.json().nostr_pubkey, key.pubkey);
    assert.equal(sessionRead.json().linked_nostr_pubkey, key.pubkey);
  });

  it("rejects an unlinked or tampered Nostr signer", async () => {
    const key = nostrKey();
    const challenge = await app.inject({
      method: "POST",
      url: "/console/api/nostr/challenge"
    });
    const body = challenge.json() as { challenge: string; origin: string };
    const event = signedNostrChallenge(body, key);
    const unlinked = await app.inject({
      method: "POST",
      url: "/console/api/nostr/login",
      headers: { "content-type": "application/json" },
      payload: { event }
    });
    assert.equal(unlinked.statusCode, 401);

    const second = await app.inject({
      method: "POST",
      url: "/console/api/nostr/challenge"
    });
    const secondBody = second.json() as { challenge: string; origin: string };
    const tampered = signedNostrChallenge(secondBody, key);
    tampered.sig = "0".repeat(128);
    const rejected = await app.inject({
      method: "POST",
      url: "/console/api/nostr/login",
      headers: { "content-type": "application/json" },
      payload: { event: tampered }
    });
    assert.equal(rejected.statusCode, 401);
  });

  it("creates, lists and revokes a scoped API key", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);

    const created = await app.inject({
      method: "POST",
      url: "/console/api/api-keys",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-pay-csrf": session.csrf
      },
      payload: { scopes: ["payments:read"] }
    });
    assert.equal(created.statusCode, 201);
    const key = created.json() as {
      id: string;
      key: string;
      key_prefix: string;
      scopes: string[];
    };
    assert.match(key.key, /^bp_test_/);
    assert.deepEqual(key.scopes, ["payments:read"]);

    const listed = await app.inject({
      method: "GET",
      url: "/console/api/api-keys",
      headers: { cookie: session.cookie }
    });
    const data = listed.json().data as Array<{ id: string; key?: string }>;
    assert.ok(data.some((item) => item.id === key.id));
    assert.equal(data.some((item) => "key" in item), false);

    const revoked = await app.inject({
      method: "POST",
      url: `/console/api/api-keys/${key.id}/revoke`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(revoked.statusCode, 200);
    assert.equal(revoked.json().status, "REVOKED");

    const current = await app.inject({
      method: "POST",
      url: `/console/api/api-keys/${session.sessionId}/revoke`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(current.statusCode, 404);
  });

  it("rotates a scoped console key without returning the secret in listings", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    const created = await app.inject({
      method: "POST",
      url: "/console/api/api-keys",
      headers: {
        cookie: session.cookie,
        "content-type": "application/json",
        "x-pay-csrf": session.csrf
      },
      payload: { scopes: ["payments:read"] }
    });
    assert.equal(created.statusCode, 201);
    const oldKey = created.json() as { id: string; key: string };

    const rotated = await app.inject({
      method: "POST",
      url: `/console/api/api-keys/${oldKey.id}/rotate`,
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(rotated.statusCode, 201);
    const newKey = rotated.json() as {
      id: string;
      key: string;
      scopes: string[];
      status: string;
    };
    assert.notEqual(newKey.id, oldKey.id);
    assert.match(newKey.key, /^bp_test_/);
    assert.deepEqual(newKey.scopes, ["payments:read"]);
    assert.equal(newKey.status, "ACTIVE");

    const oldLogin = await app.inject({
      method: "POST",
      url: "/console/api/session",
      headers: { "content-type": "application/json" },
      payload: { api_key: oldKey.key }
    });
    assert.notEqual(oldLogin.statusCode, 201);

    const listed = await app.inject({
      method: "GET",
      url: "/console/api/api-keys",
      headers: { cookie: session.cookie }
    });
    const data = listed.json().data as Array<{
      id: string;
      status: string;
      key?: string;
    }>;
    assert.equal(data.some((item) => "key" in item), false);
    assert.equal(data.find((item) => item.id === oldKey.id)?.status, "REVOKED");
    assert.equal(data.find((item) => item.id === newKey.id)?.status, "ACTIVE");
  });

  it("reports the configured console mode", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/console/api/config"
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const body = response.json() as {
      mode: string;
      default_mode: string;
      modes: string[];
      toggle: boolean;
      onboarding_enabled: boolean;
    };
    assert.equal(body.mode, "sandbox");
    assert.equal(body.default_mode, "sandbox");
    assert.deepEqual(body.modes, ["sandbox"]);
    assert.equal(body.toggle, false);
  });

  it("enables the live toggle and creates a live intent through the console API", async () => {
    const liveRuntime = await createTestRuntime(
      {
        consoleMode: "both",
        liveEnabled: true,
        lightningProvider: "blink"
      },
      { liveProvider: liveTestProvider() }
    );
    const liveApp = await createApp(liveRuntime.dependencies, { logger: false });
    try {
      const config = await liveApp.inject({ method: "GET", url: "/console/api/config" });
      assert.equal(config.statusCode, 200);
      const configBody = config.json() as {
        modes: string[];
        default_mode: string;
        toggle: boolean;
      };
      assert.deepEqual(configBody.modes, ["sandbox", "live"]);
      assert.equal(configBody.default_mode, "sandbox");
      assert.equal(configBody.toggle, true);

      const live = await seedMerchant(liveRuntime, { livemode: true });
      const liveLogin = await liveApp.inject({
        method: "POST",
        url: "/console/api/session",
        headers: { "content-type": "application/json" },
        payload: { api_key: live.apiKey, mode: "live" }
      });
      assert.equal(liveLogin.statusCode, 201);
      const liveSession = liveLogin.json() as {
        livemode: boolean;
        csrf_token: string;
      };
      assert.equal(liveSession.livemode, true);
      const liveCookie = cookieOnly(liveLogin.headers["set-cookie"]);

      const created = await liveApp.inject({
        method: "POST",
        url: "/console/api/payment-intents",
        headers: {
          cookie: liveCookie,
          "content-type": "application/json",
          "x-pay-csrf": liveSession.csrf_token,
          "idempotency-key": "console-live-intent-0001"
        },
        payload: intentBody()
      });
      assert.equal(created.statusCode, 201);
      assert.equal(created.json().livemode, true);

      const sandbox = await seedMerchant(liveRuntime);
      const rejected = await liveApp.inject({
        method: "POST",
        url: "/console/api/session",
        headers: { "content-type": "application/json" },
        payload: { api_key: sandbox.apiKey, mode: "live" }
      });
      assert.equal(rejected.statusCode, 403);
      assert.equal(rejected.json().error.code, "PAY_AUTH_SCOPE");

      const sandboxLogin = await liveApp.inject({
        method: "POST",
        url: "/console/api/session",
        headers: { "content-type": "application/json" },
        payload: { api_key: sandbox.apiKey, mode: "sandbox" }
      });
      assert.equal(sandboxLogin.statusCode, 201);
      assert.equal(sandboxLogin.json().livemode, false);

      const sandboxIdentity = await liveRuntime.repositories.consoleNostrIdentities.create({
        id: "nid_live_console_mismatch",
        merchantId: sandbox.merchantId,
        organizationId: sandbox.organizationId,
        apiKeyId: sandbox.auth.apiKeyId,
        pubkey: "a".repeat(64),
        now: new Date()
      });
      await assert.rejects(
        liveRuntime.services.consoleSessions.loginNostr(sandboxIdentity, "live"),
        /not live/
      );
    } finally {
      await liveApp.close();
      await liveRuntime.close();
    }
  });

  it("rejects live keys and expired sessions", async () => {
    const liveMerchant = await seedMerchant(runtime);
    const liveKey = randomToken("bp_live_", 32);
    await runtime.db.query(
      `INSERT INTO public.api_keys
        (id, merchant_id, key_prefix, key_hash, scopes, livemode, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',now())`,
      [
        "key_live_console_test",
        liveMerchant.merchantId,
        liveKey.slice(0, 20),
        sha256Hex(liveKey),
        JSON.stringify(["payments:read"]),
        true
      ]
    );
    const liveLogin = await app.inject({
      method: "POST",
      url: "/console/api/session",
      headers: { "content-type": "application/json" },
      payload: { api_key: liveKey }
    });
    assert.equal(liveLogin.statusCode, 403);
    assert.equal(liveLogin.json().error.code, "PAY_AUTH_SCOPE");

    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    await runtime.db.query(
      `UPDATE public.console_sessions SET created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' WHERE id = $1`,
      [session.sessionId]
    );
    const expired = await app.inject({
      method: "GET",
      url: "/console/api/session",
      headers: { cookie: session.cookie }
    });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.json().error.code, "PAY_AUTH_REVOKED");
  });

  it("fails closed when the session API key is revoked", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);
    await runtime.db.query(`UPDATE public.api_keys SET status = 'REVOKED' WHERE id = $1`, [
      seeded.auth.apiKeyId
    ]);
    const response = await app.inject({
      method: "GET",
      url: "/console/api/session",
      headers: { cookie: session.cookie }
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "PAY_AUTH_REVOKED");
  });

  it("revokes the session on logout", async () => {
    const seeded = await seedMerchant(runtime);
    const session = await login(seeded.apiKey);

    const logout = await app.inject({
      method: "DELETE",
      url: "/console/api/session",
      headers: { cookie: session.cookie, "x-pay-csrf": session.csrf }
    });
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/console/api/session",
      headers: { cookie: session.cookie }
    });
    assert.equal(afterLogout.statusCode, 401);
  });

  it("publishes signer methods and gates nsec/remote by configuration", async () => {
    const defaults = await app.inject({ method: "GET", url: "/console/api/nostr/config" });
    assert.equal(defaults.statusCode, 200);
    assert.deepEqual(defaults.json(), {
      object: "nostr_config",
      nip07: true,
      nsec: false,
      remote: false,
      relay: null
    });

    const enabledRuntime = await createTestRuntime({
      consoleNsecEnabled: true,
      consoleNostrRelay: "wss://relay.example"
    });
    const enabledApp = await createApp(enabledRuntime.dependencies, { logger: false });
    try {
      const config = await enabledApp.inject({ method: "GET", url: "/console/api/nostr/config" });
      assert.deepEqual(config.json(), {
        object: "nostr_config",
        nip07: true,
        nsec: true,
        remote: true,
        relay: "wss://relay.example"
      });
      const page = await enabledApp.inject({ method: "GET", url: "/console/" });
      const csp = String(page.headers["content-security-policy"]);
      assert.match(csp, /worker-src 'self'/);
      assert.match(csp, /connect-src 'self' wss:\/\/relay\.example/);
    } finally {
      await enabledApp.close();
      await enabledRuntime.close();
    }
  });

  it("serves the console page with a script-src self CSP", async () => {
    const response = await app.inject({ method: "GET", url: "/console/" });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-security-policy"]), /script-src 'self'/);
    assert.match(String(response.headers["content-security-policy"]), /worker-src 'self'/);
    assert.match(response.body, /id="loginForm"/);
    assert.match(response.body, /id="envToggle"/);
    assert.match(response.body, /data-console-mode="live"/);
    assert.doesNotMatch(response.body, /<script>/);
  });
});

describe("console Nostr sign-in or create", () => {
  let runtime: TestRuntime;
  let app: FastifyInstance;

  before(async () => {
    runtime = await createTestRuntime({ onboardingEnabled: true });
    app = await createApp(runtime.dependencies, { logger: false });
  });

  after(async () => {
    await app.close();
    await runtime.close();
  });

  function cookieOnly(setCookie: string | string[] | undefined): string {
    const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    assert.ok(value);
    return value.split(";")[0]!;
  }

  async function challengeEvent(key: { privateKey: Uint8Array; pubkey: string }) {
    const challenge = await app.inject({
      method: "POST",
      url: "/console/api/nostr/challenge"
    });
    assert.equal(challenge.statusCode, 200);
    return signedNostrChallenge(
      challenge.json() as { challenge: string; origin: string },
      key
    );
  }

  it("creates a sandbox account, identity and session for a new key", async () => {
    const key = nostrKey();
    const event = await challengeEvent(key);
    const entered = await app.inject({
      method: "POST",
      url: "/console/api/nostr/enter",
      headers: { "content-type": "application/json" },
      payload: {
        event,
        organization_name: "Nostr Test Org",
        merchant_name: "Nostr Test Merchant"
      }
    });
    assert.equal(entered.statusCode, 201);
    const body = entered.json() as {
      id: string;
      merchant: { id: string; name: string };
      auth_method: string;
      nostr_pubkey: string;
      csrf_token: string;
      created: boolean;
      api_key: string | null;
    };
    assert.equal(body.created, true);
    assert.match(body.api_key ?? "", /^bp_test_/);
    assert.equal(body.auth_method, "nostr");
    assert.equal(body.nostr_pubkey, key.pubkey);
    assert.equal(body.merchant.name, "Nostr Test Merchant");
    const cookie = cookieOnly(entered.headers["set-cookie"]);

    const overview = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie }
    });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.json().merchant.name, "Nostr Test Merchant");

    const createdKey = await app.inject({
      method: "POST",
      url: "/console/api/api-keys",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-pay-csrf": body.csrf_token
      },
      payload: { scopes: ["payments:read", "payments:write"] }
    });
    assert.equal(createdKey.statusCode, 201);
    assert.match(createdKey.json().key, /^bp_test_/);

    const repeat = await challengeEvent(key);
    const second = await app.inject({
      method: "POST",
      url: "/console/api/nostr/enter",
      headers: { "content-type": "application/json" },
      payload: { event: repeat }
    });
    assert.equal(second.statusCode, 200);
    const secondBody = second.json() as {
      merchant: { id: string };
      created: boolean;
      api_key: string | null;
    };
    assert.equal(secondBody.created, false);
    assert.equal(secondBody.api_key, null);
    assert.equal(secondBody.merchant.id, body.merchant.id);
  });

  it("claims an existing owner-key organization without creating another", async () => {
    const key = nostrKey();
    const seeded = await runtime.services.provisioning.bootstrapMerchant({
      organizationName: "Legacy Owner Org",
      merchantName: "Legacy Owner Shop",
      ownerPubkey: key.pubkey
    });
    const event = await challengeEvent(key);
    const entered = await app.inject({
      method: "POST",
      url: "/console/api/nostr/enter",
      headers: { "content-type": "application/json" },
      payload: { event }
    });
    assert.equal(entered.statusCode, 200);
    const body = entered.json() as {
      merchant: { id: string };
      created: boolean;
      api_key: string | null;
      auth_method: string;
    };
    assert.equal(body.created, false);
    assert.equal(body.api_key, null);
    assert.equal(body.auth_method, "nostr");
    assert.equal(body.merchant.id, seeded.merchantId);
  });

  it("does not create when onboarding is disabled", async () => {
    const closed = await createTestRuntime();
    const closedApp = await createApp(closed.dependencies, { logger: false });
    try {
      const key = nostrKey();
      const challenge = await closedApp.inject({
        method: "POST",
        url: "/console/api/nostr/challenge"
      });
      const event = signedNostrChallenge(
        challenge.json() as { challenge: string; origin: string },
        key
      );
      const response = await closedApp.inject({
        method: "POST",
        url: "/console/api/nostr/enter",
        headers: { "content-type": "application/json" },
        payload: { event }
      });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, "PAY_AUTH_INVALID");
    } finally {
      await closedApp.close();
      await closed.close();
    }
  });
});
