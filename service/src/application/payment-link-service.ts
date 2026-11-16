import type { PayConfig } from "../config.ts";
import {
  PayError,
  SAT_CURRENCY,
  SAT_SCALE,
  assertAmount,
  assertCurrency,
  msatToSatNumber,
  newId,
  paymentLinkToken,
  requestDigest,
  satToMsat,
  verifyPaymentLinkToken
} from "../domain/index.ts";
import type { AuthContext, PaymentLink } from "../domain/types.ts";
import type {
  AuditRepository,
  MerchantRepository,
  PaymentLinkRepository,
  PaymentRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";
import type { PaymentIntentService } from "./payment-intent-service.ts";
import type {
  CreatedPaymentLink,
  PublicPaymentLink
} from "./dto.ts";

export interface CreatePaymentLinkInput {
  amount: number;
  currency: string;
  scale: number;
  reference?: string | null;
  label?: string | null;
}

interface Window {
  count: number;
  resetAt: number;
}

export class PaymentLinkService {
  private readonly payments: PaymentRepository;
  private readonly links: PaymentLinkRepository;
  private readonly merchants: MerchantRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly paymentIntents: PaymentIntentService;
  private readonly config: PayConfig;
  private readonly now: () => Date;
  private readonly windows = new Map<string, Window>();

  constructor(
    payments: PaymentRepository,
    links: PaymentLinkRepository,
    merchants: MerchantRepository,
    audit: AuditRepository,
    auth: AuthService,
    paymentIntents: PaymentIntentService,
    config: PayConfig,
    now: () => Date = () => new Date()
  ) {
    this.payments = payments;
    this.links = links;
    this.merchants = merchants;
    this.audit = audit;
    this.auth = auth;
    this.paymentIntents = paymentIntents;
    this.config = config;
    this.now = now;
  }

  urlForLink(linkId: string): string {
    const base = this.config.publicBaseUrl.replace(/\/$/, "");
    return `${base}/pay/${paymentLinkToken(linkId, this.config.secretKey)}`;
  }

  async create(
    auth: AuthContext,
    input: CreatePaymentLinkInput,
    idempotencyKey: string | undefined
  ): Promise<CreatedPaymentLink> {
    this.auth.requireScope(auth, "payments:write");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new PayError("PAY_IDEMPOTENCY_MISSING");
    }
    const amountSat = assertAmount(input.amount);
    assertCurrency(input.currency, input.scale);
    const reference = this.optionalText(input.reference, 200, "reference");
    const label = this.optionalText(input.label, 120, "label");
    const digest = requestDigest({
      amount: input.amount,
      currency: input.currency,
      scale: input.scale,
      reference,
      label
    });
    const now = this.now();
    const linkId = newId("pl");
    const amountMsat = satToMsat(amountSat);
    return this.links.db.transaction(async (client) => {
      const reserved = await this.payments.reserveIdempotency(
        {
          merchantId: auth.merchantId,
          endpoint: "POST /v1/payment-links",
          key: idempotencyKey,
          requestDigest: digest,
          now
        },
        client
      );
      if (!reserved) {
        const existing = await this.payments.findIdempotency(
          auth.merchantId,
          "POST /v1/payment-links",
          idempotencyKey,
          client
        );
        if (!existing) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        if (existing.requestDigest !== digest) throw new PayError("PAY_IDEMPOTENCY_CONFLICT");
        if (existing.status !== 1) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        return existing.response as CreatedPaymentLink;
      }
      await this.links.create(
        {
          id: linkId,
          organizationId: auth.organizationId,
          merchantId: auth.merchantId,
          amountMsat,
          currency: SAT_CURRENCY,
          scale: SAT_SCALE,
          reference,
          label,
          now
        },
        client
      );
      const response: CreatedPaymentLink = {
        object: "payment_link",
        id: linkId,
        amount: Number(amountSat),
        amount_msat: amountMsat.toString(),
        currency: SAT_CURRENCY,
        scale: SAT_SCALE,
        reference,
        label,
        status: "ACTIVE",
        url: this.urlForLink(linkId),
        created_at: now.toISOString(),
        disabled_at: null
      };
      await this.payments.completeIdempotency(
        {
          merchantId: auth.merchantId,
          endpoint: "POST /v1/payment-links",
          key: idempotencyKey,
          response
        },
        client
      );
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "payment_link.create",
          targetRef: linkId,
          result: "ACCEPTED",
          now
        },
        client
      );
      return response;
    });
  }

  async list(auth: AuthContext): Promise<PaymentLink[]> {
    this.auth.requireScope(auth, "payments:read");
    return this.links.list(auth.merchantId);
  }

  async disable(auth: AuthContext, linkId: string): Promise<PaymentLink> {
    this.auth.requireScope(auth, "payments:write");
    const now = this.now();
    const link = await this.links.disable(auth.merchantId, linkId, now);
    if (!link) throw new PayError("PAY_NOT_FOUND_PAYMENT_LINK");
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "payment_link.disable",
      targetRef: linkId,
      result: "ACCEPTED",
      now
    });
    return link;
  }

  async publicView(token: string): Promise<PublicPaymentLink> {
    const link = await this.activeLink(token);
    return this.publicResponse(link);
  }

  async createCheckout(
    token: string,
    idempotencyKey: string | undefined,
    requestId: string,
    clientKey: string
  ): Promise<{ checkout_url: string; payment_id: string; status: string }> {
    this.consume(clientKey);
    const link = await this.activeLink(token);
    const merchant = await this.merchants.getMerchant(link.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    const auth: AuthContext = {
      apiKeyId: `payment_link:${link.id}`,
      organizationId: link.organizationId,
      merchantId: link.merchantId,
      merchantStatus: merchant.status,
      scopes: ["payments:write"],
      livemode: false
    };
    const created = await this.paymentIntents.createPaymentIntent(
      auth,
      {
        amount: msatToSatNumber(link.amountMsat),
        currency: link.currency,
        scale: link.scale,
        payment_method: "lightning",
        external_reference: link.reference ?? `payment_link:${link.id}`,
        metadata: {
          payment_link_id: link.id,
          ...(link.label ? { label: link.label } : {})
        }
      },
      idempotencyKey,
      requestId,
      `POST /v1/payment-links/${link.id}/checkout`
    );
    return {
      checkout_url: created.checkout_url,
      payment_id: created.id,
      status: created.status
    };
  }

  private async activeLink(token: string): Promise<PaymentLink> {
    const linkId = verifyPaymentLinkToken(token, this.config.secretKey);
    if (!linkId) throw new PayError("PAY_NOT_FOUND_PAYMENT_LINK");
    const link = await this.links.getActiveById(linkId);
    if (!link) throw new PayError("PAY_NOT_FOUND_PAYMENT_LINK");
    return link;
  }

  private async publicResponse(link: PaymentLink): Promise<PublicPaymentLink> {
    const merchant = await this.merchants.getMerchant(link.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    return {
      merchantName: merchant.name,
      amount: msatToSatNumber(link.amountMsat),
      currency: link.currency,
      scale: link.scale,
      reference: link.reference,
      label: link.label,
      url: this.urlForLink(link.id)
    };
  }

  private optionalText(value: unknown, max: number, name: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length > max) {
      throw new PayError(
        "PAY_VALIDATION_BODY",
        `${name} must be a string of at most ${max} characters`
      );
    }
    return value.trim() || null;
  }

  private consume(clientKey: string): void {
    const now = this.now().getTime();
    const current = this.windows.get(clientKey);
    if (!current || current.resetAt <= now) {
      this.windows.set(clientKey, { count: 1, resetAt: now + 60_000 });
      return;
    }
    if (current.count >= this.config.paymentLinkRateLimit) {
      throw new PayError("PAY_RATE_LIMITED", "payment link rate limit exceeded");
    }
    current.count += 1;
  }
}
