import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { presentPublicCheckout } from "../presenters.ts";

const UI_ROOT = fileURLToPath(new URL("../../../../ui/", import.meta.url));
const STATIC_PREFIXES = ["styles/", "scripts/"] as const;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};
const CHECKOUT_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

async function sendAsset(reply: FastifyReply, relativePath: string): Promise<FastifyReply> {
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
      .header("content-security-policy", CHECKOUT_CSP)
      .header("x-content-type-options", "nosniff")
      .type(type)
      .send(body);
  } catch {
    return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "asset not found" } });
  }
}

export async function registerCheckoutRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get<{ Params: { token: string } }>("/v1/checkout/:token", async (request, reply) => {
    const view = await deps.checkout.publicView(request.params.token);
    return reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
      .header("x-robots-tag", "noindex")
      .send(presentPublicCheckout(view, request.id));
  });

  app.get<{ Params: { token: string } }>("/checkout/:token", async (request, reply) => {
    if (!/^pcl_[A-Za-z0-9_.-]{20,200}$/.test(request.params.token)) {
      return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "checkout not found" } });
    }
    const body = await readFile(resolve(UI_ROOT, "checkout.html"));
    return reply
      .header("cache-control", "no-store")
      .header("content-security-policy", CHECKOUT_CSP)
      .header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff")
      .header("x-robots-tag", "noindex")
      .type("text/html; charset=utf-8")
      .send(body);
  });

  app.get<{ Params: { "*": string } }>("/checkout/styles/*", async (request, reply) => {
    return sendAsset(reply, `styles/${request.params["*"]}`);
  });

  app.get<{ Params: { "*": string } }>("/checkout/scripts/*", async (request, reply) => {
    return sendAsset(reply, `scripts/${request.params["*"]}`);
  });
}
