export type IntentStatus =
  | "CREATED"
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

export type AttemptStatus =
  | "CREATED"
  | "INVOICE_ISSUED"
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "QUARANTINED";

export type InvoiceStatus =
  | "ISSUED"
  | "SETTLED"
  | "EXPIRED"
  | "CANCELLED"
  | "QUARANTINED";

export type TransactionStatus = "DETECTED" | "CONFIRMED" | "SETTLED" | "REVERSED";
export type RefundStatus = "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type MerchantStatus =
  | "PENDING_VERIFICATION"
  | "ACTIVE"
  | "RESTRICTED"
  | "SUSPENDED"
  | "CLOSED";
export type ProviderConnectionStatus = "UNVERIFIED" | "ACTIVE" | "DEGRADED" | "DISABLED";
export type ApiKeyStatus = "ACTIVE" | "REVOKED";
export type WebhookDeliveryStatus = "PENDING" | "DELIVERED" | "FAILED" | "DEAD";
export type LedgerDirection = "debit" | "credit";
export type LedgerAccountType = "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE" | "EQUITY";

export interface AuthContext {
  apiKeyId: string;
  organizationId: string;
  merchantId: string;
  merchantStatus: MerchantStatus;
  scopes: string[];
  livemode: boolean;
}

export interface PaymentIntent {
  id: string;
  organizationId: string;
  merchantId: string;
  providerConnectionId: string;
  externalReference: string | null;
  locationId: string | null;
  amountMsat: bigint;
  currency: string;
  scale: number;
  status: IntentStatus;
  retryOfIntentId: string | null;
  livemode: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface MerchantLocation {
  id: string;
  organizationId: string;
  merchantId: string;
  name: string;
  code: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAttempt {
  id: string;
  paymentIntentId: string;
  providerConnectionId: string;
  providerReference: string | null;
  status: AttemptStatus;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  paymentAttemptId: string;
  paymentHash: string;
  bolt11: string;
  amountMsat: bigint;
  status: InvoiceStatus;
  expiresAt: string;
  createdAt: string;
  settledAt: string | null;
}

export interface PayTransaction {
  id: string;
  organizationId: string;
  merchantId: string;
  paymentAttemptId: string;
  providerConnectionId: string;
  providerReference: string;
  paymentHash: string;
  amountMsat: bigint;
  feeMsat: bigint;
  netMsat: bigint;
  currency: string;
  scale: number;
  status: TransactionStatus;
  settledAt: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  hasMore: boolean;
}

export interface Refund {
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
  createdAt: string;
  settledAt: string | null;
}

export interface PaymentListOptions {
  limit: number;
  startingAfter?: string;
  status?: IntentStatus;
}

export interface TransactionListOptions {
  limit: number;
  startingAfter?: string;
  status?: TransactionStatus;
}

export interface RefundListOptions {
  limit: number;
  startingAfter?: string;
}

export interface PaymentIntentView {
  intent: PaymentIntent;
  attempt: PaymentAttempt | null;
  invoice: Invoice | null;
  transaction: PayTransaction | null;
}

export interface CreatedPaymentIntent {
  id: string;
  status: IntentStatus;
  amount: number;
  currency: string;
  scale: number;
  external_reference: string | null;
  attempt_id: string;
  payment: {
    method: "lightning";
    invoice: string;
    payment_hash: string;
    expires_at: string;
  };
  expires_at: string;
  checkout_url: string;
  livemode: boolean;
  request_id: string;
}

export interface ProviderEventInput {
  mode?: "sandbox" | "live";
  providerConnectionId: string;
  providerEventId: string;
  providerReference: string;
  paymentHash: string;
  amountMsat: bigint;
  occurredAt: Date;
}

export interface SettlementResult {
  status: "SETTLED" | "QUARANTINED" | "DUPLICATE";
  intentId: string;
  transactionId: string | null;
  invoiceStatus: InvoiceStatus;
  intentStatus: IntentStatus;
}

export interface SettlementSummary {
  id: string | null;
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  grossMsat: bigint;
  feesMsat: bigint;
  netMsat: bigint;
  ledgerBalanced: boolean;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
}

export interface SettlementRecord extends SettlementSummary {
  createdAt: string;
}

export type MerchantMemberRole = "OWNER" | "ADMIN" | "MANAGER" | "CASHIER" | "VIEWER";

export interface MerchantMember {
  id: string;
  pubkey: string;
  role: MerchantMemberRole;
  label: string | null;
  status: "ACTIVE" | "REVOKED";
  lastSeenAt: string;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  keyPrefix: string;
  label: string | null;
  scopes: string[];
  livemode: boolean;
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface ApiKeyUsageBucket {
  bucketStart: string;
  totalCount: number;
  successCount: number;
  authErrorCount: number;
  rateLimitCount: number;
  serverErrorCount: number;
  lastEndpoint: string | null;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string;
  actorRef: string;
  action: string;
  targetRef: string;
  result: string;
  occurredAt: string;
}

export interface ApiKeyTelemetry {
  key: ApiKeySummary;
  windowHours: number;
  totals: {
    totalCount: number;
    successCount: number;
    authErrorCount: number;
    rateLimitCount: number;
    serverErrorCount: number;
    lastEndpoint: string | null;
  };
  buckets: ApiKeyUsageBucket[];
  recentAudit: AuditLogEntry[];
}

export interface MerchantHealthSummary {
  merchantId: string;
  merchantStatus: MerchantStatus;
  risk: {
    dayVolumeMsat: bigint;
    dailyVolumeLimitMsat: bigint;
    minuteCount: number;
    maxPaymentsPerMinute: number;
    maxPaymentMsat: bigint;
    feeBps: number;
  };
  alerts: {
    quarantinedPayments: number;
    deadWebhooks: number;
    degradedConnections: number;
    expiringKeys: number;
    staleKeys: number;
  };
  observedAt: string;
}

export interface ProviderConnectionSummary {
  id: string;
  provider: string;
  mode: "sandbox" | "live";
  status: ProviderConnectionStatus;
  createdAt: string;
}

export interface ExchangeQuote {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseAmount: number;
  quoteAmount: number;
  rate: string;
  source: string;
  quotedAt: string;
  expiresAt: string;
}

export interface BalanceLine {
  account_code: string;
  account_type: LedgerAccountType;
  currency: string;
  scale: number;
  debit_msat: string;
  credit_msat: string;
  balance_msat: string;
}

export type PaymentLinkStatus = "ACTIVE" | "DISABLED";

export interface PaymentLink {
  id: string;
  organizationId: string;
  merchantId: string;
  amountMsat: bigint;
  currency: string;
  scale: number;
  reference: string | null;
  label: string | null;
  status: PaymentLinkStatus;
  createdAt: string;
  disabledAt: string | null;
}

export interface WebhookEndpointInput {
  url: string;
  events: string[];
}

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  merchantId: string;
  url: string;
  events: string[];
  status: "ACTIVE" | "DISABLED";
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  api_version: string;
  created_at: string;
  livemode: boolean;
  merchant_id: string;
  data: Record<string, unknown>;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  responseCode: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredWebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: WebhookEvent;
  url: string;
  secret: string;
  previousSecret: string | null;
  previousSecretExpiresAt: string | null;
  status: WebhookDeliveryStatus;
  attempt: number;
  nextAttemptAt: string;
}
