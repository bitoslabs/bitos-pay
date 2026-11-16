import type { DbClient } from "../db/database.ts";
import type {
  ApiKeyStatus,
  ApiKeySummary,
  AuthContext,
  MerchantStatus,
  ProviderConnectionStatus
} from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import { toIso, toIsoOrNull, toJsonArray, type MerchantRow, type Row } from "./rows.ts";

export interface SubjectOrganization {
  organizationId: string;
  organizationName: string;
  ownerPubkey: string | null;
  createdVia: string;
  merchantId: string;
  merchantName: string;
  merchantStatus: MerchantStatus;
}

export interface OwnerOrganization {
  organizationId: string;
  merchantId: string;
  apiKeyId: string;
  ownerPubkey: string;
}

export interface ApiKeyRow {
  api_key_id: string;
  organization_id: string;
  merchant_id: string;
  merchant_status: MerchantStatus;
  scopes: unknown;
  livemode: boolean;
  key_status: string;
  expires_at: Date | string | null;
}

export class MerchantRepository extends BaseRepository {
  async findApiKeyByHash(hash: string): Promise<ApiKeyRow | null> {
    const result = await this.db.query<ApiKeyRow & Row>(
      `SELECT k.id AS api_key_id, m.organization_id, m.id AS merchant_id, m.status AS merchant_status,
              k.scopes, k.livemode, k.status AS key_status, k.expires_at
         FROM ${this.t("api_keys")} k
         JOIN ${this.t("merchants")} m ON m.id = k.merchant_id
        WHERE k.key_hash = $1`,
      [hash]
    );
    return result.rows[0] ?? null;
  }

  async findApiKeyById(apiKeyId: string): Promise<ApiKeyRow | null> {
    const result = await this.db.query<ApiKeyRow & Row>(
      `SELECT k.id AS api_key_id, m.organization_id, m.id AS merchant_id, m.status AS merchant_status,
              k.scopes, k.livemode, k.status AS key_status, k.expires_at
         FROM ${this.t("api_keys")} k
         JOIN ${this.t("merchants")} m ON m.id = k.merchant_id
        WHERE k.id = $1`,
      [apiKeyId]
    );
    return result.rows[0] ?? null;
  }

  async touchApiKey(apiKeyId: string, now: Date): Promise<void> {
    await this.db.query(`UPDATE ${this.t("api_keys")} SET last_used_at = $2 WHERE id = $1`, [
      apiKeyId,
      now.toISOString()
    ]);
  }

  toAuthContext(row: ApiKeyRow): AuthContext {
    return {
      apiKeyId: row.api_key_id,
      organizationId: row.organization_id,
      merchantId: row.merchant_id,
      merchantStatus: row.merchant_status,
      scopes: toJsonArray(row.scopes),
      livemode: row.livemode
    };
  }

  async getMerchant(merchantId: string, client: DbClient = this.db): Promise<MerchantRow | null> {
    const result = await client.query<MerchantRow>(
      `SELECT id, organization_id, name, status, default_currency, fee_bps,
              support_email, website,
              max_payment_msat, daily_volume_msat, max_payments_per_minute
         FROM ${this.t("merchants")} WHERE id = $1`,
      [merchantId]
    );
    return result.rows[0] ?? null;
  }

  async getMerchantForUpdate(
    merchantId: string,
    client: DbClient
  ): Promise<MerchantRow | null> {
    const result = await client.query<MerchantRow>(
      `SELECT id, organization_id, name, status, default_currency, fee_bps,
              support_email, website,
              max_payment_msat, daily_volume_msat, max_payments_per_minute
         FROM ${this.t("merchants")} WHERE id = $1 FOR UPDATE`,
      [merchantId]
    );
    return result.rows[0] ?? null;
  }

  async updateProfile(
    merchantId: string,
    input: { name: string; supportEmail: string | null; website: string | null },
    now: Date,
    client: DbClient = this.db
  ): Promise<MerchantRow | null> {
    const result = await client.query<MerchantRow>(
      `UPDATE ${this.t("merchants")}
          SET name = $2, support_email = $3, website = $4, updated_at = $5
        WHERE id = $1
        RETURNING id, organization_id, name, status, default_currency, fee_bps,
                  support_email, website, max_payment_msat, daily_volume_msat,
                  max_payments_per_minute`,
      [merchantId, input.name, input.supportEmail, input.website, now.toISOString()]
    );
    return result.rows[0] ?? null;
  }

