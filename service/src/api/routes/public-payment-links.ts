import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppDependencies } from "../dependencies.ts";

const UI_ROOT = fileURLToPath(new URL("../../../../ui/", import.meta.url));
const STATIC_PREFIXES = ["styles/", "scripts/"] as const;
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

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
      .header("x-content-type-options", "nosniff")
      .type(type)
      .send(body);
  } catch {
    return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "asset not found" } });
  }
}

export async function registerPublicPaymentLinkRoutes(
  app: FastifyInstance,
  _deps: AppDependencies
): Promise<void> {
  app.get<{ Params: { token: string } }>("/pay/:token", async (request, reply) => {
    if (!/^plk_[A-Za-z0-9_.-]{20,200}$/.test(request.params.token)) {
      return reply.code(404).send({ error: { code: "PAY_NOT_FOUND", message: "payment link not found" } });
    }
    const body = await readFile(resolve(UI_ROOT, "payment-link.html"));
    return reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
      .header("x-content-type-options", "nosniff")
      .header("x-robots-tag", "noindex")
      .type("text/html; charset=utf-8")
      .send(body);
  });

  app.get<{ Params: { "*": string } }>("/pay/styles/*", async (request, reply) => {
    return sendAsset(reply, `styles/${request.params["*"]}`);
  });

  app.get<{ Params: { "*": string } }>("/pay/scripts/*", async (request, reply) => {
    return sendAsset(reply, `scripts/${request.params["*"]}`);
  });
}
