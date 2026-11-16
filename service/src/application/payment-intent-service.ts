import type { PayConfig } from "../config.ts";
import {
  API_VERSION,
  PayError,
  SAT_CURRENCY,
  SAT_SCALE,
  assertAmount,
  assertAttemptTransition,
  assertCurrency,
  assertIntentTransition,
  assertInvoiceTransition,
  newId,
  requestDigest,
  satToMsat
} from "../domain/index.ts";
import type {
  AuthContext,
  Invoice,
  Page,
  PaymentIntent,
  PaymentIntentView,
  PaymentListOptions
} from "../domain/types.ts";
import type {
  LocationRepository,
  MerchantRepository,
  PaymentRepository
} from "../infrastructure/repositories/index.ts";
import type { AuditRepository } from "../infrastructure/repositories/audit-repository.ts";
import type { LightningProviders } from "../infrastructure/providers/index.ts";
import type { AuthService } from "./auth-service.ts";
import type { CheckoutService } from "./checkout-service.ts";
import type { EventPublisher } from "./event-publisher.ts";
import type { RiskService } from "./risk-service.ts";
import {
  createdIntentResponse,
  createdInvoiceResponse,
  type CreatedInvoice,
  type CreatedPaymentIntent
} from "./dto.ts";

export interface CreateIntentInput {
  amount: number;
  currency: string;
  scale: number;
  payment_method: string;
  external_reference?: string | null;
  location_id?: string | null;
  metadata?: Record<string, unknown>;
}

export class PaymentIntentService {
  private readonly payments: PaymentRepository;
  private readonly merchants: MerchantRepository;
  private readonly locations: LocationRepository;
  private readonly audit: AuditRepository;
  private readonly events: EventPublisher;
  private readonly providers: LightningProviders;
  private readonly auth: AuthService;
  private readonly risk: RiskService;
  private readonly checkout: CheckoutService;
  private readonly config: PayConfig;
  private readonly now: () => Date;
  private readonly expireDueIntents: () => Promise<number>;

  constructor(
    payments: PaymentRepository,
    merchants: MerchantRepository,
    locations: LocationRepository,
    audit: AuditRepository,
    events: EventPublisher,
    providers: LightningProviders,
    auth: AuthService,
    risk: RiskService,
    checkout: CheckoutService,
    config: PayConfig,
    now: () => Date = () => new Date(),
    expireDueIntents: () => Promise<number> = async () => 0
  ) {
    this.payments = payments;
    this.merchants = merchants;
    this.locations = locations;
    this.audit = audit;
    this.events = events;
    this.providers = providers;
    this.auth = auth;
    this.risk = risk;
    this.checkout = checkout;
    this.config = config;
    this.now = now;
    this.expireDueIntents = expireDueIntents;
  }

