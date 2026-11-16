import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer } from "../http-input.ts";
import {
  presentApiKey,
  presentApiKeys,
  presentApiKeyTelemetry,
  presentCreatedApiKey
} from "../presenters.ts";

interface CreateApiKeyBody {
  label?: string | null;
  scopes?: string[];
  expires_in_days?: number | null;
}

interface UpdateApiKeyBody {
  label?: string | null;
}

export async function registerApiKeyRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get("/v1/api-keys", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const keys = await deps.apiKeys.listKeys(auth);
    return presentApiKeys(keys, request.id);
  });

  app.post<{ Body: CreateApiKeyBody | null }>(
    "/v1/api-keys",
    {
      schema: {
        body: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            label: { type: ["string", "null"], maxLength: 80 },
            scopes: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 80 }
            },
            expires_in_days: { type: ["integer", "null"], minimum: 1, maximum: 365 }
          }
        }
      }
    },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const key = await deps.apiKeys.createKey(auth, request.body ?? {});
      return reply.code(201).send(presentCreatedApiKey(key, request.id));
    }
  );

  app.patch<{ Params: { id: string }; Body: UpdateApiKeyBody }>(
    "/v1/api-keys/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: ["string", "null"], maxLength: 80 }
          }
        }
      }
    },
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const key = await deps.apiKeys.updateLabel(auth, request.params.id, request.body.label);
      return presentApiKey(key, request.id);
    }
  );

  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>(
    "/v1/api-keys/:id/telemetry",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const hours = request.query.hours ? Number(request.query.hours) : 24;
      const telemetry = await deps.monitoring.getApiKeyTelemetry(
        auth,
        request.params.id,
        Number.isFinite(hours) ? hours : 24
      );
      return presentApiKeyTelemetry(telemetry, request.id);
    }
  );

  app.post<{ Params: { id: string } }>("/v1/api-keys/:id/rotate", async (request, reply) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const key = await deps.apiKeys.rotateKey(auth, request.params.id);
    return reply.code(201).send(presentCreatedApiKey(key, request.id));
  });

  app.post<{ Params: { id: string } }>("/v1/api-keys/:id/revoke", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const key = await deps.apiKeys.revokeKey(auth, request.params.id);
    return presentApiKey(key, request.id);
  });
}
