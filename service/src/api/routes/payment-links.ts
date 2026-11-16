import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer, idempotencyKey } from "../http-input.ts";
import {
  presentCreatedPaymentLink,
  presentPaymentLink,
  presentPaymentLinks,
  presentPublicPaymentLink
} from "../presenters.ts";

interface CreatePaymentLinkBody {
  amount: number;
  currency: string;
  scale: number;
  reference?: string | null;
  label?: string | null;
}

const createSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["amount", "currency", "scale"],
    properties: {
      amount: { type: "integer", minimum: 1 },
      currency: { type: "string", maxLength: 12 },
      scale: { type: "integer", minimum: 0, maximum: 12 },
      reference: { type: ["string", "null"], maxLength: 200 },
      label: { type: ["string", "null"], maxLength: 120 }
    }
  }
} as const;

export async function registerPaymentLinkRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post<{ Body: CreatePaymentLinkBody }>(
    "/v1/payment-links",
    { schema: createSchema },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const created = await deps.paymentLinks.create(
        auth,
        request.body,
        idempotencyKey(request)
      );
      return reply.code(201).send(presentCreatedPaymentLink(created, request.id));
    }
  );

  app.get("/v1/payment-links", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const links = await deps.paymentLinks.list(auth);
    return presentPaymentLinks(links, (linkId) => deps.paymentLinks.urlForLink(linkId), request.id);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/payment-links/:id/disable",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const link = await deps.paymentLinks.disable(auth, request.params.id);
      return {
        ...presentPaymentLink(link, deps.paymentLinks.urlForLink(link.id)),
        request_id: request.id
      };
    }
  );

  app.get<{ Params: { token: string } }>(
    "/v1/payment-links/:token",
    async (request, reply) => {
      const link = await deps.paymentLinks.publicView(request.params.token);
      return reply
        .header("cache-control", "no-store")
        .header("referrer-policy", "no-referrer")
        .header("x-robots-tag", "noindex")
        .send(presentPublicPaymentLink(link, request.id));
    }
  );

  app.post<{ Params: { token: string } }>(
    "/v1/payment-links/:token/checkout",
    async (request, reply) => {
      const created = await deps.paymentLinks.createCheckout(
        request.params.token,
        idempotencyKey(request),
        request.id,
        request.ip
      );
      return reply.code(201).send({
        object: "payment_link_checkout",
        ...created,
        request_id: request.id
      });
    }
  );
}
