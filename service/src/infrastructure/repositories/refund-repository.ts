import type { DbClient } from "../db/database.ts";
import type { Page, Refund, RefundListOptions, RefundStatus } from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import { mapRefund, type RefundRow } from "./rows.ts";

export class RefundRepository extends BaseRepository {
  async create(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      transactionId: string;
      paymentIntentId: string;
      amountMsat: bigint;
      feeMsat: bigint;
      netMsat: bigint;
      currency: string;
      scale: number;
      reason: string | null;
      status: RefundStatus;
      livemode: boolean;
      createdAt: Date;
      settledAt: Date | null;
    },
    client: DbClient
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("refunds")}
        (id, organization_id, merchant_id, transaction_id, payment_intent_id,
         amount_msat, fee_msat, net_msat, currency, scale, reason, status, livemode,
         created_at, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.transactionId,
        input.paymentIntentId,
        input.amountMsat.toString(),
        input.feeMsat.toString(),
        input.netMsat.toString(),
        input.currency,
        input.scale,
        input.reason,
        input.status,
        input.livemode,
        input.createdAt.toISOString(),
        input.settledAt?.toISOString() ?? null
      ]
    );
  }

  async get(merchantId: string, refundId: string): Promise<Refund | null> {
    const result = await this.db.query<RefundRow>(
      `SELECT * FROM ${this.t("refunds")} WHERE id = $1 AND merchant_id = $2`,
      [refundId, merchantId]
    );
    return result.rows[0] ? mapRefund(result.rows[0]) : null;
  }

  async sumSucceededForTransaction(
    merchantId: string,
    transactionId: string,
    client: DbClient
  ): Promise<bigint> {
    const result = await client.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount_msat), 0) AS total
         FROM ${this.t("refunds")}
        WHERE merchant_id = $1 AND transaction_id = $2 AND status = 'SUCCEEDED'`,
      [merchantId, transactionId]
    );
    return BigInt(result.rows[0]?.total ?? 0);
  }

  async listForIntent(merchantId: string, paymentIntentId: string, limit: number): Promise<Refund[]> {
    const result = await this.db.query<RefundRow>(
      `SELECT * FROM ${this.t("refunds")}
        WHERE merchant_id = $1 AND payment_intent_id = $2
        ORDER BY created_at DESC, id DESC LIMIT $3`,
      [merchantId, paymentIntentId, limit]
    );
    return result.rows.map(mapRefund);
  }

  async list(merchantId: string, options: RefundListOptions): Promise<Page<Refund>> {
    const params: unknown[] = [merchantId];
    let where = "r.merchant_id = $1";
    if (options.startingAfter) {
      params.push(options.startingAfter);
      where += ` AND (r.created_at, r.id) < (
        SELECT created_at, id FROM ${this.t("refunds")}
         WHERE id = $${params.length} AND merchant_id = $1
      )`;
    }
    params.push(options.limit + 1);
    const result = await this.db.query<RefundRow>(
      `SELECT r.* FROM ${this.t("refunds")} r
        WHERE ${where}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $${params.length}`,
      params
    );
    return {
      items: result.rows.slice(0, options.limit).map(mapRefund),
      hasMore: result.rows.length > options.limit
    };
  }
}
