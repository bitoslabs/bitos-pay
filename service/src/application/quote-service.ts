import { PayError, newId } from "../domain/index.ts";
import type { AuthContext, ExchangeQuote } from "../domain/types.ts";
import type { QuoteRepository } from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export interface CreateQuoteInput {
  base_currency: string;
  quote_currency: string;
  amount: number;
}

interface RatePair {
  rate: string;
  numerator: bigint;
  denominator: bigint;
}

const QUOTE_TTL_SECONDS = 60;
const RATES: Record<string, RatePair> = {
  "SAT:LAK": { rate: "0.25", numerator: 1n, denominator: 4n },
  "LAK:SAT": { rate: "4", numerator: 4n, denominator: 1n }
};

export class QuoteService {
  private readonly quotes: QuoteRepository;
  private readonly auth: AuthService;
  private readonly now: () => Date;

  constructor(quotes: QuoteRepository, auth: AuthService, now: () => Date = () => new Date()) {
    this.quotes = quotes;
    this.auth = auth;
    this.now = now;
  }

  async createQuote(auth: AuthContext, input: CreateQuoteInput): Promise<ExchangeQuote> {
    this.auth.requireScope(auth, "payments:read");
    const base = input.base_currency.toUpperCase();
    const quote = input.quote_currency.toUpperCase();
    const pair = RATES[`${base}:${quote}`];
    if (!pair) throw new PayError("PAY_VALIDATION_CURRENCY", `${base}/${quote} is not supported`);
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > 1_000_000_000_000) {
      throw new PayError("PAY_VALIDATION_AMOUNT");
    }
    const now = this.now();
    const quoteAmount = (BigInt(input.amount) * pair.numerator) / pair.denominator;
    const exchangeQuote: ExchangeQuote = {
      id: newId("qte"),
      baseCurrency: base,
      quoteCurrency: quote,
      baseAmount: input.amount,
      quoteAmount: Number(quoteAmount),
      rate: pair.rate,
      source: "sandbox-fixed",
      quotedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + QUOTE_TTL_SECONDS * 1000).toISOString()
    };
    await this.quotes.create(exchangeQuote);
    return exchangeQuote;
  }

  async getQuote(auth: AuthContext, quoteId: string): Promise<ExchangeQuote & { expired: boolean }> {
    this.auth.requireScope(auth, "payments:read");
    const quote = await this.quotes.get(quoteId);
    if (!quote) throw new PayError("PAY_NOT_FOUND_QUOTE");
    return { ...quote, expired: Date.parse(quote.expiresAt) <= this.now().getTime() };
  }
}
