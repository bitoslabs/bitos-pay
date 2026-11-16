import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { createApp } from "../src/api/app.ts";
import { createTestRuntime, intentBody, seedMerchant, type TestRuntime } from "./helpers.ts";

describe("core API features", () => {
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

  const auth = () => ({ authorization: `Bearer ${apiKey}` });

  it("creates an invoice directly, reads it, and replays idempotently", async () => {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-invoice-0001"
      },
      payload: intentBody({ external_reference: "INVOICE-001" })
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as {
      id: string;
      payment_intent_id: string;
      payment_hash: string;
      status: string;
      invoice: string;
      checkout_url: string;
    };
    assert.equal(created.status, "ISSUED");
    assert.match(created.checkout_url, /^http:\/\/127\.0\.0\.1\/checkout\/pcl_/);
    assert.ok(created.id.startsWith("in_"));
    assert.ok(created.payment_intent_id.startsWith("pi_"));
    assert.ok(created.invoice.startsWith("lnbc"));

    const replay = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-invoice-0001"
      },
      payload: intentBody({ external_reference: "INVOICE-001" })
    });
    assert.equal(replay.statusCode, 201);
    assert.equal((replay.json() as { id: string }).id, created.id);

    const read = await app.inject({
      method: "GET",
      url: `/v1/invoices/${created.id}`,
      headers: auth()
    });
    assert.equal(read.statusCode, 200);
    assert.equal((read.json() as { payment_hash: string }).payment_hash, created.payment_hash);
  });

  it("serves a safe public checkout view and reports provider settlement", async () => {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-checkout-0001"
      },
      payload: intentBody({ amount: 4321, external_reference: "CHECKOUT-0001" })
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as {
      id: string;
      checkout_url: string;
      payment: { payment_hash: string };
    };
    assert.match(created.checkout_url, /^http:\/\/127\.0\.0\.1\/checkout\/pcl_/);
    const checkoutPath = new URL(created.checkout_url).pathname;

    const authorizedView = await app.inject({
      method: "GET",
      url: `/v1/payment-intents/${created.id}`,
      headers: auth()
    });
    assert.equal(authorizedView.statusCode, 200);
    assert.equal(
      (authorizedView.json() as { checkout_url: string }).checkout_url,
      created.checkout_url
    );

    const page = await app.inject({ method: "GET", url: checkoutPath });
    assert.equal(page.statusCode, 200);
    assert.match(page.headers["content-security-policy"] as string, /connect-src 'self'/);
    assert.equal(page.headers["cache-control"], "no-store");

    const publicResponse = await app.inject({ method: "GET", url: `/v1${checkoutPath}` });
    assert.equal(publicResponse.statusCode, 200);
    const publicCheckout = publicResponse.json() as Record<string, any>;
    assert.equal(publicCheckout.object, "checkout");
    assert.equal(publicCheckout.amount, 4321);
    assert.equal(publicCheckout.status, "PENDING");
    assert.equal(publicCheckout.merchant.name.length > 0, true);
    assert.ok(publicCheckout.invoice.bolt11.startsWith("lnbc"));
    assert.equal(publicCheckout.transaction, null);
    const serialized = JSON.stringify(publicCheckout);
    for (const forbidden of ["merchant_id", "organization_id", "metadata", "provider_connection_id"]) {
      assert.equal(serialized.includes(forbidden), false, `public checkout leaked ${forbidden}`);
    }

    const checkoutSignatureStart = checkoutPath.indexOf(".") + 1;
    const tampered =
      checkoutPath.slice(0, checkoutSignatureStart) +
      (checkoutPath[checkoutSignatureStart] === "A" ? "B" : "A") +
      checkoutPath.slice(checkoutSignatureStart + 1);
    const rejected = await app.inject({ method: "GET", url: `/v1${tampered}` });
    assert.equal(rejected.statusCode, 404);

    const settled = await app.inject({
      method: "POST",
      url: `/v1/sandbox/invoices/${created.payment.payment_hash}/settle`,
      headers: { "x-sandbox-token": runtime.config.sandboxToken ?? "" }
    });
    assert.equal(settled.statusCode, 200);

    const paidResponse = await app.inject({ method: "GET", url: `/v1${checkoutPath}` });
    assert.equal(paidResponse.statusCode, 200);
    const paid = paidResponse.json() as {
      status: string;
      paid_at: string | null;
      transaction: { status: string } | null;
    };
    assert.equal(paid.status, "SUCCEEDED");
    assert.ok(paid.paid_at);
    assert.equal(paid.transaction?.status, "SETTLED");
  });

  it("creates a reusable payment link and a fresh checkout per customer", async () => {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/payment-links",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-link-0001"
      },
      payload: {
        amount: 3333,
        currency: "SAT",
        scale: 0,
        reference: "LINK-ORDER-1",
        label: "Coffee tasting"
      }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as {
      id: string;
      url: string;
      amount: number;
      status: string;
    };
    assert.match(created.url, /^http:\/\/127\.0\.0\.1\/pay\/plk_/);
    assert.equal(created.amount, 3333);
    assert.equal(created.status, "ACTIVE");

    const replay = await app.inject({
      method: "POST",
      url: "/v1/payment-links",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-link-0001"
      },
      payload: {
        amount: 3333,
        currency: "SAT",
        scale: 0,
        reference: "LINK-ORDER-1",
        label: "Coffee tasting"
      }
    });
    assert.equal(replay.json().id, created.id);

    const list = await app.inject({ method: "GET", url: "/v1/payment-links", headers: auth() });
    assert.equal(list.statusCode, 200);
    assert.ok((list.json().data as Array<{ id: string }>).some((link) => link.id === created.id));

    const tokenPath = new URL(created.url).pathname;
    const token = tokenPath.split("/").at(-1) ?? "";
    const page = await app.inject({ method: "GET", url: tokenPath });
    assert.equal(page.statusCode, 200);
    assert.equal(page.headers["cache-control"], "no-store");

    const publicLink = await app.inject({
      method: "GET",
      url: `/v1/payment-links/${token}`
    });
    assert.equal(publicLink.statusCode, 200);
    const publicBody = publicLink.json() as Record<string, unknown>;
    assert.equal(publicBody.object, "payment_link");
    assert.equal(publicBody.amount, 3333);
    assert.equal((publicBody.merchant as { name: string }).name.length > 0, true);
    assert.equal(JSON.stringify(publicBody).includes("merchant_id"), false);

    const first = await app.inject({
      method: "POST",
      url: `/v1/payment-links/${token}/checkout`,
      headers: { "idempotency-key": "public-link-checkout-1" }
    });
    assert.equal(first.statusCode, 201);
    const firstBody = first.json() as { payment_id: string; checkout_url: string; status: string };
    assert.ok(firstBody.payment_id.startsWith("pi_"));
    assert.match(firstBody.checkout_url, /\/checkout\/pcl_/);
    assert.equal(firstBody.status, "PENDING");

    const replayCheckout = await app.inject({
      method: "POST",
      url: `/v1/payment-links/${token}/checkout`,
      headers: { "idempotency-key": "public-link-checkout-1" }
    });
    assert.equal(replayCheckout.json().payment_id, firstBody.payment_id);

    const second = await app.inject({
      method: "POST",
      url: `/v1/payment-links/${token}/checkout`,
      headers: { "idempotency-key": "public-link-checkout-2" }
    });
    assert.equal(second.statusCode, 201);
    assert.notEqual(second.json().payment_id, firstBody.payment_id);

    const signatureStart = token.indexOf(".") + 1;
    const tampered =
      token.slice(0, signatureStart) +
      (token[signatureStart] === "A" ? "B" : "A") +
      token.slice(signatureStart + 1);
    assert.equal(
      (await app.inject({ method: "GET", url: `/v1/payment-links/${tampered}` })).statusCode,
      404
    );

    const disabled = await app.inject({
      method: "POST",
      url: `/v1/payment-links/${created.id}/disable`,
      headers: auth()
    });
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json().status, "DISABLED");
    assert.equal(
      (await app.inject({ method: "GET", url: `/v1/payment-links/${token}` })).statusCode,
      404
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/payment-links/${token}/checkout`,
          headers: { "idempotency-key": "public-link-checkout-3" }
        })
      ).statusCode,
      404
    );
  });

  it("updates the merchant profile with the merchants:write scope", async () => {
    const updatedResponse = await app.inject({
      method: "PATCH",
      url: "/v1/merchants/me",
      headers: { ...auth(), "content-type": "application/json" },
      payload: {
        name: "Mekong Roasters",
        support_email: "support@example.test",
        website: "https://example.test"
      }
    });
    assert.equal(updatedResponse.statusCode, 200);
    const updated = updatedResponse.json() as {
      name: string;
      support_email: string;
      website: string;
      status: string;
    };
    assert.equal(updated.name, "Mekong Roasters");
    assert.equal(updated.support_email, "support@example.test");
    assert.equal(updated.website, "https://example.test/");
    assert.equal(updated.status, "ACTIVE");

    const read = await app.inject({ method: "GET", url: "/v1/merchants/me", headers: auth() });
    assert.equal(read.json().name, "Mekong Roasters");
    assert.equal(read.json().website, "https://example.test/");

    const invalid = await app.inject({
      method: "PATCH",
      url: "/v1/merchants/me",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { name: "Mekong Roasters", website: "javascript:alert(1)" }
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error.code, "PAY_VALIDATION_BODY");

    const limitedAuth = {
      ...(await runtime.services.auth.authenticate(`Bearer ${apiKey}`)),
      scopes: ["payments:read"]
    };
    await assert.rejects(
      runtime.services.merchantProfiles.update(limitedAuth, { name: "Denied" }),
      (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "PAY_AUTH_SCOPE"
    );
  });

  it("paginates and filters payments without duplicates", async () => {
    for (let index = 1; index <= 3; index += 1) {
      await app.inject({
        method: "POST",
        url: "/v1/payment-intents",
        headers: {
          ...auth(),
          "content-type": "application/json",
          "idempotency-key": `core-page-000${index}`
        },
        payload: intentBody({ external_reference: `PAGE-${index}` })
      });
    }

    const first = await app.inject({
      method: "GET",
      url: "/v1/payments?limit=2",
      headers: auth()
    });
    assert.equal(first.statusCode, 200);
    const firstPage = first.json() as {
      data: Array<{ id: string }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    assert.equal(firstPage.data.length, 2);
    assert.equal(firstPage.has_more, true);
    assert.ok(firstPage.next_cursor);

    const second = await app.inject({
      method: "GET",
      url: `/v1/payments?limit=2&starting_after=${firstPage.next_cursor}`,
      headers: auth()
    });
    const secondPage = second.json() as { data: Array<{ id: string }> };
    assert.ok(secondPage.data.length > 0);
    assert.equal(
      secondPage.data.some((row) => firstPage.data.some((firstRow) => firstRow.id === row.id)),
      false
    );

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/payments?status=PENDING",
      headers: auth()
    });
    assert.equal(filtered.statusCode, 200);
    const filteredPage = filtered.json() as { data: Array<{ status: string }> };
    assert.ok(filteredPage.data.length > 0);
    assert.ok(filteredPage.data.every((row) => row.status === "PENDING"));

    const invalid = await app.inject({
      method: "GET",
      url: "/v1/payments?status=NOT_A_STATUS",
      headers: auth()
    });
    assert.equal(invalid.statusCode, 400);
  });

  it("lists settled transactions with a status filter", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-txn-0001"
      },
      payload: intentBody({ amount: 4000, external_reference: "TXN-001" })
    });
    const payment = created.json() as { payment: { payment_hash: string } };
    const settled = await app.inject({
      method: "POST",
      url: `/v1/sandbox/invoices/${payment.payment.payment_hash}/settle`,
      headers: { "x-sandbox-token": runtime.config.sandboxToken ?? "" }
    });
    assert.equal(settled.statusCode, 200);

    const response = await app.inject({
      method: "GET",
      url: "/v1/transactions?status=SETTLED&limit=5",
      headers: auth()
    });
    assert.equal(response.statusCode, 200);
    const page = response.json() as {
      object: string;
      data: Array<{ status: string; amount: number }>;
      has_more: boolean;
    };
    assert.equal(page.object, "list");
    assert.ok(page.data.length > 0);
    assert.ok(page.data.every((row) => row.status === "SETTLED"));
    assert.equal(typeof page.has_more, "boolean");
  });

  it("creates and reads a sandbox exchange quote", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/exchange/quotes",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { base_currency: "SAT", quote_currency: "LAK", amount: 25000 }
    });
    assert.equal(response.statusCode, 201);
    const quote = response.json() as {
      id: string;
      quote_amount: number;
      rate: string;
      expired: boolean;
    };
    assert.ok(quote.id.startsWith("qte_"));
    assert.equal(quote.quote_amount, 6250);
    assert.equal(quote.rate, "0.25");
    assert.equal(quote.expired, false);

    const read = await app.inject({
      method: "GET",
      url: `/v1/exchange/quotes/${quote.id}`,
      headers: auth()
    });
    assert.equal(read.statusCode, 200);
    assert.equal((read.json() as { id: string }).id, quote.id);

    const unsupported = await app.inject({
      method: "POST",
      url: "/v1/exchange/quotes",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { base_currency: "SAT", quote_currency: "USD", amount: 25000 }
    });
    assert.equal(unsupported.statusCode, 400);
  });

  it("list, creates and revokes scoped API keys", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/v1/api-keys",
      headers: auth()
    });
    assert.equal(initial.statusCode, 200);
    const initialList = initial.json() as { data: Array<{ id: string; key_prefix: string }> };
    assert.ok(initialList.data.length >= 1);
    assert.ok(initialList.data[0]?.key_prefix.startsWith("bp_test_"));
    const currentKeyId = initialList.data[0]?.id;
    assert.ok(currentKeyId);

    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { scopes: ["payments:read"] }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as {
      id: string;
      key: string;
      scopes: string[];
      status: string;
    };
    assert.ok(created.key.startsWith("bp_test_"));
    assert.deepEqual(created.scopes, ["payments:read"]);
    assert.equal(created.status, "ACTIVE");

    const scopedRead = await app.inject({
      method: "GET",
      url: "/v1/payments?limit=1",
      headers: { authorization: `Bearer ${created.key}` }
    });
    assert.equal(scopedRead.statusCode, 200);

    const scopedWriteDenied = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: {
        authorization: `Bearer ${created.key}`,
        "content-type": "application/json"
      },
      payload: { scopes: ["payments:read"] }
    });
    assert.equal(scopedWriteDenied.statusCode, 403);

    const revoke = await app.inject({
      method: "POST",
      url: `/v1/api-keys/${created.id}/revoke`,
      headers: auth()
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal((revoke.json() as { status: string }).status, "REVOKED");

    const revokedRead = await app.inject({
      method: "GET",
      url: "/v1/payments",
      headers: { authorization: `Bearer ${created.key}` }
    });
    assert.equal(revokedRead.statusCode, 401);
    assert.equal(
      (revokedRead.json() as { error: { code: string } }).error.code,
      "PAY_AUTH_REVOKED"
    );

    const selfRevoke = await app.inject({
      method: "POST",
      url: `/v1/api-keys/${currentKeyId}/revoke`,
      headers: auth()
    });
    assert.equal(selfRevoke.statusCode, 409);
  });

  it("rotates a scoped API key atomically", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/v1/api-keys",
      headers: auth()
    });
    const currentKeyId = (initial.json() as { data: Array<{ id: string; key_prefix: string }> })
      .data.find((key) => key.key_prefix === apiKey.slice(0, 20))?.id;
    assert.ok(currentKeyId);

    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { scopes: ["payments:read"] }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as { id: string; key: string };

    const rotatedResponse = await app.inject({
      method: "POST",
      url: `/v1/api-keys/${created.id}/rotate`,
      headers: auth()
    });
    assert.equal(rotatedResponse.statusCode, 201);
    const rotated = rotatedResponse.json() as {
      id: string;
      key: string;
      scopes: string[];
      status: string;
      key_prefix: string;
    };
    assert.notEqual(rotated.id, created.id);
    assert.match(rotated.key, /^bp_test_/);
    assert.equal(rotated.key_prefix, rotated.key.slice(0, 20));
    assert.deepEqual(rotated.scopes, ["payments:read"]);
    assert.equal(rotated.status, "ACTIVE");

    const oldRead = await app.inject({
      method: "GET",
      url: "/v1/payments?limit=1",
      headers: { authorization: `Bearer ${created.key}` }
    });
    assert.equal(oldRead.statusCode, 401);
    assert.equal((oldRead.json() as { error: { code: string } }).error.code, "PAY_AUTH_REVOKED");

    const newRead = await app.inject({
      method: "GET",
      url: "/v1/payments?limit=1",
      headers: { authorization: `Bearer ${rotated.key}` }
    });
    assert.equal(newRead.statusCode, 200);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/api-keys",
      headers: auth()
    });
    const byId = new Map(
      (listed.json() as { data: Array<{ id: string; status: string }> }).data.map((key) => [
        key.id,
        key.status
      ])
    );
    assert.equal(byId.get(created.id), "REVOKED");
    assert.equal(byId.get(rotated.id), "ACTIVE");

    const selfRotate = await app.inject({
      method: "POST",
      url: `/v1/api-keys/${currentKeyId}/rotate`,
      headers: auth()
    });
    assert.equal(selfRotate.statusCode, 409);
  });

  it("creates, preserves and enforces API key expiry", async () => {
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { scopes: ["payments:read"], expires_in_days: 30 }
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json() as {
      id: string;
      key: string;
      expires_at: string;
    };
    const remaining = new Date(created.expires_at).getTime() - Date.now();
    assert.ok(remaining > 29 * 24 * 60 * 60_000);
    assert.ok(remaining <= 30 * 24 * 60 * 60_000);

    const rotatedResponse = await app.inject({
      method: "POST",
      url: `/v1/api-keys/${created.id}/rotate`,
      headers: auth()
    });
    assert.equal(rotatedResponse.statusCode, 201);
    const rotated = rotatedResponse.json() as { id: string; key: string; expires_at: string };
    assert.equal(rotated.expires_at, created.expires_at);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/api-keys",
      headers: auth()
    });
    const listedKey = (listed.json() as {
      data: Array<{ id: string; expires_at: string | null }>;
    }).data.find((key) => key.id === rotated.id);
    assert.equal(listedKey?.expires_at, created.expires_at);

    const invalid = await app.inject({
      method: "POST",
      url: "/v1/api-keys",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { scopes: ["payments:read"], expires_in_days: 0 }
    });
    assert.equal(invalid.statusCode, 400);

    const consoleLogin = await app.inject({
      method: "POST",
      url: "/console/api/session",
      headers: { "content-type": "application/json" },
      payload: { api_key: rotated.key }
    });
    assert.equal(consoleLogin.statusCode, 201);
    const setCookie = consoleLogin.headers["set-cookie"];
    const consoleCookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie!).split(";")[0]!;

    await runtime.db.query(
      `UPDATE api_keys SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [rotated.id]
    );
    const expiredRead = await app.inject({
      method: "GET",
      url: "/v1/payments?limit=1",
      headers: { authorization: `Bearer ${rotated.key}` }
    });
    assert.equal(expiredRead.statusCode, 401);
    assert.equal(
      (expiredRead.json() as { error: { code: string } }).error.code,
      "PAY_AUTH_EXPIRED"
    );

    const expiredConsole = await app.inject({
      method: "GET",
      url: "/console/api/overview",
      headers: { cookie: consoleCookie }
    });
    assert.equal(expiredConsole.statusCode, 401);
    assert.equal(
      (expiredConsole.json() as { error: { code: string } }).error.code,
      "PAY_AUTH_EXPIRED"
    );

    const rotateExpired = await app.inject({
      method: "POST",
      url: `/v1/api-keys/${rotated.id}/rotate`,
      headers: auth()
    });
    assert.equal(rotateExpired.statusCode, 409);
  });

  it("lists, replays and disables webhook delivery state", async () => {
    const endpointResponse = await app.inject({
      method: "POST",
      url: "/v1/webhook-endpoints",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-webhook-0001"
      },
      payload: { url: "https://example.test/hook", events: ["*"] }
    });
    assert.equal(endpointResponse.statusCode, 201);
    const endpoint = endpointResponse.json() as { id: string };

    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-webhook-pay-0001"
      },
      payload: intentBody({ external_reference: "HOOK-001" })
    });
    assert.equal(created.statusCode, 201);

    const deliveriesResponse = await app.inject({
      method: "GET",
      url: "/v1/webhook-deliveries?limit=20",
      headers: auth()
    });
    assert.equal(deliveriesResponse.statusCode, 200);
    const deliveries = deliveriesResponse.json() as {
      data: Array<{ id: string; status: string; event_type: string }>;
    };
    assert.ok(deliveries.data.length >= 2);

    const delivery = deliveries.data[0];
    assert.ok(delivery);
    const replay = await app.inject({
      method: "POST",
      url: `/v1/webhook-deliveries/${delivery.id}/replay`,
      headers: auth()
    });
    assert.equal(replay.statusCode, 200);
    assert.equal((replay.json() as { status: string }).status, "PENDING");

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/webhook-endpoints/${endpoint.id}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { events: ["payment.created"] }
    });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual((updated.json() as { events: string[] }).events, ["payment.created"]);

    const unsupported = await app.inject({
      method: "PATCH",
      url: `/v1/webhook-endpoints/${endpoint.id}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { events: ["not.an.event"] }
    });
    assert.equal(unsupported.statusCode, 400);

    const disable = await app.inject({
      method: "POST",
      url: `/v1/webhook-endpoints/${endpoint.id}/disable`,
      headers: auth()
    });
    assert.equal(disable.statusCode, 200);
    assert.equal((disable.json() as { status: string }).status, "DISABLED");

    const updateDisabled = await app.inject({
      method: "PATCH",
      url: `/v1/webhook-endpoints/${endpoint.id}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { events: ["payment.created"] }
    });
    assert.equal(updateDisabled.statusCode, 400);
  });

  it("manages merchant locations and attaches one to an intent", async () => {
    const createdLocation = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { name: "Riverside", code: "river" }
    });
    assert.equal(createdLocation.statusCode, 201);
    const location = createdLocation.json() as {
      id: string;
      code: string;
      name: string;
      status: string;
    };
    assert.match(location.id, /^loc_/);
    assert.equal(location.code, "RIVER");
    assert.equal(location.name, "Riverside");
    assert.equal(location.status, "ACTIVE");

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/locations",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { name: "Duplicate", code: "RIVER" }
    });
    assert.equal(duplicate.statusCode, 409);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/locations",
      headers: auth()
    });
    assert.equal(listed.statusCode, 200);
    assert.ok((listed.json() as { data: Array<{ id: string }> }).data.some((item) => item.id === location.id));

    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-location-intent-1"
      },
      payload: intentBody({ amount: 3100, location_id: location.id })
    });
    assert.equal(created.statusCode, 201);
    const payment = created.json() as { id: string; location_id: string | null };
    assert.equal(payment.location_id, location.id);
    const detail = await app.inject({
      method: "GET",
      url: `/v1/payment-intents/${payment.id}`,
      headers: auth()
    });
    assert.equal(detail.statusCode, 200);
    assert.equal((detail.json() as { location_id: string | null }).location_id, location.id);

    const disabled = await app.inject({
      method: "POST",
      url: `/v1/locations/${location.id}/disable`,
      headers: auth()
    });
    assert.equal(disabled.statusCode, 200);
    assert.equal((disabled.json() as { status: string }).status, "DISABLED");

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-location-intent-2"
      },
      payload: intentBody({ amount: 3100, location_id: location.id })
    });
    assert.equal(rejected.statusCode, 404);
    assert.equal(
      (rejected.json() as { error: { code: string } }).error.code,
      "PAY_NOT_FOUND_LOCATION"
    );

    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/locations/${location.id}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: { name: "Riverside Annex", active: true }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.json() as { name: string }).name, "Riverside Annex");
    assert.equal((updated.json() as { status: string }).status, "ACTIVE");

    const reEnabled = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-location-intent-3"
      },
      payload: intentBody({ amount: 3100, location_id: location.id })
    });
    assert.equal(reEnabled.statusCode, 201);

    const noChange = await app.inject({
      method: "PATCH",
      url: `/v1/locations/${location.id}`,
      headers: { ...auth(), "content-type": "application/json" },
      payload: {}
    });
    assert.equal(noChange.statusCode, 400);
  });

  it("summarizes and reconciles a ledger-balanced settlement period", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/payment-intents",
      headers: {
        ...auth(),
        "content-type": "application/json",
        "idempotency-key": "core-settlement-0001"
      },
      payload: intentBody({ amount: 1500, external_reference: "SETTLE-001" })
    });
    const payment = created.json() as { payment: { payment_hash: string } };
    await app.inject({
      method: "POST",
      url: `/v1/sandbox/invoices/${payment.payment.payment_hash}/settle`,
      headers: { "x-sandbox-token": runtime.config.sandboxToken ?? "" }
    });

    const from = new Date(Date.now() - 60 * 60_000).toISOString();
    const to = new Date(Date.now() + 60 * 60_000).toISOString();
    const summaryResponse = await app.inject({
      method: "GET",
      url: `/v1/settlements/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      headers: auth()
    });
    assert.equal(summaryResponse.statusCode, 200);
    const summary = summaryResponse.json() as {
      transaction_count: number;
      gross: number;
      net: number;
      fees: number;
      ledger_balanced: boolean;
      status: string;
    };
    assert.ok(summary.transaction_count >= 1);
    assert.ok(summary.gross >= 1500);
    assert.equal(summary.net, summary.gross - summary.fees);
    assert.equal(summary.ledger_balanced, true);
    assert.equal(summary.status, "COMPLETED");

    const reconcile = await app.inject({
      method: "POST",
      url: "/v1/settlements/reconcile",
      headers: { ...auth(), "content-type": "application/json" },
      payload: { period_start: from, period_end: to }
    });
    assert.equal(reconcile.statusCode, 201);
    const record = reconcile.json() as { id: string; status: string };
    assert.ok(record.id.startsWith("stl_"));
    assert.equal(record.status, "COMPLETED");

    const readRecord = await app.inject({
      method: "GET",
      url: `/v1/settlements/${record.id}`,
      headers: auth()
    });
    assert.equal(readRecord.statusCode, 200);
    const stored = readRecord.json() as {
      id: string;
      transaction_count: number;
      ledger_balanced: boolean;
    };
    assert.equal(stored.id, record.id);
    assert.ok(stored.transaction_count >= 1);
    assert.equal(stored.ledger_balanced, true);

    const list = await app.inject({
      method: "GET",
      url: "/v1/settlements?limit=5",
      headers: auth()
    });
    assert.equal(list.statusCode, 200);
    const listed = list.json() as {
      object: string;
      data: Array<{ id: string; created_at: string; net: number }>;
    };
    assert.equal(listed.object, "list");
    const listedRecord = listed.data.find((item) => item.id === record.id);
    assert.ok(listedRecord);
    assert.ok(listedRecord.created_at);
    assert.ok(listedRecord.net >= 0);

    const invalidLimit = await app.inject({
      method: "GET",
      url: "/v1/settlements?limit=0",
      headers: auth()
    });
    assert.equal(invalidLimit.statusCode, 400);
  });
});
