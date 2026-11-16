import type { FastifyInstance } from "fastify";
import { API_VERSION } from "../../domain/index.ts";

export interface HealthDependencies {
  ready: () => Promise<boolean>;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthDependencies
): Promise<void> {
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async (_request, reply) => {
    const ready = await deps.ready();
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "unavailable" });
  });
  app.get("/", async (request) => ({
    service: "bitos-pay-reference",
    api_version: API_VERSION,
    status: "reference-only",
    documentation: "bitos-pay/docs/RUNNING.md",
    openapi: "/openapi.json",
    request_id: request.id
  }));
}
