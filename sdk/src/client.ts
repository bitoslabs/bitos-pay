import { randomUUID } from "node:crypto";
import { BitOSPayError } from "./errors.ts";
import type {
  ApiKeySummary,
  BalanceList,
  CreateIntentInput,
  CreateLocationInput,
  CreatePaymentLinkInput,
  CreateQuoteInput,
  CreateRefundInput,
  CreateWebhookEndpointInput,
  CreatedApiKey,
  CreatedInvoice,
  CreatedPaymentIntent,
  CreatedPaymentLink,
  ExchangeQuote,
  Invoice,
  ListResponse,
  Merchant,
  MerchantLocation,
  PageParams,
  PaymentIntent,
  PaymentIntentView,
  PaymentLink,
  PaymentListParams,
  ReconcileInput,
  Refund,
  SettlementListParams,
  SettlementPeriodParams,
  SettlementSummary,
  Transaction,
  TransactionListParams,
  UpdateLocationInput,
  UpdateMerchantProfileInput,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointRegistration,
  WebhookEndpointRotation
} from "./types.ts";

export interface BitOSPayOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface WriteOptions extends RequestOptions {
  idempotencyKey?: string;
}

export interface CreateApiKeyOptions extends RequestOptions {
  expiresInDays?: number;
}

export interface RawRequestOptions extends WriteOptions {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, QueryValue>;
  body?: unknown;
}

const DEFAULT_BASE_URL = "https://api.pay.bitos.space";
const DEFAULT_TIMEOUT_MS = 30_000;

function newIdempotencyKey(): string {
  return `sdk_${randomUUID().replaceAll("-", "")}`;
}

class Http {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BitOSPayOptions) {
    if (!options.apiKey) throw new Error("apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("timeoutMs must be a positive integer");
    }
  }

  async request<T>(path: string, options: RawRequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "bitos-pay-js/0.1.0",
      ...options.headers
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    headers.authorization = `Bearer ${this.apiKey}`;
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const error =
        data && typeof data === "object" && "error" in data
          ? (data as { error?: { code?: string; type?: string; message?: string; request_id?: string } })
              .error
          : undefined;
      throw new BitOSPayError(error?.message ?? `BitOS Pay request failed with ${response.status}`, {
        status: response.status,
        code: error?.code ?? `HTTP_${response.status}`,
        type: error?.type,
        requestId: error?.request_id ?? null
      });
    }
    return data as T;
  }
}

export class PaymentIntentsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  create(input: CreateIntentInput, options: WriteOptions = {}): Promise<CreatedPaymentIntent> {
    return this.http.request("/v1/payment-intents", {
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
      headers: options.headers
    });
  }

  retrieve(intentId: string, options: RequestOptions = {}): Promise<PaymentIntentView> {
    return this.http.request(`/v1/payment-intents/${encodeURIComponent(intentId)}`, options);
  }

  cancel(intentId: string, options: RequestOptions = {}): Promise<PaymentIntentView> {
    return this.http.request(`/v1/payment-intents/${encodeURIComponent(intentId)}/cancel`, {
      ...options,
      method: "POST"
    });
  }

  list(params: PaymentListParams = {}, options: RequestOptions = {}): Promise<ListResponse<PaymentIntent>> {
    return this.http.request("/v1/payments", {
      ...options,
      query: params as Record<string, QueryValue>
    });
  }
}

export class InvoicesResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  create(input: CreateIntentInput, options: WriteOptions = {}): Promise<CreatedInvoice> {
    return this.http.request("/v1/invoices", {
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
      headers: options.headers
    });
  }

  retrieve(invoiceId: string, options: RequestOptions = {}): Promise<Invoice> {
    return this.http.request(`/v1/invoices/${encodeURIComponent(invoiceId)}`, options);
  }
}

export class PaymentsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  list(params: PaymentListParams = {}, options: RequestOptions = {}): Promise<ListResponse<PaymentIntent>> {
    return new PaymentIntentsResource(this.http).list(params, options);
  }
}

export class TransactionsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  list(
    params: TransactionListParams = {},
    options: RequestOptions = {}
  ): Promise<ListResponse<Transaction>> {
    return this.http.request("/v1/transactions", {
      ...options,
      query: params as Record<string, QueryValue>
    });
  }
}

export class BalancesResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  retrieve(options: RequestOptions = {}): Promise<BalanceList> {
    return this.http.request("/v1/balances", options);
  }
}

