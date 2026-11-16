import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { csvDocument, csvFilename } from "../csv.ts";
import type { AppDependencies } from "../dependencies.ts";
import {
  presentApiKey,
  presentApiKeys,
  presentBalances,
  presentCreatedApiKey,
  presentCreatedIntent,
  presentCreatedPaymentLink,
  presentPaymentLink,
  presentEntitlement,
  presentIntent,
  presentIntentView,
  presentMerchant,
  presentLocation,
  presentLocations,
  presentPlan,
  presentProviderConnection,
  presentRefund,
  presentSettlementSummary,
  presentSubscriptionInvoice,
  presentWebhookDeliveries,
  presentWebhookDelivery,
  presentWebhookEndpoint,
  presentWebhookRegistration,
  presentWebhookRotation
} from "../presenters.ts";
import { idempotencyKey, parseLimit } from "../http-input.ts";
import { createIntentSchema, type CreateIntentBody } from "../schemas/payment-intent.ts";
import { intentListQuerySchema } from "../schemas/lists.ts";
import type { ConsoleContext, ConsoleLogin } from "../../application/console-session-service.ts";
import type { NostrEvent } from "../../application/nostr-auth-service.ts";
import type { IntentStatus } from "../../domain/types.ts";
import { PayError } from "../../domain/errors.ts";
import { msatToSatNumber } from "../../domain/money.ts";

const COOKIE_NAME = "pay_console_session";
const UI_ROOT = fileURLToPath(new URL("../../../../ui/", import.meta.url));
const STATIC_PREFIXES = ["styles/", "scripts/"] as const;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8"
};

interface LoginBody {
  api_key: string;
  mode?: "sandbox" | "live";
}

interface ApiKeyBody {
  scopes?: string[];
  expires_in_days?: number | null;
}

interface MemberBody {
  pubkey: string;
  role: "ADMIN" | "MANAGER" | "CASHIER" | "VIEWER";
  label?: string | null;
}

interface PaymentQuery {
  limit?: string;
  starting_after?: string;
  status?: IntentStatus;
}

interface WebhookBody {
  url: string;
  events: string[];
}

interface NostrProofBody {
  event: NostrEvent;
}

interface NostrLoginBody extends NostrProofBody {
  mode?: "sandbox" | "live";
}

interface NostrEntryBody {
  event: NostrEvent;
  organization_name?: string;
  merchant_name?: string;
  mode?: "sandbox" | "live";
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secure ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ");
}

function clearSessionCookie(secure: boolean): string {
  return `${sessionCookie("", 0, secure)}`;
}

function hasScope(context: ConsoleContext, scope: string): boolean {
  return context.scopes.includes("*") || context.scopes.includes(scope);
}

async function consoleContext(
  request: FastifyRequest,
  deps: AppDependencies,
  rotateCsrf = false
): Promise<ConsoleContext> {
  const token = readCookie(request.headers.cookie, COOKIE_NAME);
  return deps.consoleSessions.authenticate(token, rotateCsrf);
}

async function sessionBody(
  context: ConsoleContext,
  csrfToken: string,
  deps: AppDependencies
): Promise<Record<string, unknown>> {
  return {
    object: "console_session",
    id: context.sessionId,
    api_key_id: context.auth.apiKeyId,
    merchant: context.merchant,
    scopes: context.scopes,
    livemode: context.auth.livemode,
    auth_method: context.authMethod,
    nostr_pubkey: context.nostrPubkey,
    linked_nostr_pubkey:
      context.nostrPubkey ?? (await deps.consoleSessions.linkedPubkey(context.auth.apiKeyId)),
    expires_at: context.expiresAt,
    csrf_token: csrfToken
  };
}

function requireCsrf(context: ConsoleContext, request: FastifyRequest, deps: AppDependencies): void {
  deps.consoleSessions.assertCsrf(context, request.headers["x-pay-csrf"] as string | undefined);
}

function contentSecurityPolicy(deps: AppDependencies): string {
  const connect = ["'self'"];
  if (deps.config.consoleNostrRelay) {
    connect.push(new URL(deps.config.consoleNostrRelay).origin);
  }
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

async function sendAsset(
  reply: FastifyReply,
  relativePath: string,
  deps: AppDependencies
): Promise<FastifyReply> {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!STATIC_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "asset not found" } });
  }
  const fullPath = resolve(UI_ROOT, normalized);
  if (!fullPath.startsWith(`${resolve(UI_ROOT)}${sep}`)) {
    return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "asset not found" } });
  }
  const type = CONTENT_TYPES[extname(fullPath)];
  if (!type) {
    return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "asset not found" } });
  }
  try {
    const body = await readFile(fullPath);
    return reply
      .header("content-security-policy", contentSecurityPolicy(deps))
      .type(type)
      .send(body);
  } catch {
    return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "asset not found" } });
  }
}

