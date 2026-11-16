import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer } from "../http-input.ts";
import { presentMerchant } from "../presenters.ts";

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
}