export class LocationsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  list(options: RequestOptions = {}): Promise<{
    object: "list";
    data: MerchantLocation[];
    request_id: string;
  }> {
    return this.http.request("/v1/locations", options);
  }

  create(input: CreateLocationInput, options: RequestOptions = {}): Promise<MerchantLocation> {
    return this.http.request("/v1/locations", {
      ...options,
      method: "POST",
      body: input
    });
  }

  update(
    locationId: string,
    input: UpdateLocationInput,
    options: RequestOptions = {}
  ): Promise<MerchantLocation> {
    return this.http.request(`/v1/locations/${encodeURIComponent(locationId)}`, {
      ...options,
      method: "PATCH",
      body: input
    });
  }

  disable(locationId: string, options: RequestOptions = {}): Promise<MerchantLocation> {
    return this.http.request(`/v1/locations/${encodeURIComponent(locationId)}/disable`, {
      ...options,
      method: "POST"
    });
  }
}

export class MerchantsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  me(options: RequestOptions = {}): Promise<Merchant> {
    return this.http.request("/v1/merchants/me", options);
  }

  update(input: UpdateMerchantProfileInput, options: RequestOptions = {}): Promise<Merchant> {
    return this.http.request("/v1/merchants/me", {
      ...options,
      method: "PATCH",
      body: input
    });
  }
}

export class RefundsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  create(input: CreateRefundInput, options: WriteOptions = {}): Promise<Refund> {
    return this.http.request("/v1/refunds", {
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
      headers: options.headers
    });
  }

  retrieve(refundId: string, options: RequestOptions = {}): Promise<Refund> {
    return this.http.request(`/v1/refunds/${encodeURIComponent(refundId)}`, options);
  }

  list(params: PageParams = {}, options: RequestOptions = {}): Promise<ListResponse<Refund>> {
    return this.http.request("/v1/refunds", {
      ...options,
      query: params as Record<string, QueryValue>
    });
  }
}

export class SettlementsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  list(
    params: SettlementListParams = {},
    options: RequestOptions = {}
  ): Promise<{ object: "list"; data: SettlementSummary[]; request_id: string }> {
    return this.http.request("/v1/settlements", {
      ...options,
      query: params as Record<string, QueryValue>
    });
  }

  summary(params: SettlementPeriodParams = {}, options: RequestOptions = {}): Promise<SettlementSummary> {
    return this.http.request("/v1/settlements/summary", {
      ...options,
      query: params as Record<string, QueryValue>
    });
  }

  reconcile(input: ReconcileInput, options: RequestOptions = {}): Promise<SettlementSummary> {
    return this.http.request("/v1/settlements/reconcile", {
      ...options,
      method: "POST",
      body: input
    });
  }

  retrieve(settlementId: string, options: RequestOptions = {}): Promise<SettlementSummary> {
    return this.http.request(`/v1/settlements/${encodeURIComponent(settlementId)}`, options);
  }
}

export class PaymentLinksResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  create(input: CreatePaymentLinkInput, options: WriteOptions = {}): Promise<CreatedPaymentLink> {
    return this.http.request("/v1/payment-links", {
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
      headers: options.headers
    });
  }

  list(options: RequestOptions = {}): Promise<{
    object: "list";
    data: PaymentLink[];
    request_id: string;
  }> {
    return this.http.request("/v1/payment-links", options);
  }

  disable(linkId: string, options: RequestOptions = {}): Promise<PaymentLink> {
    return this.http.request(`/v1/payment-links/${encodeURIComponent(linkId)}/disable`, {
      ...options,
      method: "POST"
    });
  }
}

export class WebhookEndpointsResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  create(
    input: CreateWebhookEndpointInput,
    options: WriteOptions = {}
  ): Promise<WebhookEndpointRegistration> {
    return this.http.request("/v1/webhook-endpoints", {
      method: "POST",
      body: input,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
      headers: options.headers
    });
  }

  list(options: RequestOptions = {}): Promise<{ object: "list"; data: WebhookEndpoint[]; request_id: string }> {
    return this.http.request("/v1/webhook-endpoints", options);
  }

  update(
    endpointId: string,
    events: string[],
    options: RequestOptions = {}
  ): Promise<WebhookEndpoint> {
    return this.http.request(`/v1/webhook-endpoints/${encodeURIComponent(endpointId)}`, {
      ...options,
      method: "PATCH",
      body: { events }
    });
  }

  rotate(endpointId: string, options: RequestOptions = {}): Promise<WebhookEndpointRotation> {
    return this.http.request(
      `/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/rotate`,
      { ...options, method: "POST" }
    );
  }

  disable(endpointId: string, options: RequestOptions = {}): Promise<WebhookEndpoint> {
    return this.http.request(`/v1/webhook-endpoints/${encodeURIComponent(endpointId)}/disable`, {
      ...options,
      method: "POST"
    });
  }
}

