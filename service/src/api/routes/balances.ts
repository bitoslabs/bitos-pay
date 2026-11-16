import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer } from "../http-input.ts";
import { presentBalances } from "../presenters.ts";

export async function registerBalanceRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.get("/v1/balances", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const balances = await deps.ledgerQuery.getBalances(auth);
    return presentBalances(balances, request.id);
  });
}