export async function registerConsoleRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  if (!deps.config.consoleEnabled) return;

  app.get("/console", async (_request, reply) => reply.redirect("/console/"));

  app.get("/console/", async (_request, reply) => {
    const body = await readFile(resolve(UI_ROOT, "console.html"));
    return reply
      .header("content-security-policy", contentSecurityPolicy(deps))
      .type("text/html; charset=utf-8")
      .send(body);
  });

  app.get<{ Params: { "*": string } }>("/console/styles/*", async (request, reply) => {
    return sendAsset(reply, `styles/${request.params["*"]}`, deps);
  });

  app.get<{ Params: { "*": string } }>("/console/scripts/*", async (request, reply) => {
    return sendAsset(reply, `scripts/${request.params["*"]}`, deps);
  });

  app.post<{ Body: LoginBody }>(
    "/console/api/session",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["api_key"],
          properties: {
            api_key: { type: "string", minLength: 20, maxLength: 200 },
            mode: { type: "string", enum: ["sandbox", "live"] }
          }
        }
      }
    },
    async (request, reply) => {
      const login = await deps.consoleSessions.login(request.body.api_key, request.body.mode);
      reply.header(
        "set-cookie",
        sessionCookie(login.token, login.sessionTtlMs / 1000, deps.config.consoleCookieSecure)
      );
      return reply.code(201).send({
        ...login.session,
        object: "console_session",
        csrf_token: login.csrfToken
      });
    }
  );

  app.get("/console/api/config", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    const modes =
      deps.config.consoleMode === "both"
        ? ["sandbox", "live"]
        : [deps.config.consoleMode];
    const defaultMode = deps.config.consoleMode === "live" ? "live" : "sandbox";
    return {
      object: "console_config",
      mode: deps.config.consoleMode,
      default_mode: defaultMode,
      livemode: defaultMode === "live",
      modes,
      toggle: modes.length > 1,
      provider: defaultMode === "live" ? deps.config.lightningProvider : "mock",
      onboarding_enabled:
        modes.includes("sandbox") && deps.config.onboardingEnabled
    };
  });

  app.get("/console/api/nostr/config", async () => {
    return {
      object: "nostr_config",
      nip07: true,
      nsec: deps.config.consoleNsecEnabled,
      remote: Boolean(deps.config.consoleNostrRelay),
      relay: deps.config.consoleNostrRelay
    };
  });

  app.get("/console/api/onboarding/config", async () => {
    return {
      object: "onboarding_config",
      enabled:
        deps.config.consoleMode !== "live" && deps.config.onboardingEnabled
    };
  });

  app.post("/console/api/nostr/challenge", async () => {
    return {
      object: "nostr_challenge",
      ...(await deps.nostrAuth.createLoginChallenge())
    };
  });

  app.post<{ Body: NostrLoginBody }>(
    "/console/api/nostr/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["event"],
          properties: {
            event: { type: "object" },
            mode: { type: "string", enum: ["sandbox", "live"] }
          }
        }
      }
    },
    async (request, reply) => {
      const identity = await deps.nostrAuth.login(request.body.event);
      const login = await deps.consoleSessions.loginNostr(identity, request.body.mode);
      reply.header(
        "set-cookie",
        sessionCookie(login.token, login.sessionTtlMs / 1000, deps.config.consoleCookieSecure)
      );
      return reply.code(201).send({
        ...login.session,
        object: "console_session",
        csrf_token: login.csrfToken
      });
    }
  );

  app.post<{ Body: NostrEntryBody }>(
    "/console/api/nostr/enter",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["event"],
          properties: {
            event: { type: "object" },
            organization_name: { type: "string", minLength: 2, maxLength: 120 },
            merchant_name: { type: "string", minLength: 2, maxLength: 120 },
            mode: { type: "string", enum: ["sandbox", "live"] }
          }
        }
      }
    },
    async (request, reply) => {
      const verified = await deps.nostrAuth.verifyLogin(request.body.event);
      let login: ConsoleLogin;
      let created = false;
      let apiKey: string | null = null;
      if (verified.identity) {
        login = await deps.consoleSessions.loginNostr(verified.identity, request.body.mode);
        reply.code(200);
      } else if (await deps.onboarding.ensureConsoleIdentity(verified.pubkey)) {
        login = await deps.consoleSessions.loginNostrPubkey(verified.pubkey, request.body.mode);
        reply.code(200);
      } else {
        if (deps.config.consoleMode === "live" || !deps.config.onboardingEnabled) {
          throw new PayError(
            "PAY_AUTH_INVALID",
            deps.config.consoleMode === "live"
              ? "live console onboarding is not enabled; use an existing live API key"
              : "this Nostr key is not linked to a merchant"
          );
        }
        const suffix = verified.pubkey.slice(0, 8);
        const organizationName =
          request.body.organization_name?.trim() || `Nostr workspace ${suffix}`;
        const merchantName =
          request.body.merchant_name?.trim() || `Merchant ${suffix}`;
        const provisioned = await deps.onboarding.createSandboxForPubkey(
          { organizationName, merchantName },
          verified.pubkey,
          request.ip
        );
        login = await deps.consoleSessions.loginNostrPubkey(verified.pubkey, request.body.mode);
        created = true;
        apiKey = provisioned.apiKey;
        reply.code(201);
      }
      reply.header(
        "set-cookie",
        sessionCookie(login.token, login.sessionTtlMs / 1000, deps.config.consoleCookieSecure)
      );
      return {
        ...login.session,
        object: "console_session",
        csrf_token: login.csrfToken,
        created,
        api_key: apiKey
      };
    }
  );

  app.post("/console/api/nostr/link", async (request) => {
    const context = await consoleContext(request, deps);
    requireCsrf(context, request, deps);
    return {
      object: "nostr_challenge",
      ...(await deps.nostrAuth.createLinkChallenge(context))
    };
  });

  app.post<{ Body: NostrProofBody }>(
    "/console/api/nostr/link/proof",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["event"],
          properties: { event: { type: "object" } }
        }
      }
    },
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const identity = await deps.nostrAuth.link(context, request.body.event);
      return {
        object: "console_nostr_identity",
        pubkey: identity.pubkey,
        status: identity.status,
        request_id: request.id
      };
    }
  );

  app.get("/console/api/session", async (request) => {
    const context = await consoleContext(request, deps, true);
    return await sessionBody(context, context.csrfToken, deps);
  });

  app.delete("/console/api/session", async (request, reply) => {
    const context = await consoleContext(request, deps);
    requireCsrf(context, request, deps);
    await deps.consoleSessions.logout(context.sessionId);
    reply.header("set-cookie", clearSessionCookie(deps.config.consoleCookieSecure));
    return { object: "console_session", deleted: true };
  });

  app.get("/console/api/overview", async (request) => {
    const context = await consoleContext(request, deps);
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60_000);
    const merchant = await deps.paymentIntents.getMerchantProfile(context.auth);
    const balances = await deps.ledgerQuery.getBalances(context.auth);
    const settlement = await deps.settlementReports.summary(context.auth, from, now);
    const reconciliations = await deps.settlementReports.list(context.auth, 8);
    const locations = await deps.locations.list(context.auth);
    const page = await deps.paymentIntents.listPayments(context.auth, { limit: 20 });
    const apiKeys = hasScope(context, "keys:read")
      ? (presentApiKeys(await deps.apiKeys.listKeys(context.auth), request.id).data as unknown[])
      : [];
    const members = hasScope(context, "keys:read")
      ? await deps.members.list(context.auth)
      : [];
    const endpoints = hasScope(context, "webhooks:read")
      ? (await deps.webhooks.listEndpoints(context.auth)).map(presentWebhookEndpoint)
      : [];
    const deliveries = hasScope(context, "webhooks:read")
      ? (presentWebhookDeliveries(
          await deps.webhooks.listDeliveries(context.auth, 8),
          request.id
        ).data as unknown[])
      : [];
    const plans = await deps.plans.listPlans();
    const entitlement = await deps.plans.getEntitlement(context.auth);
    const connections = (await deps.providerConnections.list(context.auth)).map(
      ({ connection, selected }) => presentProviderConnection(connection, selected)
    );
    const paymentLinks = await deps.paymentLinks.list(context.auth);

    return {
      object: "console_overview",
      server_time: now.toISOString(),
      merchant: presentMerchant(merchant, request.id),
      scopes: context.scopes,
      session_expires_at: context.expiresAt,
      stats: {
        successful_recent: page.items.filter((item) => item.status === "SUCCEEDED").length,
        pending_recent: page.items.filter((item) => item.status === "PENDING").length,
        payments_recent: page.items.length
      },
      balances: (presentBalances(balances, request.id).data as unknown[]),
      settlement: presentSettlementSummary(settlement, request.id),
      reconciliations: reconciliations.map((record) =>
        presentSettlementSummary(record, request.id)
      ),
      locations: locations.map((location) => presentLocation(location, request.id)),
      payments: page.items.map(presentIntent),
      has_more_payments: page.hasMore,
      next_payment_cursor: page.hasMore ? (page.items.at(-1)?.id ?? null) : null,
      api_keys: apiKeys,
      members,
      plans: plans.map((plan) => presentPlan(plan, request.id)),
      entitlement: entitlement ? presentEntitlement(entitlement, request.id) : null,
      connections,
      payment_links: paymentLinks.map((link) =>
        presentPaymentLink(link, deps.paymentLinks.urlForLink(link.id))
      ),
      webhooks: {
        read: hasScope(context, "webhooks:read"),
        endpoints,
        deliveries
      }
    };
  });

  app.post<{ Body: { period_start: string; period_end: string } }>(
    "/console/api/reconciliations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["period_start", "period_end"],
          properties: {
            period_start: { type: "string", minLength: 1, maxLength: 40 },
            period_end: { type: "string", minLength: 1, maxLength: 40 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const summary = await deps.settlementReports.reconcile(
        context.auth,
        new Date(request.body.period_start),
        new Date(request.body.period_end)
      );
      return reply.code(201).send(presentSettlementSummary(summary, request.id));
    }
  );

  app.get<{ Querystring: PaymentQuery }>(
    "/console/api/payments",
    { schema: { querystring: intentListQuerySchema } },
    async (request) => {
      const context = await consoleContext(request, deps);
      const page = await deps.paymentIntents.listPayments(context.auth, {
        limit: parseLimit(request.query.limit),
        startingAfter: request.query.starting_after,
        status: request.query.status
      });
      const last = page.items.at(-1);
      return {
        object: "list",
        data: page.items.map(presentIntent),
        has_more: page.hasMore,
        next_cursor: page.hasMore && last ? last.id : null
      };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/payment-intents/:id/cancel",
    async (request) => {
      const context = await consoleContext(request, deps);
      deps.consoleSessions.assertCsrf(context, request.headers["x-pay-csrf"] as string | undefined);
      const view = await deps.paymentIntents.cancelPaymentIntent(context.auth, request.params.id);
      return presentIntentView(view, request.id);
    }
  );

  app.get<{ Params: { id: string } }>(
    "/console/api/payment-intents/:id",
    async (request) => {
      const context = await consoleContext(request, deps);
      const view = await deps.paymentIntents.getPaymentIntent(context.auth, request.params.id);
      const refunds = await deps.refunds.listForIntent(context.auth, view.intent.id, 50);
      const refundedMsat = refunds
        .filter((refund) => refund.status === "SUCCEEDED")
        .reduce((total, refund) => total + refund.amountMsat, 0n);
      const refundable = view.transaction
        ? msatToSatNumber(
            view.transaction.amountMsat > refundedMsat
              ? view.transaction.amountMsat - refundedMsat
              : 0n
          )
        : 0;
      return {
        ...presentIntentView(view, request.id),
        checkout_url: deps.checkout.urlForIntent(view.intent.id),
        refunds: refunds.map((refund) => presentRefund(refund, request.id)),
        refundable
      };
    }
  );

  app.post<{ Body: CreateIntentBody }>(
    "/console/api/payment-intents",
    { schema: createIntentSchema },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const result = await deps.paymentIntents.createPaymentIntent(
        context.auth,
        {
          amount: request.body.amount,
          currency: request.body.currency,
          scale: request.body.scale,
          payment_method: request.body.payment_method,
          external_reference: request.body.external_reference ?? null,
          location_id: request.body.location_id ?? null,
          metadata: request.body.metadata ?? {}
        },
        idempotencyKey(request),
        request.id
      );
      return reply.code(201).send(presentCreatedIntent(result));
    }
  );

  app.patch<{
    Body: { name: string; support_email?: string | null; website?: string | null };
  }>(
    "/console/api/merchants/me",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            support_email: { type: ["string", "null"], maxLength: 254 },
            website: { type: ["string", "null"], maxLength: 2048 }
          }
        }
      }
    },
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const merchant = await deps.merchantProfiles.update(context.auth, request.body);
      return presentMerchant(merchant, request.id);
    }
  );

  app.post<{
    Body: {
      amount: number;
      currency: string;
      scale: number;
      reference?: string | null;
      label?: string | null;
    };
  }>(
    "/console/api/payment-links",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["amount", "currency", "scale"],
          properties: {
            amount: { type: "integer", minimum: 1 },
            currency: { type: "string", maxLength: 12 },
            scale: { type: "integer", minimum: 0, maximum: 12 },
            reference: { type: ["string", "null"], maxLength: 200 },
            label: { type: ["string", "null"], maxLength: 120 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const created = await deps.paymentLinks.create(
        context.auth,
        request.body,
        idempotencyKey(request)
      );
      return reply.code(201).send(presentCreatedPaymentLink(created, request.id));
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/payment-links/:id/disable",
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const link = await deps.paymentLinks.disable(context.auth, request.params.id);
      return {
        ...presentPaymentLink(link, deps.paymentLinks.urlForLink(link.id)),
        request_id: request.id
      };
    }
  );

  app.post<{
    Body: { transaction_id: string; amount: number; reason?: string | null };
  }>(
    "/console/api/refunds",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["transaction_id", "amount"],
          properties: {
            transaction_id: { type: "string", minLength: 1, maxLength: 100 },
            amount: { type: "integer", minimum: 1 },
            reason: { type: ["string", "null"], maxLength: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const refund = await deps.refunds.createRefund(
        context.auth,
        request.body,
        idempotencyKey(request),
        request.id
      );
      return reply.code(201).send(refund);
    }
  );

  app.post<{ Body: { plan_code: string } }>(
    "/console/api/subscriptions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["plan_code"],
          properties: { plan_code: { type: "string", minLength: 2, maxLength: 80 } }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const result = await deps.plans.createSubscription(
        context.auth,
        request.body.plan_code
      );
      return reply.code(201).send(presentSubscriptionInvoice(result, request.id));
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/subscriptions/:id/settle",
    async (request) => {
      if (!deps.sandboxEnabled) {
        throw new PayError("PAY_AUTH_INVALID", "sandbox plan settlement is disabled");
      }
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const result = await deps.plans.settleSandbox(context.auth, request.params.id);
      return {
        object: "subscription_activation",
        subscription_id: result.subscription.id,
        status: result.subscription.status,
        entitlement: presentEntitlement(result.entitlement, request.id),
        request_id: request.id
      };
    }
  );

  app.get<{
    Querystring: { from?: string; to?: string; status?: string; location_id?: string };
  }>("/console/api/exports/payments.csv", async (request, reply) => {
    const context = await consoleContext(request, deps);
    const payments = await deps.paymentIntents.exportPayments(context.auth, {
      from: request.query.from,
      to: request.query.to,
      status: request.query.status,
      locationId: request.query.location_id,
      limit: 5000
    });
    const rows: unknown[][] = [
      [
        "id",
        "created_at",
        "status",
        "amount_sat",
        "amount_msat",
        "currency",
        "external_reference",
        "location_id",
        "livemode",
        "expires_at"
      ],
      ...payments.map((payment) => [
        payment.id,
        payment.createdAt,
        payment.status,
        (payment.amountMsat / 1000n).toString(),
        payment.amountMsat.toString(),
        payment.currency,
        payment.externalReference,
        payment.locationId,
        payment.livemode,
        payment.expiresAt
      ])
    ];
    return reply
      .header("cache-control", "no-store")
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${csvFilename("bitos-pay-payments", new Date())}"`)
      .send(csvDocument(rows));
  });

  app.get("/console/api/exports/reconciliations.csv", async (request, reply) => {
    const context = await consoleContext(request, deps);
    const records = await deps.settlementReports.list(context.auth, 100);
    const rows: unknown[][] = [
      [
        "id",
        "created_at",
        "period_start",
        "period_end",
        "transaction_count",
        "gross_msat",
        "fees_msat",
        "net_msat",
        "ledger_balanced",
        "status"
      ],
      ...records.map((record) => [
        record.id,
        record.createdAt,
        record.periodStart,
        record.periodEnd,
        record.transactionCount,
        record.grossMsat.toString(),
        record.feesMsat.toString(),
        record.netMsat.toString(),
        record.ledgerBalanced,
        record.status
      ])
    ];
    return reply
      .header("cache-control", "no-store")
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${csvFilename("bitos-pay-reconciliations", new Date())}"`)
      .send(csvDocument(rows));
  });

  app.get("/console/api/members", async (request) => {
    const context = await consoleContext(request, deps);
    return {
      object: "list",
      data: await deps.members.list(context.auth),
      request_id: request.id
    };
  });

  app.get("/console/api/locations", async (request) => {
    const context = await consoleContext(request, deps);
    return presentLocations(await deps.locations.list(context.auth), request.id);
  });

  app.post<{ Body: { name: string; code: string } }>(
    "/console/api/locations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "code"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            code: { type: "string", minLength: 2, maxLength: 24 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const location = await deps.locations.create(context.auth, request.body);
      return reply.code(201).send(presentLocation(location, request.id));
    }
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; active?: boolean } }>(
    "/console/api/locations/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            active: { type: "boolean" }
          }
        }
      }
    },
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      return presentLocation(
        await deps.locations.update(context.auth, request.params.id, request.body),
        request.id
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/locations/:id/disable",
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      return presentLocation(
        await deps.locations.disable(context.auth, request.params.id),
        request.id
      );
    }
  );

  app.post<{ Body: MemberBody }>(
    "/console/api/members",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["pubkey", "role"],
          properties: {
            pubkey: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
            role: { type: "string", enum: ["ADMIN", "MANAGER", "CASHIER", "VIEWER"] },
            label: { type: ["string", "null"], maxLength: 80 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const member = await deps.members.invite(context.auth, request.body);
      return reply.code(201).send({ ...member, object: "merchant_member", request_id: request.id });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/members/:id/revoke",
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const member = await deps.members.revoke(context.auth, request.params.id);
      return { ...member, object: "merchant_member", request_id: request.id };
    }
  );

  app.get("/console/api/api-keys", async (request) => {
    const context = await consoleContext(request, deps);
    return presentApiKeys(await deps.apiKeys.listKeys(context.auth), request.id);
  });

  app.post<{ Body: ApiKeyBody | null }>(
    "/console/api/api-keys",
    {
      schema: {
        body: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            scopes: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 }
            },
            expires_in_days: { type: ["integer", "null"], minimum: 1, maximum: 365 }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const key = await deps.apiKeys.createKey(context.auth, request.body ?? {});
      return reply.code(201).send(presentCreatedApiKey(key, request.id));
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/api-keys/:id/rotate",
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const key = await deps.apiKeys.rotateKey(context.auth, request.params.id);
      return reply.code(201).send(presentCreatedApiKey(key, request.id));
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/api-keys/:id/revoke",
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      return presentApiKey(await deps.apiKeys.revokeKey(context.auth, request.params.id), request.id);
    }
  );

  app.post<{ Body: WebhookBody }>(
    "/console/api/webhook-endpoints",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["url", "events"],
          properties: {
            url: { type: "string", minLength: 1, maxLength: 2048 },
            events: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } }
          }
        }
      }
    },
    async (request, reply) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const registration = await deps.webhooks.registerEndpoint(
        context.auth,
        request.body,
        idempotencyKey(request)
      );
      return reply.code(201).send(presentWebhookRegistration(registration, request.id));
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/webhook-endpoints/:id/rotate",
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const rotation = await deps.webhooks.rotateEndpointSecret(context.auth, request.params.id);
      return presentWebhookRotation(rotation, request.id);
    }
  );

  app.patch<{ Params: { id: string }; Body: { events: string[] } }>(
    "/console/api/webhook-endpoints/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["events"],
          properties: {
            events: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 }
            }
          }
        }
      }
    },
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      const endpoint = await deps.webhooks.updateEndpoint(
        context.auth,
        request.params.id,
        request.body.events
      );
      return { ...presentWebhookEndpoint(endpoint), request_id: request.id };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/webhook-endpoints/:id/disable",
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      return {
        ...presentWebhookEndpoint(
          await deps.webhooks.disableEndpoint(context.auth, request.params.id)
        ),
        request_id: request.id
      };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/console/api/webhook-deliveries/:id/replay",
    async (request) => {
      const context = await consoleContext(request, deps);
      requireCsrf(context, request, deps);
      return {
        ...presentWebhookDelivery(
          await deps.webhooks.replayDelivery(context.auth, request.params.id)
        ),
        request_id: request.id
      };
    }
  );
}
