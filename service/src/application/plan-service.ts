import { PayError, newId } from "../domain/index.ts";
import type { AuthContext } from "../domain/types.ts";
import type { LightningProvider } from "./ports/lightning-provider.ts";
import type { AuditRepository, PlanRepository, Entitlement, Subscription } from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

const PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionWithInvoice {
  subscription: Subscription;
  invoice: {
    provider_reference: string;
    payment_hash: string;
    bolt11: string;
    amount_msat: bigint;
    expires_at: string;
  };
}

export interface ActivationResult {
  subscription: Subscription;
  entitlement: Entitlement;
}

export class PlanService {
  private readonly plans: PlanRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly provider: LightningProvider;
  private readonly now: () => Date;

  constructor(
    plans: PlanRepository,
    audit: AuditRepository,
    auth: AuthService,
    provider: LightningProvider,
    now: () => Date = () => new Date()
  ) {
    this.plans = plans;
    this.audit = audit;
    this.auth = auth;
    this.provider = provider;
    this.now = now;
  }

  async listPlans() {
    return this.plans.listPlans();
  }

  async createSubscription(auth: AuthContext, planCode: string): Promise<SubscriptionWithInvoice> {
    this.auth.requireScope(auth, "keys:write");
    if (auth.livemode) throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live plans are unavailable");
    const plan = await this.plans.getPlan(planCode);
    if (!plan || plan.status !== "ACTIVE") throw new PayError("PAY_NOT_FOUND_PLAN");
    if (plan.priceMsat <= 0n) {
      throw new PayError("PAY_VALIDATION_BODY", "the free plan does not need a subscription");
    }
    const now = this.now();
    const invoice = await this.provider.createInvoice({
      amountMsat: plan.priceMsat,
      memo: `${plan.name} subscription`,
      expirySeconds: 900
    });
    const subscription = await this.plans.createSubscription({
      id: newId("sub"),
      organizationId: auth.organizationId,
      merchantId: auth.merchantId,
      planCode: plan.code,
      providerReference: invoice.providerReference,
      paymentHash: invoice.paymentHash,
      bolt11: invoice.bolt11,
      amountMsat: invoice.amountMsat,
      currency: plan.currency,
      expiresAt: invoice.expiresAt,
      now
    });
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "subscription.created",
      targetRef: subscription.id,
      result: "ACCEPTED",
      now
    });
    return {
      subscription,
      invoice: {
        provider_reference: invoice.providerReference,
        payment_hash: invoice.paymentHash,
        bolt11: invoice.bolt11,
        amount_msat: invoice.amountMsat,
        expires_at: invoice.expiresAt.toISOString()
      }
    };
  }

  async settleSandbox(auth: AuthContext, subscriptionId: string): Promise<ActivationResult> {
    this.auth.requireScope(auth, "keys:write");
    const subscription = await this.plans.getSubscription(auth.merchantId, subscriptionId);
    if (!subscription) throw new PayError("PAY_NOT_FOUND_SUBSCRIPTION");
    if (subscription.status === "ACTIVE") {
      const entitlement = await this.plans.getEntitlement(auth.organizationId);
      if (!entitlement) throw new PayError("PAY_NOT_FOUND_ENTITLEMENT");
      return { subscription, entitlement };
    }
    if (subscription.status !== "PENDING_PAYMENT") throw new PayError("PAY_STATE_ILLEGAL");
    const now = this.now();
    if (new Date(subscription.expiresAt).getTime() <= now.getTime()) {
      throw new PayError("PAY_STATE_EXPIRED");
    }
    if (!subscription.providerReference || !subscription.paymentHash) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "subscription has no provider invoice");
    }
    await this.provider.verifyProof({
      providerReference: subscription.providerReference,
      paymentHash: subscription.paymentHash,
      amountMsat: subscription.amountMsat
    });
    const plan = await this.plans.getPlan(subscription.planCode);
    if (!plan) throw new PayError("PAY_NOT_FOUND_PLAN");
    const periodStart = now;
    const periodEnd = new Date(now.getTime() + PERIOD_DAYS * DAY_MS);
    const result = await this.plans.db.transaction(async (client) => {
      const active = await this.plans.activateSubscription(
        {
          id: subscription.id,
          merchantId: subscription.merchantId,
          periodStart,
          periodEnd,
          paidAt: now,
          now
        },
        client
      );
      if (!active) throw new PayError("PAY_STATE_ILLEGAL");
      const entitlement = await this.plans.upsertEntitlement(
        {
          id: newId("ent"),
          organizationId: active.organizationId,
          subscriptionId: active.id,
          planCode: plan.code,
          features: plan.features,
          limits: plan.limits,
          validFrom: periodStart,
          validUntil: periodEnd,
          now
        },
        client
      );
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "subscription.activated",
          targetRef: active.id,
          result: "ACCEPTED",
          now
        },
        client
      );
      return { subscription: active, entitlement };
    });
    return result;
  }

  async getEntitlement(auth: AuthContext): Promise<Entitlement | null> {
    this.auth.requireScope(auth, "payments:read");
    const entitlement = await this.plans.getEntitlement(auth.organizationId);
    if (entitlement) {
      if (entitlement.validUntil && new Date(entitlement.validUntil).getTime() <= this.now().getTime()) {
        return { ...entitlement, status: "EXPIRED" };
      }
      return entitlement;
    }
    const free = await this.plans.getPlan("workspace_free");
    if (!free) return null;
    const now = this.now().toISOString();
    return {
      id: `ent_default_${auth.organizationId}`,
      organizationId: auth.organizationId,
      subscriptionId: null,
      planCode: free.code,
      features: free.features,
      limits: free.limits,
      status: "ACTIVE",
      validFrom: now,
      validUntil: null,
      revision: 0,
      updatedAt: now
    };
  }
}