  async createPaymentIntent(
    auth: AuthContext,
    input: CreateIntentInput,
    idempotencyKey: string | undefined,
    requestId: string,
    endpoint = "POST /v1/payment-intents"
  ): Promise<CreatedPaymentIntent> {
    this.auth.requireScope(auth, "payments:write");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new PayError("PAY_IDEMPOTENCY_MISSING");
    }
    const amountSat = assertAmount(input.amount);
    assertCurrency(input.currency, input.scale);
    if (input.payment_method !== "lightning") throw new PayError("PAY_VALIDATION_METHOD");
    if (input.external_reference !== undefined && input.external_reference !== null) {
      if (typeof input.external_reference !== "string" || input.external_reference.length > 200) {
        throw new PayError(
          "PAY_VALIDATION_BODY",
          "external_reference must be a string of at most 200 characters"
        );
      }
    }
    if (
      input.metadata !== undefined &&
      (typeof input.metadata !== "object" || Array.isArray(input.metadata))
    ) {
      throw new PayError("PAY_VALIDATION_BODY", "metadata must be an object");
    }
    if (
      input.location_id !== undefined &&
      input.location_id !== null &&
      (typeof input.location_id !== "string" || input.location_id.length > 80)
    ) {
      throw new PayError("PAY_VALIDATION_BODY", "location_id must be a string or null");
    }
    const merchant = await this.merchants.getMerchant(auth.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    const mode = auth.livemode ? "live" : "sandbox";
    const provider = auth.livemode ? this.providers.live : this.providers.sandbox;
    if (!provider) throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live provider is not configured");
    const connections = await this.merchants.listActiveProviderConnections(auth.organizationId, mode);
    const connection = connections[0];
    if (!connection) throw new PayError("PAY_PROVIDER_UNAVAILABLE", "no active provider connection");

    const digest = requestDigest({
      amount: input.amount,
      currency: input.currency,
      scale: input.scale,
      payment_method: input.payment_method,
      external_reference: input.external_reference ?? null,
      location_id: input.location_id ?? null,
      metadata: input.metadata ?? {}
    });
    const now = this.now();
    const intentId = newId("pi");
    const attemptId = newId("pa");
    const invoiceId = newId("in");
    const expiresAt = new Date(now.getTime() + this.config.invoiceTtlSeconds * 1000);
    const amountMsat = satToMsat(amountSat);

    return this.payments.db.transaction(async (client) => {
      const reserved = await this.payments.reserveIdempotency(
        {
          merchantId: auth.merchantId,
          endpoint,
          key: idempotencyKey,
          requestDigest: digest,
          now
        },
        client
      );
      if (!reserved) {
        const existing = await this.payments.findIdempotency(
          auth.merchantId,
          endpoint,
          idempotencyKey,
          client
        );
        if (!existing) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        if (existing.requestDigest !== digest) throw new PayError("PAY_IDEMPOTENCY_CONFLICT");
        if (existing.status !== 1) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        return existing.response as CreatedPaymentIntent;
      }

      if (input.location_id) {
        const location = await this.locations.getActive(auth.merchantId, input.location_id);
        if (!location) throw new PayError("PAY_NOT_FOUND_LOCATION");
      }

      await this.risk.assertCanCreate(auth.merchantId, amountMsat, client);

      let providerInvoice;
      try {
        providerInvoice = await provider.createInvoice({
          amountMsat,
          memo: input.external_reference ?? intentId,
          expirySeconds: this.config.invoiceTtlSeconds
        });
      } catch {
        throw new PayError("PAY_PROVIDER_UNAVAILABLE");
      }

      await this.payments.createIntent(
        {
          id: intentId,
          organizationId: auth.organizationId,
          merchantId: auth.merchantId,
          providerConnectionId: connection.id,
          externalReference: input.external_reference ?? null,
          locationId: input.location_id ?? null,
          amountMsat,
          currency: SAT_CURRENCY,
          scale: SAT_SCALE,
          livemode: auth.livemode,
          expiresAt,
          metadata: input.metadata ?? {},
          now
        },
        client
      );
      await this.payments.createAttempt(
        { id: attemptId, intentId, providerConnectionId: connection.id, now },
        client
      );
      await this.payments.bindInvoice(
        {
          id: invoiceId,
          attemptId,
          providerReference: providerInvoice.providerReference,
          paymentHash: providerInvoice.paymentHash,
          bolt11: providerInvoice.bolt11,
          amountMsat,
          expiresAt: providerInvoice.expiresAt,
          now
        },
        client
      );
      await this.payments.activateIntent(intentId, attemptId, now, client);

      const intent = await this.payments.getIntentByIdForUpdate(intentId, client);
      const attempt = await this.payments.getLatestAttempt(intentId, client);
      const invoice = await this.payments.getInvoiceByAttemptId(attemptId, client);
      if (!intent || !attempt || !invoice) throw new PayError("PAY_STATE_ILLEGAL");
      const response = createdIntentResponse(
        intent,
        attempt,
        invoice,
        requestId,
        this.checkout.urlForIntent(intentId)
      );

      const createdEvent = this.event("payment.created", auth.merchantId, auth.livemode, now, {
        payment_intent_id: intentId,
        amount_msat: amountMsat.toString(),
        currency: SAT_CURRENCY,
        scale: SAT_SCALE,
        external_reference: input.external_reference ?? null,
        status: "PENDING"
      });
      const pendingEvent = this.event("payment.pending", auth.merchantId, auth.livemode, now, {
        payment_intent_id: intentId,
        attempt_id: attemptId,
        status: "PENDING",
        invoice: {
          payment_hash: providerInvoice.paymentHash,
          bolt11: providerInvoice.bolt11,
          expires_at: providerInvoice.expiresAt.toISOString()
        }
      });
      await this.events.publish(createdEvent, auth.organizationId, client);
      await this.events.publish(pendingEvent, auth.organizationId, client);

      await this.payments.completeIdempotency(
        { merchantId: auth.merchantId, endpoint, key: idempotencyKey, response },
        client
      );
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "payment_intent.create",
          targetRef: intentId,
          result: "ACCEPTED",
          now
        },
        client
      );
      return response;
    });
  }

  async createInvoice(
    auth: AuthContext,
    input: CreateIntentInput,
    idempotencyKey: string | undefined,
    requestId: string
  ): Promise<CreatedInvoice> {
    const created = await this.createPaymentIntent(
      auth,
      input,
      idempotencyKey,
      requestId,
      "POST /v1/invoices"
    );
    const invoice = await this.payments.getInvoiceByHashForMerchant(
      auth.merchantId,
      created.payment.payment_hash
    );
    if (!invoice) throw new PayError("PAY_NOT_FOUND_INVOICE");
    return createdInvoiceResponse(created, invoice, requestId);
  }

  async getPaymentIntent(auth: AuthContext, intentId: string): Promise<PaymentIntentView> {
    this.auth.requireScope(auth, "payments:read");
    let view = await this.payments.getIntentView(auth.merchantId, intentId);
    if (!view) throw new PayError("PAY_NOT_FOUND_INTENT");
    if (
      (view.intent.status === "CREATED" || view.intent.status === "PENDING") &&
      Date.parse(view.intent.expiresAt) <= this.now().getTime()
    ) {
      await this.expireDueIntents();
      view = await this.payments.getIntentView(auth.merchantId, intentId);
      if (!view) throw new PayError("PAY_NOT_FOUND_INTENT");
    }
    return view;
  }

  async cancelPaymentIntent(auth: AuthContext, intentId: string): Promise<PaymentIntentView> {
    this.auth.requireScope(auth, "payments:write");
    const now = this.now();
    const view = await this.payments.db.transaction(async (client) => {
      const intent = await this.payments.getIntent(auth.merchantId, intentId, client, true);
      if (!intent) throw new PayError("PAY_NOT_FOUND_INTENT");
      if (
        intent.status === "SUCCEEDED" ||
        intent.status === "FAILED" ||
        intent.status === "EXPIRED" ||
        intent.status === "CANCELLED"
      ) {
        throw new PayError("PAY_STATE_TERMINAL");
      }
      const attempt = await this.payments.getLatestAttempt(intent.id, client);
      const invoice = attempt
        ? await this.payments.getInvoiceByAttemptId(attempt.id, client)
        : null;
      if (invoice && invoice.status === "SETTLED") throw new PayError("PAY_STATE_TERMINAL");
      if (invoice && attempt?.providerReference) {
        const provider = intent.livemode ? this.providers.live : this.providers.sandbox;
        if (!provider) throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live provider is not configured");
        const cancelled = await provider.cancelInvoice({
          providerReference: attempt.providerReference
        });
        if (!cancelled) {
          throw new PayError("PAY_STATE_ILLEGAL", "provider did not confirm cancellation");
        }
      }
      if (attempt) {
        assertAttemptTransition(attempt.status, "CANCELLED");
        await this.payments.setAttemptStatus(attempt.id, "CANCELLED", "cancelled", now, client);
      }
      if (invoice) {
        assertInvoiceTransition(invoice.status, "CANCELLED");
        await this.payments.setInvoiceStatus(invoice.id, "CANCELLED", null, client);
      }
      assertIntentTransition(intent.status, "CANCELLED");
      await this.payments.setIntentStatus(intent.id, "CANCELLED", now, client);
      const event = this.event("payment.cancelled", auth.merchantId, intent.livemode, now, {
        payment_intent_id: intent.id,
        status: "CANCELLED"
      });
      await this.events.publish(event, auth.organizationId, client);
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "payment_intent.cancel",
          targetRef: intent.id,
          result: "ACCEPTED",
          now
        },
        client
      );
      return this.payments.getIntentViewWithClient(auth.merchantId, intent.id, client);
    });
    if (!view) throw new PayError("PAY_NOT_FOUND_INTENT");
    return view;
  }

  async listPayments(
    auth: AuthContext,
    options: PaymentListOptions
  ): Promise<Page<PaymentIntent>> {
    this.auth.requireScope(auth, "payments:read");
    return this.payments.listPayments(auth.merchantId, options);
  }

  async exportPayments(
    auth: AuthContext,
    options: {
      from?: string;
      to?: string;
      status?: string;
      locationId?: string;
      limit?: number;
    } = {}
  ): Promise<PaymentIntent[]> {
    this.auth.requireScope(auth, "payments:read");
    const from = options.from ? new Date(options.from) : null;
    const to = options.to ? new Date(options.to) : null;
    if (from && Number.isNaN(from.getTime())) {
      throw new PayError("PAY_VALIDATION_BODY", "from must be an ISO date");
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new PayError("PAY_VALIDATION_BODY", "to must be an ISO date");
    }
    if (from && to && from >= to) {
      throw new PayError("PAY_VALIDATION_BODY", "to must be after from");
    }
    const limit = Math.min(Math.max(1, options.limit ?? 5000), 5000);
    return this.payments.exportPayments(auth.merchantId, {
      from,
      to,
      status: options.status ?? null,
      locationId: options.locationId ?? null,
      limit
    });
  }

  async getInvoice(auth: AuthContext, invoiceId: string): Promise<Invoice> {
    this.auth.requireScope(auth, "payments:read");
    const invoice = await this.payments.getInvoiceById(auth.merchantId, invoiceId);
    if (!invoice) throw new PayError("PAY_NOT_FOUND_INVOICE");
    return invoice;
  }

  async getMerchantProfile(auth: AuthContext): Promise<{
    id: string;
    organization_id: string;
    name: string;
    status: string;
    default_currency: string;
    support_email: string | null;
    website: string | null;
  }> {
    const merchant = await this.merchants.getMerchant(auth.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    return {
      id: merchant.id,
      organization_id: merchant.organization_id,
      name: merchant.name,
      status: merchant.status,
      default_currency: merchant.default_currency,
      support_email: merchant.support_email,
      website: merchant.website
    };
  }

  private event(
    type: string,
    merchantId: string,
    livemode: boolean,
    now: Date,
    data: Record<string, unknown>
  ): import("../domain/types.ts").WebhookEvent {
    return {
      id: newId("evt"),
      type,
      api_version: API_VERSION,
      created_at: now.toISOString(),
      livemode,
      merchant_id: merchantId,
      data
    };
  }
}
