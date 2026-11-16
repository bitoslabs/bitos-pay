import type { DbClient } from "../db/database.ts";
import type {
  BalanceLine,
  LedgerAccountType,
  LedgerDirection
} from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";

export class LedgerRepository extends BaseRepository {
  async ensureAccount(
    input: {
      id: string;
      organizationId: string;
      code: string;
      type: LedgerAccountType;
      currency: string;
      scale: number;
      now: Date;
    },
    client: DbClient
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO ${this.t("ledger_accounts")}
        (id, organization_id, code, type, currency, scale, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id, code, currency, scale) DO UPDATE SET code = EXCLUDED.code
       RETURNING id`,
      [
        input.id,
        input.organizationId,
        input.code,
        input.type,
        input.currency,
        input.scale,
        input.now.toISOString()
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("failed to ensure ledger account");
    return row.id;
  }

  async insertEntry(
    input: {
      id: string;
      organizationId: string;
      transactionId: string;
      accountId: string;
      direction: LedgerDirection;
      amountMsat: bigint;
      currency: string;
      scale: number;
      refundId?: string;
      now: Date;
    },
    client: DbClient
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("ledger_entries")}
        (id, organization_id, transaction_id, account_id, direction, amount_msat, currency, scale, refund_id, posted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.id,
        input.organizationId,
        input.transactionId,
        input.accountId,
        input.direction,
        input.amountMsat.toString(),
        input.currency,
        input.scale,
        input.refundId ?? null,
        input.now.toISOString()
      ]
    );
  }

  async transactionBalance(
    organizationId: string,
    transactionId: string,
    client: DbClient
  ): Promise<{ debit: bigint; credit: bigint }> {
    const result = await client.query<{ debit: string | null; credit: string | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_msat ELSE 0 END), 0) AS debit,
         COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_msat ELSE 0 END), 0) AS credit
       FROM ${this.t("ledger_entries")}
       WHERE organization_id = $1 AND transaction_id = $2`,
      [organizationId, transactionId]
    );
    const row = result.rows[0];
    return { debit: BigInt(row?.debit ?? 0), credit: BigInt(row?.credit ?? 0) };
  }

  async balances(merchantId: string): Promise<BalanceLine[]> {
    const result = await this.db.query<{
      account_code: string;
      account_type: LedgerAccountType;
      currency: string;
      scale: number;
      debit_msat: string;
      credit_msat: string;
    }>(
      `SELECT a.code AS account_code, a.type AS account_type, a.currency, a.scale,
              COALESCE(SUM(CASE WHEN e.direction = 'debit' AND t.merchant_id = $1 THEN e.amount_msat ELSE 0 END), 0) AS debit_msat,
              COALESCE(SUM(CASE WHEN e.direction = 'credit' AND t.merchant_id = $1 THEN e.amount_msat ELSE 0 END), 0) AS credit_msat
         FROM ${this.t("ledger_accounts")} a
         JOIN ${this.t("merchants")} m ON m.organization_id = a.organization_id
         LEFT JOIN ${this.t("ledger_entries")} e ON e.account_id = a.id
         LEFT JOIN ${this.t("transactions")} t ON t.id = e.transaction_id
        WHERE m.id = $1
        GROUP BY a.code, a.type, a.currency, a.scale
        ORDER BY a.code`,
      [merchantId]
    );
    return result.rows.map((row) => {
      const debit = BigInt(row.debit_msat);
      const credit = BigInt(row.credit_msat);
      const balance =
        row.account_type === "ASSET" || row.account_type === "EXPENSE"
          ? debit - credit
          : credit - debit;
      return {
        account_code: row.account_code,
        account_type: row.account_type,
        currency: row.currency,
        scale: Number(row.scale),
        debit_msat: debit.toString(),
        credit_msat: credit.toString(),
        balance_msat: balance.toString()
      };
    });
  }
}
