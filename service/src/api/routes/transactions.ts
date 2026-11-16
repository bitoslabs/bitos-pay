import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer, parseLimit } from "../http-input.ts";
import { presentTransactions } from "../presenters.ts";
import { transactionListQuerySchema } from "../schemas/lists.ts";

interface TransactionListQuery {
  limit?: string;
  starting_after?: string;
  status?: "DETECTED" | "CONFIRMED" | "SETTLED" | "REVERSED";
}

export async function registerTransactionRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get<{ Querystring: TransactionListQuery }>(
    "/v1/transactions",
    { schema: { querystring: transactionListQuerySchema } },
    async (request) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const page = await deps.ledgerQuery.listTransactions(auth, {
        limit: parseLimit(request.query.limit),
        startingAfter: request.query.starting_after,
        status: request.query.status
      });
      const last = page.items.at(-1);
      return {
        ...presentTransactions(page.items, request.id),
        has_more: page.hasMore,
        next_cursor: page.hasMore && last ? last.id : null
      };
    }
  );
}
