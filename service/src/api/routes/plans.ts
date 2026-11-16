import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer } from "../http-input.ts";
import {
  presentEntitlement,
  presentPlan,
  presentSubscriptionInvoice
} from "../presenters.ts";

interface CreateSubscriptionBody {
  plan_code: string;
}

export async function registerPlanRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get("/v1/plans", async (request) => {
    const plans = await deps.plans.listPlans();
    return {
      object: "list",
      data: plans.map((plan) => presentPlan(plan, request.id)),
      request_id: request.id
    };
  });

  app.post<{ Body: CreateSubscriptionBody }>(
    "/v1/subscriptions",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["plan_code"],
          properties: {
            plan_code: { type: "string", minLength: 2, maxLength: 80 }
          }
        }
      }
    },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const result = await deps.plans.createSubscription(auth, request.body.plan_code);
      return reply.code(201).send(presentSubscriptionInvoice(result, request.id));
    }
  );

  app.get("/v1/entitlements/current", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const entitlement = await deps.plans.getEntitlement(auth);
    if (!entitlement) {
      return {
        object: "entitlement",
        organization_id: auth.organizationId,
        plan: null,
        features: [],
        limits: {},
        status: "EXPIRED",
        revision: 0,
        request_id: request.id
      };
    }
    return presentEntitlement(entitlement, request.id);
  });
}
