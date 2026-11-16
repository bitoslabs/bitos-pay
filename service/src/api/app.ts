import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { AppDependencies } from "./dependencies.ts";
import { registerErrorHandler } from "./plugins/errors.ts";
import { registerRawBodyCapture } from "./raw-body.ts";
import { registerRoutes } from "./routes/index.ts";

export interface CreateAppOptions {
  logger?: FastifyServerOptions["logger"];
}

const CHECKOUT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

function consoleSecurityPolicy(deps: AppDependencies): string {
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

export async function createApp(
  deps: AppDependencies,
  options: CreateAppOptions = {}
): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger ??
      {
        level: process.env.PAY_LOG_LEVEL ?? "info",
        redact: {
          paths: ["req.headers.authorization", "req.headers['x-sandbox-token']"],
          censor: "[redacted]"
        }
      },
    genReqId: () => `req_${randomUUID().replaceAll("-", "")}`,
    bodyLimit: 64 * 1024,
    trustProxy: false,
    ajv: { customOptions: { coerceTypes: false } }
  });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    reply.header("vary", "Origin");
    if (!deps.config.corsOrigins.includes(origin)) return;
    reply.header("access-control-allow-origin", origin);
    if (request.method === "OPTIONS") {
      reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
      reply.header("access-control-allow-headers", "authorization, content-type");
      reply.header("access-control-max-age", "600");
      return reply.code(204).send();
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    const url = request.raw.url ?? "";
    const isConsole = url.startsWith("/console");
    const isCheckout = url.startsWith("/checkout") || url.startsWith("/pay");
    reply.header(
      "content-security-policy",
      isCheckout
        ? CHECKOUT_SECURITY_POLICY
        : isConsole
          ? consoleSecurityPolicy(deps)
          : "default-src 'none'; frame-ancestors 'none'"
    );
    return payload;
  });

  app.addHook("onResponse", async (request, reply) => {
    const url = request.raw.url ?? "";
    if (!url.startsWith("/v1/")) return;
    const authorization = request.headers.authorization;
    if (!authorization) return;
    try {
      await deps.monitoring.recordApiKeyUsageFromBearer(authorization, reply.statusCode, url);
    } catch {
      // Usage telemetry must never break or fail an API response.
    }
  });

  registerErrorHandler(app);
  await registerRawBodyCapture(app);
  await registerRoutes(app, deps);
  await app.ready();
  return app;
}
