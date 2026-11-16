import type { DbClient } from "../db/database.ts";
import { BaseRepository } from "./base-repository.ts";
import { toIso, toIsoOrNull, toJsonArray } from "./rows.ts";

export interface ConsoleSessionRow {
  id: string;
  merchant_id: string;
  organization_id: string;
  api_key_id: string;
  token_hash: string;
  csrf_hash: string;
  scopes: unknown;
  livemode: boolean;
  auth_method: "api_key" | "nostr";
  nostr_pubkey: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
}

export interface ConsoleSessionRecord {
  id: string;
  merchantId: string;
  organizationId: string;
  apiKeyId: string;
  csrfHash: string;
  scopes: string[];
  livemode: boolean;
  authMethod: "api_key" | "nostr";
  nostrPubkey: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

function mapSession(row: ConsoleSessionRow): ConsoleSessionRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    organizationId: row.organization_id,
    apiKeyId: row.api_key_id,
    csrfHash: row.csrf_hash,
    scopes: toJsonArray(row.scopes),
    livemode: row.livemode,
    authMethod: row.auth_method,
    nostrPubkey: row.nostr_pubkey,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    revokedAt: toIsoOrNull(row.revoked_at)
  };
}

export class ConsoleSessionRepository extends BaseRepository {
  async create(
    input: {
      id: string;
      merchantId: string;
      organizationId: string;
      apiKeyId: string;
      tokenHash: string;
      csrfHash: string;
      scopes: string[];
      livemode: boolean;
      authMethod: "api_key" | "nostr";
      nostrPubkey: string | null;
      now: Date;
      expiresAt: Date;
    },
    client: DbClient = this.db
  ): Promise<ConsoleSessionRecord> {
    const result = await client.query<ConsoleSessionRow>(
      `INSERT INTO ${this.t("console_sessions")}
        (id, merchant_id, organization_id, api_key_id, token_hash, csrf_hash, scopes,
         livemode, auth_method, nostr_pubkey, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        input.id,
        input.merchantId,
        input.organizationId,
        input.apiKeyId,
        input.tokenHash,
        input.csrfHash,
        JSON.stringify(input.scopes),
        input.livemode,
        input.authMethod,
        input.nostrPubkey,
        input.now.toISOString(),
        input.expiresAt.toISOString()
      ]
    );
    return mapSession(result.rows[0]!);
  }

  async findByTokenHash(tokenHash: string): Promise<ConsoleSessionRecord | null> {
    const result = await this.db.query<ConsoleSessionRow>(
      `SELECT * FROM ${this.t("console_sessions")} WHERE token_hash = $1`,
      [tokenHash]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async rotateCsrf(sessionId: string, csrfHash: string): Promise<void> {
    await this.db.query(
      `UPDATE ${this.t("console_sessions")} SET csrf_hash = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, csrfHash]
    );
  }

  async revoke(sessionId: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE ${this.t("console_sessions")} SET revoked_at = $2
        WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, now.toISOString()]
    );
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.db.query(
      `DELETE FROM ${this.t("console_sessions")}
        WHERE expires_at <= $1 OR revoked_at IS NOT NULL`,
      [now.toISOString()]
    );
  }
}
