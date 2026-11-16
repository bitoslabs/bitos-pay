import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer, idempotencyKey } from "../http-input.ts";
import { presentCreatedInvoice, presentInvoice } from "../presenters.ts";
import { createIntentSchema, type CreateIntentBody } from "../schemas/payment-intent.ts";

export async function registerInvoiceRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post<{ Body: CreateIntentBody }>(
    "/v1/invoices",
    { schema: createIntentSchema },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const result = await deps.paymentIntents.createInvoice(
        auth,
        {
          amount: request.body.amount,
          currency: request.body.currency,
          scale: request.body.scale,
          payment_method: request.body.payment_method,
          external_reference: request.body.external_reference ?? null,
          metadata: request.body.metadata ?? {}
        },
        idempotencyKey(request),
        request.id
      );
      return reply.code(201).send(presentCreatedInvoice(result));
    }
  );

  app.get<{ Params: { id: string } }>("/v1/invoices/:id", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const invoice = await deps.paymentIntents.getInvoice(auth, request.params.id);
    return presentInvoice(invoice, request.id);
  });
}
