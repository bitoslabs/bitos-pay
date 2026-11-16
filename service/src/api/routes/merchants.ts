import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer } from "../http-input.ts";
import { presentAuditLogs, presentMerchant, presentMerchantHealth } from "../presenters.ts";

interface UpdateProfileBody {
  name: string;
  support_email?: string | null;
  website?: string | null;
}

export async function registerMerchantRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get("/v1/merchants/me", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const merchant = await deps.paymentIntents.getMerchantProfile(auth);
    return presentMerchant(merchant, request.id);
  });

  app.patch<{ Body: UpdateProfileBody }>(
    "/v1/merchants/me",
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
      const auth = await deps.auth.authenticate(bearer(request));
      const merchant = await deps.merchantProfiles.update(auth, request.body);
      return presentMerchant(merchant, request.id);
    }
  );

  app.get("/v1/merchants/me/health", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const health = await deps.monitoring.getMerchantHealth(auth);
    return presentMerchantHealth(health, request.id);
  });

  app.get<{ Querystring: { limit?: string; action_prefix?: string; target_ref?: string } }>(
    "/v1/audit-logs",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const limit = request.query.limit ? Number(request.query.limit) : 50;
      const entries = await deps.monitoring.listAuditLogs(auth, {
        limit: Number.isFinite(limit) ? limit : 50,
        actionPrefix: request.query.action_prefix,
        targetRef: request.query.target_ref
      });
      return presentAuditLogs(entries, request.id);
    }
  );
}
