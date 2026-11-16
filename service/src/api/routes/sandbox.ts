import type { FastifyInstance } from "fastify";
import { PayError } from "../../domain/errors.ts";
import type { AppDependencies } from "../dependencies.ts";
import { bearer, sandboxToken } from "../http-input.ts";
import { presentEntitlement, presentSettlement, presentSubscription } from "../presenters.ts";

interface SandboxSettleBody {
  amount_msat?: number;
  amount?: number;
}

export async function registerSandboxRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    "/v1/sandbox/subscriptions/:id/settle",
    async (request) => {
      if (!deps.sandboxEnabled) throw new PayError("PAY_AUTH_INVALID", "sandbox is disabled");
      if (!deps.sandboxToken || sandboxToken(request) !== deps.sandboxToken) {
        throw new PayError("PAY_AUTH_INVALID", "invalid sandbox token");
      }
      const auth = await deps.auth.authenticate(bearer(request));
      const result = await deps.plans.settleSandbox(auth, request.params.id);
      return {
        object: "subscription_activation",
        subscription: presentSubscription(result.subscription, request.id),
        entitlement: presentEntitlement(result.entitlement, request.id),
        request_id: request.id
      };
    }
  );

  app.post<{ Params: { paymentHash: string }; Body: SandboxSettleBody | null }>(
    "/v1/sandbox/invoices/:paymentHash/settle",
    {
      schema: {
        body: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            amount_msat: { type: "integer", minimum: 1 },
            amount: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      if (!deps.sandboxEnabled) throw new PayError("PAY_AUTH_INVALID", "sandbox is disabled");
      if (!deps.sandboxToken || sandboxToken(request) !== deps.sandboxToken) {
        throw new PayError("PAY_AUTH_INVALID", "invalid sandbox token");
      }
      const body = request.body ?? {};
      const raw = body.amount_msat ?? body.amount;
      const amountMsat =
        body.amount_msat !== undefined
          ? BigInt(body.amount_msat)
          : raw !== undefined
            ? BigInt(raw) * 1000n
            : undefined;
      const result = await deps.settlements.sandboxSettle(request.params.paymentHash, amountMsat);
      return reply
        .code(result.status === "QUARANTINED" ? 202 : 200)
        .send(presentSettlement(result, request.id));
    }
  );
}
