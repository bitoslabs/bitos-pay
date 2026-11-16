import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { bearer } from "../http-input.ts";
import { presentQuote } from "../presenters.ts";

interface CreateQuoteBody {
  base_currency: string;
  quote_currency: string;
  amount: number;
}

export async function registerQuoteRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  app.post<{ Body: CreateQuoteBody }>(
    "/v1/exchange/quotes",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["base_currency", "quote_currency", "amount"],
          properties: {
            base_currency: { type: "string", minLength: 3, maxLength: 8 },
            quote_currency: { type: "string", minLength: 3, maxLength: 8 },
            amount: { type: "integer", minimum: 1 }
          }
        }
      }
    },
    async (request, reply) => {
      const auth = await deps.auth.authenticate(bearer(request));
      const quote = await deps.quotes.createQuote(auth, request.body);
      return reply.code(201).send(presentQuote(quote, request.id));
    }
  );

  app.get<{ Params: { id: string } }>("/v1/exchange/quotes/:id", async (request) => {
    const auth = await deps.auth.authenticate(bearer(request));
    const quote = await deps.quotes.getQuote(auth, request.params.id);
    return presentQuote(quote, request.id);
  });
}
