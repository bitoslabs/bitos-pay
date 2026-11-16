import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer, idempotencyKey, parseLimit } from "../http-input.ts";
import {
  presentWebhookDeliveries,
  presentWebhookDelivery,
  presentWebhookEndpoint,
  presentWebhookEndpoints,
  presentWebhookRegistration,
  presentWebhookRotation
} from "../presenters.ts";

interface RegisterWebhookBody {
  url: string;
  events: string[];
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post<{ Body: RegisterWebhookBody }>(
    "/v1/webhook-endpoints",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["url", "events"],
          properties: {
            url: { type: "string", minLength: 1, maxLength: 2048 },
            events: { type: "array", minItems: 1, items: { type: "string" } }
          }
        }
      }
    },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const registration = await deps.webhooks.registerEndpoint(
        auth,
        request.body,
        idempotencyKey(request)
      );
      return reply.code(201).send(presentWebhookRegistration(registration, request.id));
    }
  );

  app.patch<{ Params: { id: string }; Body: { events: string[] } }>(
    "/v1/webhook-endpoints/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["events"],
          properties: {
            events: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 }
            }
          }
        }
      }
    },
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const endpoint = await deps.webhooks.updateEndpoint(
        auth,
        request.params.id,
        request.body.events
      );
      return { ...presentWebhookEndpoint(endpoint), request_id: request.id };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/v1/webhook-endpoints/:id/rotate",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const rotation = await deps.webhooks.rotateEndpointSecret(auth, request.params.id);
      return presentWebhookRotation(rotation, request.id);
    }
  );

  app.get("/v1/webhook-endpoints", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const endpoints = await deps.webhooks.listEndpoints(auth);
    return presentWebhookEndpoints(endpoints, request.id);
  });

  app.post<{ Params: { id: string } }>(
    "/v1/webhook-endpoints/:id/disable",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const endpoint = await deps.webhooks.disableEndpoint(auth, request.params.id);
      return { ...presentWebhookEndpoint(endpoint), request_id: request.id };
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    "/v1/webhook-deliveries",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const deliveries = await deps.webhooks.listDeliveries(
        auth,
        parseLimit(request.query.limit, 50)
      );
      return presentWebhookDeliveries(deliveries, request.id);
    }
  );

  app.post<{ Params: { id: string } }>(
    "/v1/webhook-deliveries/:id/replay",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const delivery = await deps.webhooks.replayDelivery(auth, request.params.id);
      return { ...presentWebhookDelivery(delivery), request_id: request.id };
    }
  );
}
