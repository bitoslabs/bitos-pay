import type {
  AttemptStatus,
  IntentStatus,
  InvoiceStatus,
  MerchantStatus,
  PayTransaction,
  PaymentAttempt,
  PaymentIntent,
  Invoice,
  Refund,
  RefundStatus,
  TransactionStatus
} from "../../domain/types.ts";

export type Row = Record<string, unknown>;

export interface MerchantRow {
  id: string;
  organization_id: string;
  name: string;
  status: MerchantStatus;
  default_currency: string;
  support_email: string | null;
  website: string | null;
  fee_bps: number;
  max_payment_msat: string | number | bigint;
  daily_volume_msat: string | number | bigint;
  max_payments_per_minute: number;
}

export interface IntentRow extends Row {
  id: string;
  organization_id: string;
  merchant_id: string;
  provider_connection_id: string;
  external_reference: string | null;
  location_id: string | null;
  amount_msat: string | number | bigint;
  currency: string;
  scale: number;
  status: IntentStatus;
  retry_of_intent_id: string | null;
  livemode: boolean;
  expires_at: Date | string;
  metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AttemptRow extends Row {
  id: string;
  payment_intent_id: string;
  provider_connection_id: string;
  provider_reference: string | null;
  status: AttemptStatus;
  failure_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface InvoiceRow extends Row {
  id: string;
  payment_attempt_id: string;
  payment_hash: string;
  bolt11: string;
  amount_msat: string | number | bigint;
  status: InvoiceStatus;
  expires_at: Date | string;
  created_at: Date | string;
  settled_at: Date | string | null;
}

export interface TransactionRow extends Row {
  id: string;
  organization_id: string;
  merchant_id: string;
  payment_attempt_id: string;
  provider_connection_id: string;
  provider_reference: string;
  payment_hash: string;
  amount_msat: string | number | bigint;
  fee_msat: string | number | bigint;
  net_msat: string | number | bigint;
  currency: string;
  scale: number;
  status: TransactionStatus;
  settled_at: Date | string | null;
  created_at: Date | string;
}

export interface RefundRow extends Row {
  id: string;
  organization_id: string;
  merchant_id: string;
  transaction_id: string;
  payment_intent_id: string;
  amount_msat: string | number | bigint;
  fee_msat: string | number | bigint;
  net_msat: string | number | bigint;
  currency: string;
  scale: number;
  reason: string | null;
  status: RefundStatus;
  livemode: boolean;
  created_at: Date | string;
  settled_at: Date | string | null;
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toIsoOrNull(value: Date | string | null): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

export function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export function toJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function toJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  }
  return [];
}

export function mapIntent(row: IntentRow): PaymentIntent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    merchantId: row.merchant_id,
    providerConnectionId: row.provider_connection_id,
    externalReference: row.external_reference,
    locationId: row.location_id,
    amountMsat: toBigInt(row.amount_msat),
    currency: row.currency,
    scale: Number(row.scale),
    status: row.status,
    retryOfIntentId: row.retry_of_intent_id,
    livemode: row.livemode,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    metadata: toJsonObject(row.metadata)
  };
}

export function mapAttempt(row: AttemptRow): PaymentAttempt {
  return {
    id: row.id,
    paymentIntentId: row.payment_intent_id,
    providerConnectionId: row.provider_connection_id,
    providerReference: row.provider_reference,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export function mapInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    paymentAttemptId: row.payment_attempt_id,
    paymentHash: row.payment_hash,
    bolt11: row.bolt11,
    amountMsat: toBigInt(row.amount_msat),
    status: row.status,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    settledAt: toIsoOrNull(row.settled_at)
  };
}

export function mapRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    organizationId: row.organization_id,
    merchantId: row.merchant_id,
    transactionId: row.transaction_id,
    paymentIntentId: row.payment_intent_id,
    amountMsat: toBigInt(row.amount_msat),
    feeMsat: toBigInt(row.fee_msat),
    netMsat: toBigInt(row.net_msat),
    currency: row.currency,
    scale: Number(row.scale),
    reason: row.reason,
    status: row.status,
    livemode: row.livemode,
    createdAt: toIso(row.created_at),
    settledAt: toIsoOrNull(row.settled_at)
  };
}

export function mapTransaction(row: TransactionRow): PayTransaction {
  return {
    id: row.id,
    organizationId: row.organization_id,
    merchantId: row.merchant_id,
    paymentAttemptId: row.payment_attempt_id,
    providerConnectionId: row.provider_connection_id,
    providerReference: row.provider_reference,
    paymentHash: row.payment_hash,
    amountMsat: toBigInt(row.amount_msat),
    feeMsat: toBigInt(row.fee_msat),
    netMsat: toBigInt(row.net_msat),
    currency: row.currency,
    scale: Number(row.scale),
    status: row.status,
    settledAt: toIsoOrNull(row.settled_at),
    createdAt: toIso(row.created_at)
  };
}
