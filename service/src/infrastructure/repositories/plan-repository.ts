import type { DbClient } from "../db/database.ts";
import { BaseRepository } from "./base-repository.ts";
import { toBigInt, toIso, toIsoOrNull, toJsonArray, toJsonObject } from "./rows.ts";

export type SubscriptionStatus =
  | "PENDING_PAYMENT"
  | "ACTIVE"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDED";
export type EntitlementStatus = "ACTIVE" | "GRACE" | "EXPIRED" | "REVOKED";

export interface Plan {
  code: string;
  name: string;
  version: number;
  features: string[];
  limits: Record<string, unknown>;
  priceMsat: bigint;
  currency: string;
  status: "ACTIVE" | "RETIRED";
}

export interface Subscription {
  id: string;
  organizationId: string;
  merchantId: string;
  planCode: string;
  status: SubscriptionStatus;
  providerReference: string | null;
  paymentHash: string | null;
  bolt11: string | null;
  amountMsat: bigint;
  currency: string;
  expiresAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entitlement {
  id: string;
  organizationId: string;
  subscriptionId: string | null;
  planCode: string;
  features: string[];
  limits: Record<string, unknown>;
  status: EntitlementStatus;
  validFrom: string;
  validUntil: string | null;
  revision: number;
  updatedAt: string;
}

interface PlanRow {
  code: string;
  name: string;
  version: number;
  features: unknown;
  limits: unknown;
  price_msat: string | number | bigint;
  currency: string;
  status: "ACTIVE" | "RETIRED";
}

interface SubscriptionRow {
  id: string;
  organization_id: string;
  merchant_id: string;
  plan_code: string;
  status: SubscriptionStatus;
  provider_reference: string | null;
  payment_hash: string | null;
  bolt11: string | null;
  amount_msat: string | number | bigint;
  currency: string;
  expires_at: Date | string;
  period_start: Date | string | null;
  period_end: Date | string | null;
  paid_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EntitlementRow {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  plan_code: string;
  features: unknown;
  limits: unknown;
  status: EntitlementStatus;
  valid_from: Date | string;
  valid_until: Date | string | null;
  revision: number;
  updated_at: Date | string;
}

function mapPlan(row: PlanRow): Plan {
  return {
    code: row.code,
    name: row.name,
    version: row.version,
    features: toJsonArray(row.features),
    limits: toJsonObject(row.limits),
    priceMsat: toBigInt(row.price_msat),
    currency: row.currency,
    status: row.status
  };
}

function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    organizationId: row.organization_id,
    merchantId: row.merchant_id,
    planCode: row.plan_code,
    status: row.status,
    providerReference: row.provider_reference,
    paymentHash: row.payment_hash,
    bolt11: row.bolt11,
    amountMsat: toBigInt(row.amount_msat),
    currency: row.currency,
    expiresAt: toIso(row.expires_at),
    periodStart: toIsoOrNull(row.period_start),
    periodEnd: toIsoOrNull(row.period_end),
    paidAt: toIsoOrNull(row.paid_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapEntitlement(row: EntitlementRow): Entitlement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    subscriptionId: row.subscription_id,
    planCode: row.plan_code,
    features: toJsonArray(row.features),
    limits: toJsonObject(row.limits),
    status: row.status,
    validFrom: toIso(row.valid_from),
    validUntil: toIsoOrNull(row.valid_until),
    revision: row.revision,
    updatedAt: toIso(row.updated_at)
  };
}

export class PlanRepository extends BaseRepository {
  async listPlans(): Promise<Plan[]> {
    const result = await this.db.query<PlanRow>(
      `SELECT code, name, version, features, limits, price_msat, currency, status
       FROM ${this.t("plans")}
       WHERE status = 'ACTIVE'
       ORDER BY price_msat ASC, code ASC`
    );
    return result.rows.map(mapPlan);
  }

  async getPlan(code: string): Promise<Plan | null> {
    const result = await this.db.query<PlanRow>(
      `SELECT code, name, version, features, limits, price_msat, currency, status
       FROM ${this.t("plans")}
       WHERE code = $1`,
      [code]
    );
    const row = result.rows[0];
    return row ? mapPlan(row) : null;
  }

  async createSubscription(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      planCode: string;
      providerReference: string;
      paymentHash: string;
      bolt11: string;
      amountMsat: bigint;
      currency: string;
      expiresAt: Date;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<Subscription> {
    const result = await client.query<SubscriptionRow>(
      `INSERT INTO ${this.t("subscriptions")}
        (id, organization_id, merchant_id, plan_code, status, provider_reference,
         payment_hash, bolt11, amount_msat, currency, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'PENDING_PAYMENT',$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.planCode,
        input.providerReference,
        input.paymentHash,
        input.bolt11,
        input.amountMsat.toString(),
        input.currency,
        input.expiresAt.toISOString(),
        input.now.toISOString()
      ]
    );
    return mapSubscription(result.rows[0]!);
  }

  async getSubscription(merchantId: string, id: string): Promise<Subscription | null> {
    const result = await this.db.query<SubscriptionRow>(
      `SELECT * FROM ${this.t("subscriptions")} WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId]
    );
    const row = result.rows[0];
    return row ? mapSubscription(row) : null;
  }

  async activateSubscription(
    input: {
      id: string;
      merchantId: string;
      periodStart: Date;
      periodEnd: Date;
      paidAt: Date;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<Subscription | null> {
    const result = await client.query<SubscriptionRow>(
      `UPDATE ${this.t("subscriptions")}
       SET status = 'ACTIVE', period_start = $3, period_end = $4, paid_at = $5, updated_at = $6
       WHERE id = $1 AND merchant_id = $2 AND status = 'PENDING_PAYMENT'
       RETURNING *`,
      [
        input.id,
        input.merchantId,
        input.periodStart.toISOString(),
        input.periodEnd.toISOString(),
        input.paidAt.toISOString(),
        input.now.toISOString()
      ]
    );
    const row = result.rows[0];
    return row ? mapSubscription(row) : null;
  }

  async getEntitlement(organizationId: string): Promise<Entitlement | null> {
    const result = await this.db.query<EntitlementRow>(
      `SELECT * FROM ${this.t("entitlements")} WHERE organization_id = $1`,
      [organizationId]
    );
    const row = result.rows[0];
    return row ? mapEntitlement(row) : null;
  }

  async upsertEntitlement(
    input: {
      id: string;
      organizationId: string;
      subscriptionId: string;
      planCode: string;
      features: string[];
      limits: Record<string, unknown>;
      validFrom: Date;
      validUntil: Date;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<Entitlement> {
    const result = await client.query<EntitlementRow>(
      `INSERT INTO ${this.t("entitlements")}
        (id, organization_id, subscription_id, plan_code, features, limits, status,
         valid_from, valid_until, revision, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'ACTIVE',$7,$8,1,$9)
       ON CONFLICT (organization_id) DO UPDATE SET
         subscription_id = EXCLUDED.subscription_id,
         plan_code = EXCLUDED.plan_code,
         features = EXCLUDED.features,
         limits = EXCLUDED.limits,
         status = 'ACTIVE',
         valid_from = EXCLUDED.valid_from,
         valid_until = EXCLUDED.valid_until,
         revision = entitlements.revision + 1,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [
        input.id,
        input.organizationId,
        input.subscriptionId,
        input.planCode,
        JSON.stringify(input.features),
        JSON.stringify(input.limits),
        input.validFrom.toISOString(),
        input.validUntil.toISOString(),
        input.now.toISOString()
      ]
    );
    return mapEntitlement(result.rows[0]!);
  }
}
