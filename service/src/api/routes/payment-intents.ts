import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer, idempotencyKey, parseLimit } from "../http-input.ts";
import { createIntentSchema, type CreateIntentBody } from "../schemas/payment-intent.ts";
import { intentListQuerySchema } from "../schemas/lists.ts";
import {
  presentCreatedIntent,
  presentIntent,
  presentIntentView
} from "../presenters.ts";

interface IntentParams {
  id: string;
}

interface PaymentListQuery {
  limit?: string;
  starting_after?: string;
  status?: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";
}

export async function registerPaymentIntentRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post<{ Body: CreateIntentBody }>(
    "/v1/payment-intents",
    { schema: createIntentSchema },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const result = await deps.paymentIntents.createPaymentIntent(
        auth,
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

  app.get<{ Params: IntentParams }>("/v1/payment-intents/:id", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const view = await deps.paymentIntents.getPaymentIntent(auth, request.params.id);
    return {
      ...presentIntentView(view, request.id),
      checkout_url: deps.checkout.urlForIntent(view.intent.id)
    };
  });

  app.post<{ Params: IntentParams }>("/v1/payment-intents/:id/cancel", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const view = await deps.paymentIntents.cancelPaymentIntent(auth, request.params.id);
    return presentIntentView(view, request.id);
  });

  app.get<{ Querystring: PaymentListQuery }>(
    "/v1/payments",
    { schema: { querystring: intentListQuerySchema } },
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const page = await deps.paymentIntents.listPayments(auth, {
        limit: parseLimit(request.query.limit),
        startingAfter: request.query.starting_after,
        status: request.query.status
      });
      const last = page.items.at(-1);
      return {
        object: "list",
        data: page.items.map(presentIntent),
        has_more: page.hasMore,
        next_cursor: page.hasMore && last ? last.id : null,
        request_id: request.id
      };
    }
  );
}
