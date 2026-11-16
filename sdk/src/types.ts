export type Currency = "SAT";
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
export type LedgerAccountType = "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE" | "EQUITY";

export interface CreateIntentInput {
  amount: number;
  currency: Currency;
  scale: 0;
  payment_method: "lightning";
  external_reference?: string | null;
  location_id?: string | null;
  metadata?: Record<string, unknown>;
}

export interface PaymentIntent {
  id: string;
  status: IntentStatus;
  amount: number;
  amount_msat: string;
  currency: string;
  scale: number;
  external_reference: string | null;
  location_id: string | null;
  livemode: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
  request_id?: string;
}

export interface CreatedPaymentIntent {
  id: string;
  status: IntentStatus;
  amount: number;
  currency: string;
  scale: number;
  external_reference: string | null;
  location_id: string | null;
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

export interface Invoice {
  id: string;
  payment_attempt_id: string;
  payment_hash: string;
  bolt11: string;
  amount_msat: string;
  amount: number;
  currency: string;
  scale: number;
  status: InvoiceStatus;
  expires_at: string;
  settled_at: string | null;
  request_id?: string;
}

export interface CreatedInvoice {
  id: string;
  payment_intent_id: string;
  payment_attempt_id: string;
  payment_hash: string;
  invoice: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  scale: number;
  expires_at: string;
  checkout_url: string;
  livemode: boolean;
  request_id: string;
}

export interface PaymentAttempt {
  id: string;
  status: AttemptStatus;
  provider_reference: string | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  payment_intent_attempt_id: string;
  provider_reference: string;
  payment_hash: string;
  amount_msat: string;
  amount: number;
  fee_msat: string;
  net_msat: string;
  currency: string;
  scale: number;
  status: TransactionStatus;
  settled_at: string | null;
  created_at: string;
  request_id?: string;
}

export interface PaymentIntentView extends PaymentIntent {
  checkout_url: string;
  attempt: PaymentAttempt | null;
  invoice: Omit<Invoice, "payment_attempt_id" | "currency" | "scale" | "created_at"> | null;
  transaction: {
    id: string;
    amount_msat: string;
    fee_msat: string;
    net_msat: string;
    status: TransactionStatus;
    settled_at: string | null;
  } | null;
}

export interface ListResponse<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
  request_id: string;
}

export interface PageParams {
  limit?: number;
  starting_after?: string;
}

export interface PaymentListParams extends PageParams {
  status?: IntentStatus;
}

export interface TransactionListParams extends PageParams {
  status?: TransactionStatus;
}

export interface CreateRefundInput {
  transaction_id: string;
  amount: number;
  reason?: string | null;
}

export interface Refund {
  id: string;
  object: "refund";
  transaction_id: string;
  payment_intent_id: string;
  amount: number;
  amount_msat: string;
  fee: number;
  fee_msat: string;
  net: number;
  net_msat: string;
  currency: string;
  scale: number;
  reason: string | null;
  status: RefundStatus;
  livemode: boolean;
  created_at: string;
  settled_at: string | null;
  request_id: string;
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

export interface BalanceList {
  object: "list";
  ledger_derived: true;
  wallet_balance: false;
  data: BalanceLine[];
  request_id: string;
}

export interface MerchantLocation {
  id: string;
  object: "merchant_location";
  name: string;
  code: string;
  status: "ACTIVE" | "DISABLED";
  created_at: string;
  updated_at: string;
  request_id: string;
}

export interface CreateLocationInput {
  name: string;
  code: string;
}

export interface UpdateLocationInput {
  name?: string;
  active?: boolean;
}

export interface Merchant {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  default_currency: string;
  support_email: string | null;
  website: string | null;
  request_id?: string;
}

export interface UpdateMerchantProfileInput {
  name: string;
  support_email?: string | null;
  website?: string | null;
}

export interface SettlementPeriodParams {
  from?: string;
  to?: string;
}

export interface ReconcileInput {
  period_start: string;
  period_end: string;
}

export interface SettlementListParams {
  limit?: number;
}

export interface SettlementSummary {
  id: string | null;
  object: "settlement_summary";
  ledger_derived: true;
  wallet_balance: false;
  period_start: string;
  period_end: string;
  transaction_count: number;
  gross_msat: string;
  gross: number;
  fees_msat: string;
  fees: number;
  net_msat: string;
  net: number;
  ledger_balanced: boolean;
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  request_id: string;
}

export interface CreateWebhookEndpointInput {
  url: string;
  events: string[];
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: "ACTIVE" | "DISABLED";
  created_at: string;
  request_id?: string;
}

export interface CreatePaymentLinkInput {
  amount: number;
  currency: "SAT";
  scale: 0;
  reference?: string | null;
  label?: string | null;
}

export interface PaymentLink {
  object: "payment_link";
  id: string;
  amount: number;
  amount_msat: string;
  currency: string;
  scale: number;
  reference: string | null;
  label: string | null;
  status: "ACTIVE" | "DISABLED";
  url: string;
  created_at: string;
  disabled_at: string | null;
}

export interface CreatedPaymentLink extends PaymentLink {
  request_id: string;
}

export interface WebhookEndpointRegistration {
  id: string;
  url: string;
  events: string[];
  status: "ACTIVE" | "DISABLED";
  secret: string;
  request_id: string;
}

export interface WebhookEndpointRotation extends WebhookEndpointRegistration {
  previous_secret_expires_at: string;
}

export interface WebhookDelivery {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  status: "PENDING" | "DELIVERED" | "FAILED" | "DEAD";
  attempt: number;
  response_code: number | null;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
  request_id?: string;
}

export interface ApiKeySummary {
  id: string;
  key_prefix: string;
  scopes: string[];
  livemode: boolean;
  status: "ACTIVE" | "REVOKED";
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
  request_id?: string;
}

export interface CreatedApiKey extends ApiKeySummary {
  key: string;
  request_id: string;
}


export interface CreateQuoteInput {
  base_currency: string;
  quote_currency: string;
  amount: number;
}

export interface ExchangeQuote {
  id: string;
  base_currency: string;
  quote_currency: string;
  base_amount: number;
  quote_amount: number;
  rate: string;
  source: string;
  quoted_at: string;
  expires_at: string;
  expired: boolean;
  request_id: string;
}

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  api_version: string;
  created_at: string;
  livemode: boolean;
  merchant_id: string;
  data: T;
}