  async updateRiskLimits(
    merchantId: string,
    input: {
      maxPaymentMsat: bigint;
      dailyVolumeMsat: bigint;
      maxPaymentsPerMinute: number;
    }
  ): Promise<void> {
    await this.db.query(
      `UPDATE ${this.t("merchants")}
          SET max_payment_msat = $2,
              daily_volume_msat = $3,
              max_payments_per_minute = $4,
              updated_at = $5
        WHERE id = $1`,
      [
        merchantId,
        input.maxPaymentMsat.toString(),
        input.dailyVolumeMsat.toString(),
        input.maxPaymentsPerMinute,
        new Date().toISOString()
      ]
    );
  }

  async getProviderConnection(
    connectionId: string,
    organizationId: string
  ): Promise<{ id: string; provider: string; mode: "sandbox" | "live"; status: ProviderConnectionStatus } | null> {
    const result = await this.db.query<{
      id: string;
      provider: string;
      mode: "sandbox" | "live";
      status: ProviderConnectionStatus;
    }>(
      `SELECT id, provider, mode, status FROM ${this.t("provider_connections")}
        WHERE id = $1 AND organization_id = $2`,
      [connectionId, organizationId]
    );
    return result.rows[0] ?? null;
  }

  async listProviderConnections(
    organizationId: string
  ): Promise<Array<{ id: string; provider: string; mode: "sandbox" | "live"; status: ProviderConnectionStatus; createdAt: string }>> {
    const result = await this.db.query<{
      id: string;
      provider: string;
      mode: "sandbox" | "live";
      status: ProviderConnectionStatus;
      created_at: Date | string;
    }>(
      `SELECT id, provider, mode, status, created_at FROM ${this.t("provider_connections")}
        WHERE organization_id = $1
        ORDER BY created_at ASC`,
      [organizationId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      mode: row.mode,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString()
    }));
  }

  async listActiveProviderConnections(
    organizationId: string,
    mode: "sandbox" | "live"
  ): Promise<Array<{ id: string; provider: string; mode: "sandbox" | "live" }>> {
    const result = await this.db.query<{ id: string; provider: string; mode: "sandbox" | "live" }>(
      `SELECT id, provider, mode FROM ${this.t("provider_connections")}
        WHERE organization_id = $1 AND mode = $2 AND status = 'ACTIVE'
        ORDER BY created_at ASC LIMIT 1`,
      [organizationId, mode]
    );
    return result.rows;
  }

  async listApiKeys(merchantId: string): Promise<ApiKeySummary[]> {
    const result = await this.db.query<{
      id: string;
      key_prefix: string;
      scopes: unknown;
      livemode: boolean;
      status: ApiKeyStatus;
      last_used_at: Date | string | null;
      created_at: Date | string;
      expires_at: Date | string | null;
    }>(
      `SELECT id, key_prefix, scopes, livemode, status, last_used_at, created_at, expires_at
         FROM ${this.t("api_keys")}
        WHERE merchant_id = $1 AND kind = 'api'
        ORDER BY created_at DESC`,
      [merchantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      keyPrefix: row.key_prefix,
      scopes: toJsonArray(row.scopes),
      livemode: row.livemode,
      status: row.status,
      lastUsedAt: toIsoOrNull(row.last_used_at),
      createdAt: toIso(row.created_at),
      expiresAt: toIsoOrNull(row.expires_at)
    }));
  }

  async revokeApiKey(
    merchantId: string,
    keyId: string,
    client: DbClient = this.db
  ): Promise<ApiKeySummary | null> {
    const result = await client.query<{
      id: string;
      key_prefix: string;
      scopes: unknown;
      livemode: boolean;
      status: ApiKeyStatus;
      last_used_at: Date | string | null;
      created_at: Date | string;
      expires_at: Date | string | null;
    }>(
      `UPDATE ${this.t("api_keys")}
          SET status = 'REVOKED'
        WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'
        RETURNING id, key_prefix, scopes, livemode, status, last_used_at, created_at, expires_at`,
      [keyId, merchantId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      keyPrefix: row.key_prefix,
      scopes: toJsonArray(row.scopes),
      livemode: row.livemode,
      status: row.status,
      lastUsedAt: toIsoOrNull(row.last_used_at),
      createdAt: toIso(row.created_at),
      expiresAt: toIsoOrNull(row.expires_at)
    };
  }

  async createOrganization(
    input: {
      id: string;
      name: string;
      country: string;
      subjectRef?: string | null;
      ownerPubkey?: string | null;
      createdVia?: string;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("organizations")}
        (id, name, country, status, subject_ref, owner_pubkey, created_via, created_at, updated_at)
       VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6,$7,$7)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.name,
        input.country,
        input.subjectRef ?? null,
        input.ownerPubkey ?? null,
        input.createdVia ?? "seed",
        input.now.toISOString()
      ]
    );
  }

  async findBySubjectRef(subjectRef: string): Promise<SubjectOrganization | null> {
    const result = await this.db.query<{
      organization_id: string;
      organization_name: string;
      owner_pubkey: string | null;
      created_via: string;
      merchant_id: string;
      merchant_name: string;
      merchant_status: MerchantStatus;
    }>(
      `SELECT o.id AS organization_id, o.name AS organization_name, o.owner_pubkey,
              o.created_via, m.id AS merchant_id, m.name AS merchant_name,
              m.status AS merchant_status
         FROM ${this.t("organizations")} o
         JOIN ${this.t("merchants")} m ON m.organization_id = o.id
        WHERE o.subject_ref = $1
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT 1`,
      [subjectRef]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      ownerPubkey: row.owner_pubkey,
      createdVia: row.created_via,
      merchantId: row.merchant_id,
      merchantName: row.merchant_name,
      merchantStatus: row.merchant_status
    };
  }

  async findByOwnerPubkey(pubkey: string): Promise<OwnerOrganization | null> {
    const result = await this.db.query<{
      organization_id: string;
      merchant_id: string;
      api_key_id: string;
      owner_pubkey: string;
    }>(
      `SELECT o.id AS organization_id, m.id AS merchant_id, k.id AS api_key_id,
              o.owner_pubkey
         FROM ${this.t("organizations")} o
         JOIN ${this.t("merchants")} m ON m.organization_id = o.id
         JOIN LATERAL (
           SELECT id FROM ${this.t("api_keys")}
            WHERE merchant_id = m.id AND status = 'ACTIVE' AND livemode = false
              AND kind = 'api' AND (expires_at IS NULL OR expires_at > now())
            ORDER BY created_at ASC, id ASC
            LIMIT 1
         ) k ON true
        WHERE o.owner_pubkey = $1
        ORDER BY o.created_at ASC, o.id ASC
        LIMIT 1`,
      [pubkey]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      organizationId: row.organization_id,
      merchantId: row.merchant_id,
      apiKeyId: row.api_key_id,
      ownerPubkey: row.owner_pubkey
    };
  }

  async renameWorkspace(
    organizationId: string,
    merchantId: string,
    organizationName: string,
    merchantName: string,
    now: Date
  ): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE ${this.t("organizations")}
            SET name = $2, updated_at = $3
          WHERE id = $1`,
        [organizationId, organizationName, now.toISOString()]
      );
      await client.query(
        `UPDATE ${this.t("merchants")}
            SET name = $2, updated_at = $3
          WHERE id = $1 AND organization_id = $4`,
        [merchantId, merchantName, now.toISOString(), organizationId]
      );
    });
  }

  async createMerchant(
    input: {
      id: string;
      organizationId: string;
      name: string;
      status: MerchantStatus;
      defaultCurrency: string;
      feeBps: number;
      maxPaymentMsat: bigint;
      dailyVolumeMsat: bigint;
      maxPaymentsPerMinute: number;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("merchants")}
        (id, organization_id, name, status, default_currency, fee_bps,
         max_payment_msat, daily_volume_msat, max_payments_per_minute, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.organizationId,
        input.name,
        input.status,
        input.defaultCurrency,
        input.feeBps,
        input.maxPaymentMsat.toString(),
        input.dailyVolumeMsat.toString(),
        input.maxPaymentsPerMinute,
        input.now.toISOString()
      ]
    );
  }

  async createProviderConnection(
    input: {
      id: string;
      organizationId: string;
      provider: string;
      mode: "sandbox" | "live";
      status: ProviderConnectionStatus;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("provider_connections")}
        (id, organization_id, provider, mode, status, credential_ref, created_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6)
       ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.organizationId,
        input.provider,
        input.mode,
        input.status,
        input.now.toISOString()
      ]
    );
  }

  async createApiKey(
    input: {
      id: string;
      merchantId: string;
      keyPrefix: string;
      keyHash: string;
      scopes: string[];
      livemode: boolean;
      now: Date;
      expiresAt?: Date | null;
      kind?: "api" | "member";
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("api_keys")}
        (id, merchant_id, key_prefix, key_hash, scopes, livemode, status, created_at, expires_at, kind)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,'ACTIVE',$7,$8,$9)
       ON CONFLICT (key_hash) DO NOTHING`,
      [
        input.id,
        input.merchantId,
        input.keyPrefix,
        input.keyHash,
        JSON.stringify(input.scopes),
        input.livemode,
        input.now.toISOString(),
        input.expiresAt?.toISOString() ?? null,
        input.kind ?? "api"
      ]
    );
  }
}
