import type { SettlementRecord, SettlementSummary } from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";

export class SettlementRepository extends BaseRepository {
  async summarize(
    merchantId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Omit<SettlementSummary, "id" | "status">> {
    const totals = await this.db.query<{
      transaction_count: number | string;
      gross_msat: string | null;
      fees_msat: string | null;
      net_msat: string | null;
    }>(
      `SELECT COUNT(*) AS transaction_count,
              COALESCE(SUM(amount_msat), 0) AS gross_msat,
              COALESCE(SUM(fee_msat), 0) AS fees_msat,
              COALESCE(SUM(net_msat), 0) AS net_msat
         FROM ${this.t("transactions")}
        WHERE merchant_id = $1 AND status = 'SETTLED'
          AND created_at >= $2 AND created_at < $3`,
      [merchantId, periodStart.toISOString(), periodEnd.toISOString()]
    );
    const refunds = await this.db.query<{
      refund_count: number | string;
      refunds_msat: string | null;
      refunds_fees_msat: string | null;
      refunds_net_msat: string | null;
    }>(
      `SELECT COUNT(*) AS refund_count,
              COALESCE(SUM(amount_msat), 0) AS refunds_msat,
              COALESCE(SUM(fee_msat), 0) AS refunds_fees_msat,
              COALESCE(SUM(net_msat), 0) AS refunds_net_msat
         FROM ${this.t("refunds")}
        WHERE merchant_id = $1 AND status = 'SUCCEEDED'
          AND created_at >= $2 AND created_at < $3`,
      [merchantId, periodStart.toISOString(), periodEnd.toISOString()]
    );
    const ledger = await this.db.query<{ debit_msat: string | null; credit_msat: string | null }>(
      `SELECT
         COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_msat ELSE 0 END), 0) AS debit_msat,
         COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_msat ELSE 0 END), 0) AS credit_msat
         FROM ${this.t("ledger_entries")} e
         JOIN ${this.t("transactions")} t ON t.id = e.transaction_id
        WHERE t.merchant_id = $1
          AND e.posted_at >= $2 AND e.posted_at < $3`,
      [merchantId, periodStart.toISOString(), periodEnd.toISOString()]
    );
    const row = totals.rows[0];
    const refundRow = refunds.rows[0];
    const ledgerRow = ledger.rows[0];
    const grossMsat = BigInt(row?.gross_msat ?? 0) - BigInt(refundRow?.refunds_msat ?? 0);
    const feesMsat = BigInt(row?.fees_msat ?? 0) - BigInt(refundRow?.refunds_fees_msat ?? 0);
    const netMsat = BigInt(row?.net_msat ?? 0) - BigInt(refundRow?.refunds_net_msat ?? 0);
    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      transactionCount: Number(row?.transaction_count ?? 0),
      grossMsat,
      feesMsat,
      netMsat,
      ledgerBalanced:
        BigInt(ledgerRow?.debit_msat ?? 0) === BigInt(ledgerRow?.credit_msat ?? 0)
    };
  }

  async get(merchantId: string, settlementId: string): Promise<SettlementSummary | null> {
    const result = await this.db.query<{
      id: string;
      period_start: Date | string;
      period_end: Date | string;
      gross_msat: string | number | bigint;
      fees_msat: string | number | bigint;
      net_msat: string | number | bigint;
      status: SettlementSummary["status"];
      transaction_count: number | string;
      ledger_balanced: boolean;
    }>(
      `SELECT id, period_start, period_end, gross_msat, fees_msat, net_msat, status,
              transaction_count, ledger_balanced
         FROM ${this.t("settlements")}
        WHERE id = $1 AND merchant_id = $2`,
      [settlementId, merchantId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      periodStart: new Date(row.period_start).toISOString(),
      periodEnd: new Date(row.period_end).toISOString(),
      transactionCount: Number(row.transaction_count),
      grossMsat: BigInt(row.gross_msat),
      feesMsat: BigInt(row.fees_msat),
      netMsat: BigInt(row.net_msat),
      ledgerBalanced: row.ledger_balanced,
      status: row.status
    };
  }

  async list(merchantId: string, limit: number): Promise<SettlementRecord[]> {
    const result = await this.db.query<{
      id: string;
      period_start: Date | string;
      period_end: Date | string;
      gross_msat: string | number | bigint;
      fees_msat: string | number | bigint;
      net_msat: string | number | bigint;
      status: SettlementSummary["status"];
      transaction_count: number | string;
      ledger_balanced: boolean;
      created_at: Date | string;
    }>(
      `SELECT id, period_start, period_end, gross_msat, fees_msat, net_msat, status,
              transaction_count, ledger_balanced, created_at
         FROM ${this.t("settlements")}
        WHERE merchant_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [merchantId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      periodStart: new Date(row.period_start).toISOString(),
      periodEnd: new Date(row.period_end).toISOString(),
      transactionCount: Number(row.transaction_count),
      grossMsat: BigInt(row.gross_msat),
      feesMsat: BigInt(row.fees_msat),
      netMsat: BigInt(row.net_msat),
      ledgerBalanced: row.ledger_balanced,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  async create(
    input: SettlementSummary & { organizationId: string; merchantId: string },
    now: Date
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO ${this.t("settlements")}
        (id, organization_id, merchant_id, period_start, period_end,
         gross_msat, fees_msat, net_msat, status, created_at,
         transaction_count, ledger_balanced)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.periodStart,
        input.periodEnd,
        input.grossMsat.toString(),
        input.feesMsat.toString(),
        input.netMsat.toString(),
        input.status,
        now.toISOString(),
        input.transactionCount,
        input.ledgerBalanced
      ]
    );
  }
}