export class WebhookDeliveriesResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  list(
    params: { limit?: number } = {},
    options: RequestOptions = {}
  ): Promise<{ object: "list"; data: WebhookDelivery[]; request_id: string }> {
    return this.http.request("/v1/webhook-deliveries", {
      ...options,
      query: params as Record<string, QueryValue>
    });
  }

  replay(deliveryId: string, options: RequestOptions = {}): Promise<WebhookDelivery> {
    return this.http.request(`/v1/webhook-deliveries/${encodeURIComponent(deliveryId)}/replay`, {
      ...options,
      method: "POST"
    });
  }
}

export class ApiKeysResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  list(options: RequestOptions = {}): Promise<{ object: "list"; data: ApiKeySummary[]; request_id: string }> {
    return this.http.request("/v1/api-keys", options);
  }

  create(scopes: string[], options: CreateApiKeyOptions = {}): Promise<CreatedApiKey> {
    const { expiresInDays, ...httpOptions } = options;
    return this.http.request("/v1/api-keys", {
      ...httpOptions,
      method: "POST",
      body: {
        scopes,
        ...(expiresInDays === undefined ? {} : { expires_in_days: expiresInDays })
      }
    });
  }

  rotate(keyId: string, options: RequestOptions = {}): Promise<CreatedApiKey> {
    return this.http.request(`/v1/api-keys/${encodeURIComponent(keyId)}/rotate`, {
      ...options,
      method: "POST"
    });
  }

  revoke(keyId: string, options: RequestOptions = {}): Promise<ApiKeySummary> {
    return this.http.request(`/v1/api-keys/${encodeURIComponent(keyId)}/revoke`, {
      ...options,
      method: "POST"
    });
  }
}

export class QuotesResource {
  private readonly http: Http;

  constructor(http: Http) {
    this.http = http;
  }

  create(input: CreateQuoteInput, options: RequestOptions = {}): Promise<ExchangeQuote> {
    return this.http.request("/v1/exchange/quotes", {
      ...options,
      method: "POST",
      body: input
    });
  }

  retrieve(quoteId: string, options: RequestOptions = {}): Promise<ExchangeQuote> {
    return this.http.request(`/v1/exchange/quotes/${encodeURIComponent(quoteId)}`, options);
  }
}

export class BitOSPay {
  readonly paymentIntents: PaymentIntentsResource;
  readonly invoices: InvoicesResource;
  readonly payments: PaymentsResource;
  readonly transactions: TransactionsResource;
  readonly balances: BalancesResource;
  readonly merchants: MerchantsResource;
  readonly locations: LocationsResource;
  readonly refunds: RefundsResource;
  readonly settlements: SettlementsResource;
  readonly paymentLinks: PaymentLinksResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  readonly webhookDeliveries: WebhookDeliveriesResource;
  readonly apiKeys: ApiKeysResource;
  readonly quotes: QuotesResource;
  private readonly http: Http;

  constructor(options: BitOSPayOptions) {
    this.http = new Http(options);
    this.paymentIntents = new PaymentIntentsResource(this.http);
    this.invoices = new InvoicesResource(this.http);
    this.payments = new PaymentsResource(this.http);
    this.transactions = new TransactionsResource(this.http);
    this.balances = new BalancesResource(this.http);
    this.merchants = new MerchantsResource(this.http);
    this.locations = new LocationsResource(this.http);
    this.refunds = new RefundsResource(this.http);
    this.settlements = new SettlementsResource(this.http);
    this.paymentLinks = new PaymentLinksResource(this.http);
    this.webhookEndpoints = new WebhookEndpointsResource(this.http);
    this.webhookDeliveries = new WebhookDeliveriesResource(this.http);
    this.apiKeys = new ApiKeysResource(this.http);
    this.quotes = new QuotesResource(this.http);
  }

  request<T>(path: string, options: RawRequestOptions = {}): Promise<T> {
    return this.http.request<T>(path, options);
  }
}
