import type { MerchantLocation } from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import type { DbClient } from "../db/database.ts";
import { toIso } from "./rows.ts";

interface LocationRow {
  id: string;
  organization_id: string;
  merchant_id: string;
  name: string;
  code: string;
  status: MerchantLocation["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

function mapLocation(row: LocationRow): MerchantLocation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    merchantId: row.merchant_id,
    name: row.name,
    code: row.code,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export class LocationRepository extends BaseRepository {
  async list(merchantId: string): Promise<MerchantLocation[]> {
    const result = await this.db.query<LocationRow>(
      `SELECT * FROM ${this.t("merchant_locations")}
        WHERE merchant_id = $1
        ORDER BY created_at ASC, id ASC`,
      [merchantId]
    );
    return result.rows.map(mapLocation);
  }

  async getActive(merchantId: string, locationId: string): Promise<MerchantLocation | null> {
    const result = await this.db.query<LocationRow>(
      `SELECT * FROM ${this.t("merchant_locations")}
        WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'`,
      [locationId, merchantId]
    );
    return result.rows[0] ? mapLocation(result.rows[0]) : null;
  }

  async findByCode(merchantId: string, code: string): Promise<MerchantLocation | null> {
    const result = await this.db.query<LocationRow>(
      `SELECT * FROM ${this.t("merchant_locations")}
        WHERE merchant_id = $1 AND code = $2`,
      [merchantId, code]
    );
    return result.rows[0] ? mapLocation(result.rows[0]) : null;
  }

  async create(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      name: string;
      code: string;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<MerchantLocation> {
    const result = await client.query<LocationRow>(
      `INSERT INTO ${this.t("merchant_locations")}
        (id, organization_id, merchant_id, name, code, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6)
       RETURNING *`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.name,
        input.code,
        input.now.toISOString()
      ]
    );
    return mapLocation(result.rows[0]!);
  }

  async update(
    merchantId: string,
    locationId: string,
    input: { name: string | null; active: boolean | null },
    now: Date
  ): Promise<MerchantLocation | null> {
    const result = await this.db.query<LocationRow>(
      `UPDATE ${this.t("merchant_locations")}
          SET name = COALESCE($3, name),
              status = CASE
                WHEN $4::boolean IS NULL THEN status
                WHEN $4 THEN 'ACTIVE'
                ELSE 'DISABLED'
              END,
              updated_at = $5
        WHERE id = $1 AND merchant_id = $2
        RETURNING *`,
      [locationId, merchantId, input.name, input.active, now.toISOString()]
    );
    return result.rows[0] ? mapLocation(result.rows[0]) : null;
  }

  async disable(
    merchantId: string,
    locationId: string,
    now: Date
  ): Promise<MerchantLocation | null> {
    const result = await this.db.query<LocationRow>(
      `UPDATE ${this.t("merchant_locations")}
          SET status = 'DISABLED', updated_at = $3
        WHERE id = $1 AND merchant_id = $2
        RETURNING *`,
      [locationId, merchantId, now.toISOString()]
    );
    return result.rows[0] ? mapLocation(result.rows[0]) : null;
  }
}
