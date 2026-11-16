import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer } from "../http-input.ts";
import { presentLocation, presentLocations } from "../presenters.ts";

interface LocationBody {
  name: string;
  code: string;
}

export async function registerLocationRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get("/v1/locations", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    return presentLocations(await deps.locations.list(auth), request.id);
  });

  app.post<{ Body: LocationBody }>(
    "/v1/locations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name", "code"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            code: { type: "string", minLength: 2, maxLength: 24 }
          }
        }
      }
    },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const location = await deps.locations.create(auth, request.body);
      return reply.code(201).send(presentLocation(location, request.id));
    }
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; active?: boolean } }>(
    "/v1/locations/:id",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            active: { type: "boolean" }
          }
        }
      }
    },
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      return presentLocation(
        await deps.locations.update(auth, request.params.id, request.body),
        request.id
      );
    }
  );

  app.post<{ Params: { id: string } }>(
    "/v1/locations/:id/disable",
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      return presentLocation(await deps.locations.disable(auth, request.params.id), request.id);
    }
  );
}
