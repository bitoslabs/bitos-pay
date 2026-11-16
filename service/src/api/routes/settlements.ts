import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { PayError } from "../../domain/index.ts";
import { bearer } from "../http-input.ts";
import { presentSettlementSummary } from "../presenters.ts";

interface PeriodQuery {
  from?: string;
  to?: string;
}

interface ListQuery {
  limit?: string;
}

interface ReconcileBody {
  period_start: string;
  period_end: string;
}

function defaultPeriod(): { from: Date; to: Date } {
  const to = new Date();
  return { from: new Date(to.getTime() - 24 * 60 * 60_000), to };
}

export async function registerSettlementRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get<{ Querystring: PeriodQuery }>("/v1/settlements/summary", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const fallback = defaultPeriod();
    const from = request.query.from ? new Date(request.query.from) : fallback.from;
    const to = request.query.to ? new Date(request.query.to) : fallback.to;
    const summary = await deps.settlementReports.summary(auth, from, to);
    return presentSettlementSummary(summary, request.id);
  });

  app.get<{ Querystring: ListQuery }>("/v1/settlements", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const limit = request.query.limit ? Number(request.query.limit) : 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new PayError("PAY_VALIDATION_BODY", "limit must be an integer between 1 and 100");
    }
    const records = await deps.settlementReports.list(auth, limit);
    return {
      object: "list",
      data: records.map((record) => presentSettlementSummary(record, request.id)),
      request_id: request.id
    };
  });

  app.get<{ Params: { id: string } }>("/v1/settlements/:id", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const summary = await deps.settlementReports.get(auth, request.params.id);
    return presentSettlementSummary(summary, request.id);
  });

  app.post<{ Body: ReconcileBody }>(
    "/v1/settlements/reconcile",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["period_start", "period_end"],
          properties: {
            period_start: { type: "string", minLength: 1, maxLength: 40 },
            period_end: { type: "string", minLength: 1, maxLength: 40 }
          }
        }
      }
    },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const summary = await deps.settlementReports.reconcile(
        auth,
        new Date(request.body.period_start),
        new Date(request.body.period_end)
      );
      return reply.code(201).send(presentSettlementSummary(summary, request.id));
    }
  );
}
