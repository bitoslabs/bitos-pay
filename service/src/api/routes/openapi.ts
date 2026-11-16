import type { FastifyInstance } from "fastify";
import { openapiDocument } from "../openapi.ts";

export async function registerOpenApiRoute(app: FastifyInstance): Promise<void> {
  app.get("/openapi.json", async () => openapiDocument);
}
