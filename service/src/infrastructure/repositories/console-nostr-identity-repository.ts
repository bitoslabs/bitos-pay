import type { DbClient } from "../db/database.ts";
import type { MerchantMemberRole } from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import { toIso, toIsoOrNull } from "./rows.ts";

export type ConsoleNostrIdentityStatus = "ACTIVE" | "REVOKED";

export interface ConsoleNostrIdentityRow {
  id: string;
  merchant_id: string;
  organization_id: string;
  api_key_id: string;
  pubkey: string;
  status: ConsoleNostrIdentityStatus;
  role: MerchantMemberRole;
  label: string | null;
  created_at: Date | string;
  last_seen_at: Date | string;
  revoked_at: Date | string | null;
}

export interface ConsoleNostrIdentity {
  id: string;
  merchantId: string;
  organizationId: string;
  apiKeyId: string;
  pubkey: string;
  status: ConsoleNostrIdentityStatus;
  role: MerchantMemberRole;
  label: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

function mapIdentity(row: ConsoleNostrIdentityRow): ConsoleNostrIdentity {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    organizationId: row.organization_id,
    apiKeyId: row.api_key_id,
    pubkey: row.pubkey,
    status: row.status,
    role: row.role,
    label: row.label,
    createdAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    revokedAt: toIsoOrNull(row.revoked_at)
  };
}

export class ConsoleNostrIdentityRepository extends BaseRepository {
  async create(
    input: {
      id: string;
      merchantId: string;
      organizationId: string;
      apiKeyId: string;
      pubkey: string;
      role?: MerchantMemberRole;
      label?: string | null;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<ConsoleNostrIdentity> {
    const result = await client.query<ConsoleNostrIdentityRow>(
      `INSERT INTO ${this.t("console_nostr_identities")}
        (id, merchant_id, organization_id, api_key_id, pubkey, status, role, label, created_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$8,$8)
       RETURNING *`,
      [
        input.id,
        input.merchantId,
        input.organizationId,
        input.apiKeyId,
        input.pubkey,
        input.role ?? "OWNER",
        input.label ?? null,
        input.now.toISOString()
      ]
    );
    return mapIdentity(result.rows[0]!);
  }

  async findActiveByPubkey(pubkey: string): Promise<ConsoleNostrIdentity | null> {
    const result = await this.db.query<ConsoleNostrIdentityRow>(
      `SELECT * FROM ${this.t("console_nostr_identities")}
        WHERE pubkey = $1 AND status = 'ACTIVE' AND revoked_at IS NULL`,
      [pubkey]
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }

  async findActiveByApiKey(apiKeyId: string): Promise<ConsoleNostrIdentity | null> {
    const result = await this.db.query<ConsoleNostrIdentityRow>(
      `SELECT * FROM ${this.t("console_nostr_identities")}
        WHERE api_key_id = $1 AND status = 'ACTIVE' AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [apiKeyId]
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }

  async findByPubkey(pubkey: string): Promise<ConsoleNostrIdentity | null> {
    const result = await this.db.query<ConsoleNostrIdentityRow>(
      `SELECT * FROM ${this.t("console_nostr_identities")} WHERE pubkey = $1`,
      [pubkey]
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }

  async listByMerchant(merchantId: string): Promise<ConsoleNostrIdentity[]> {
    const result = await this.db.query<ConsoleNostrIdentityRow>(
      `SELECT * FROM ${this.t("console_nostr_identities")}
        WHERE merchant_id = $1
        ORDER BY created_at ASC, id ASC`,
      [merchantId]
    );
    return result.rows.map(mapIdentity);
  }

  async getForMerchant(
    merchantId: string,
    identityId: string
  ): Promise<ConsoleNostrIdentity | null> {
    const result = await this.db.query<ConsoleNostrIdentityRow>(
      `SELECT * FROM ${this.t("console_nostr_identities")}
        WHERE id = $1 AND merchant_id = $2`,
      [identityId, merchantId]
    );
    return result.rows[0] ? mapIdentity(result.rows[0]) : null;
  }

  async revoke(id: string, merchantId: string, now: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE ${this.t("console_nostr_identities")}
          SET status = 'REVOKED', revoked_at = $3
        WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'`,
      [id, merchantId, now.toISOString()]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async touch(id: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE ${this.t("console_nostr_identities")} SET last_seen_at = $2
        WHERE id = $1 AND status = 'ACTIVE'`,
      [id, now.toISOString()]
    );
  }

  async revokeByPubkey(pubkey: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE ${this.t("console_nostr_identities")}
          SET status = 'REVOKED', revoked_at = $2
        WHERE pubkey = $1 AND status = 'ACTIVE'`,
      [pubkey, now.toISOString()]
    );
  }
}
