import type { FastifyInstance } from "fastify";
import { bearer, idempotencyKey, parseLimit } from "../http-input.ts";
import { presentRefund, presentRefunds } from "../presenters.ts";
import type { AppDependencies } from "../dependencies.ts";

interface CreateRefundBody {
  transaction_id: string;
  amount: number;
  reason?: string | null;
}

interface RefundListQuery {
  limit?: string;
  starting_after?: string;
}

export async function registerRefundRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post<{ Body: CreateRefundBody }>(
    "/v1/refunds",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["transaction_id", "amount"],
          properties: {
            transaction_id: { type: "string", minLength: 1, maxLength: 100 },
            amount: { type: "integer", minimum: 1 },
            reason: { type: ["string", "null"], maxLength: 200 }
          }
        }
      }
    },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const refund = await deps.refunds.createRefund(
        auth,
        request.body,
        idempotencyKey(request),
        request.id
      );
      return reply.code(201).send(refund);
    }
  );

  app.get<{ Querystring: RefundListQuery }>("/v1/refunds", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const page = await deps.refunds.listRefunds(auth, {
      limit: parseLimit(request.query.limit),
      startingAfter: request.query.starting_after
    });
    return presentRefunds(page, request.id);
  });

  app.get<{ Params: { id: string } }>("/v1/refunds/:id", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const refund = await deps.refunds.getRefund(auth, request.params.id);
    return presentRefund(refund, request.id);
  });
}
