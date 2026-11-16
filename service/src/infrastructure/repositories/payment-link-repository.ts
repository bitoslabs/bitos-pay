import type { DbClient } from "../db/database.ts";
import type { PaymentLink, PaymentLinkStatus } from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import { toIso } from "./rows.ts";

interface PaymentLinkRow {
  id: string;
  organization_id: string;
  merchant_id: string;
  amount_msat: string | number | bigint;
  currency: string;
  scale: number;
  reference: string | null;
  label: string | null;
  status: PaymentLinkStatus;
  created_at: Date | string;
  disabled_at: Date | string | null;
}

function mapLink(row: PaymentLinkRow): PaymentLink {
  return {
    id: row.id,
    organizationId: row.organization_id,
    merchantId: row.merchant_id,
    amountMsat: BigInt(row.amount_msat),
    currency: row.currency,
    scale: Number(row.scale),
    reference: row.reference,
    label: row.label,
    status: row.status,
    createdAt: toIso(row.created_at),
    disabledAt: row.disabled_at ? toIso(row.disabled_at) : null
  };
}

export class PaymentLinkRepository extends BaseRepository {
  async create(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      amountMsat: bigint;
      currency: string;
      scale: number;
      reference: string | null;
      label: string | null;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("payment_links")}
        (id, organization_id, merchant_id, amount_msat, currency, scale, reference, label, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9)`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.amountMsat.toString(),
        input.currency,
        input.scale,
        input.reference,
        input.label,
        input.now.toISOString()
      ]
    );
  }

  async list(merchantId: string): Promise<PaymentLink[]> {
    const result = await this.db.query<PaymentLinkRow>(
      `SELECT * FROM ${this.t("payment_links")}
        WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [merchantId]
    );
    return result.rows.map(mapLink);
  }

  async getActiveById(linkId: string): Promise<PaymentLink | null> {
    const result = await this.db.query<PaymentLinkRow>(
      `SELECT * FROM ${this.t("payment_links")}
        WHERE id = $1 AND status = 'ACTIVE'`,
      [linkId]
    );
    return result.rows[0] ? mapLink(result.rows[0]) : null;
  }

  async disable(
    merchantId: string,
    linkId: string,
    now: Date
  ): Promise<PaymentLink | null> {
    const result = await this.db.query<PaymentLinkRow>(
      `UPDATE ${this.t("payment_links")}
          SET status = 'DISABLED', disabled_at = $3
        WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'
        RETURNING *`,
      [linkId, merchantId, now.toISOString()]
    );
    return result.rows[0] ? mapLink(result.rows[0]) : null;
  }
}
