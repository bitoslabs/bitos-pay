import type { ExchangeQuote } from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import { toIso } from "./rows.ts";

interface QuoteRow {
  id: string;
  base_currency: string;
  quote_currency: string;
  base_amount: string | number | bigint | null;
  quote_amount: string | number | bigint | null;
  rate: string;
  source: string;
  quoted_at: Date | string;
  expires_at: Date | string;
}

export class QuoteRepository extends BaseRepository {
  async create(input: ExchangeQuote): Promise<ExchangeQuote> {
    await this.db.query(
      `INSERT INTO ${this.t("exchange_quotes")}
        (id, base_currency, quote_currency, base_amount, quote_amount, rate, source, quoted_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.id,
        input.baseCurrency,
        input.quoteCurrency,
        input.baseAmount,
        input.quoteAmount,
        input.rate,
        input.source,
        input.quotedAt,
        input.expiresAt
      ]
    );
    return input;
  }

  async get(id: string): Promise<ExchangeQuote | null> {
    const result = await this.db.query<QuoteRow>(
      `SELECT id, base_currency, quote_currency, base_amount, quote_amount, rate, source,
              quoted_at, expires_at
         FROM ${this.t("exchange_quotes")} WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      baseCurrency: row.base_currency,
      quoteCurrency: row.quote_currency,
      baseAmount: Number(row.base_amount ?? 0),
      quoteAmount: Number(row.quote_amount ?? 0),
      rate: row.rate,
      source: row.source,
      quotedAt: toIso(row.quoted_at),
      expiresAt: toIso(row.expires_at)
    };
  }
}
