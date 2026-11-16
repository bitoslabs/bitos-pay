import { PayError, sha256Hex } from "../domain/index.ts";
import type {
  ApiKeyTelemetry,
  AuditLogEntry,
  AuthContext,
  MerchantHealthSummary
} from "../domain/types.ts";
import type {
  AuditRepository,
  MerchantRepository,
  PaymentRepository,
  WebhookRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const EXPIRING_SOON_MS = 7 * DAY_MS;
const STALE_KEY_MS = 30 * DAY_MS;

function toHourBucket(date: Date): Date {
  const ts = Math.floor(date.getTime() / HOUR_MS) * HOUR_MS;
  return new Date(ts);
}

function normalizeEndpoint(rawUrl: string): string {
  const idx = rawUrl.indexOf("?");
  const path = idx === -1 ? rawUrl : rawUrl.slice(0, idx);
  return path.slice(0, 120) || "/";
}

export class MonitoringService {
  private readonly merchants: MerchantRepository;
  private readonly payments: PaymentRepository;
  private readonly webhooks: WebhookRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly now: () => Date;

  constructor(
    merchants: MerchantRepository,
    payments: PaymentRepository,
    webhooks: WebhookRepository,
    audit: AuditRepository,
    auth: AuthService,
    now: () => Date = () => new Date()
  ) {
    this.merchants = merchants;
    this.payments = payments;
    this.webhooks = webhooks;
    this.audit = audit;
    this.auth = auth;
    this.now = now;
  }

  async recordApiKeyUsageFromBearer(
    authorization: string | undefined,
    statusCode: number,
    endpoint: string
  ): Promise<void> {
    if (!authorization) return;
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!match) return;
    const secret = match[1];
    if (!secret.startsWith("bp_test_") && !secret.startsWith("bp_live_")) return;
    const keyId = await this.merchants.findApiKeyIdByHash(sha256Hex(secret));
    if (!keyId) return;
    await this.merchants.recordApiKeyUsage({
      apiKeyId: keyId,
      bucketStart: toHourBucket(this.now()),
      statusCode,
      endpoint: normalizeEndpoint(endpoint)
    });
  }

  async getApiKeyTelemetry(
    auth: AuthContext,
    keyId: string,
    hours = 24
  ): Promise<ApiKeyTelemetry> {
    this.auth.requireScope(auth, "keys:read");
    const windowHours = Math.min(Math.max(Math.floor(hours), 1), 168);
    const key = await this.merchants.getApiKey(auth.merchantId, keyId);
    if (!key) throw new PayError("PAY_NOT_FOUND_API_KEY");

    const now = this.now();
    const since = new Date(toHourBucket(now).getTime() - (windowHours - 1) * HOUR_MS);
    const [buckets, recentAudit] = await Promise.all([
      this.merchants.listApiKeyUsage(keyId, since),
      this.audit.listByOrganization(auth.organizationId, { limit: 15, targetRef: keyId })
    ]);

    const totals = buckets.reduce(
      (acc, bucket) => ({
        totalCount: acc.totalCount + bucket.totalCount,
        successCount: acc.successCount + bucket.successCount,
        authErrorCount: acc.authErrorCount + bucket.authErrorCount,
        rateLimitCount: acc.rateLimitCount + bucket.rateLimitCount,
        serverErrorCount: acc.serverErrorCount + bucket.serverErrorCount,
        lastEndpoint: bucket.lastEndpoint ?? acc.lastEndpoint
      }),
      {
        totalCount: 0,
        successCount: 0,
        authErrorCount: 0,
        rateLimitCount: 0,
        serverErrorCount: 0,
        lastEndpoint: null as string | null
      }
    );

    return { key, windowHours, totals, buckets, recentAudit };
  }

  async getMerchantHealth(auth: AuthContext): Promise<MerchantHealthSummary> {
    const merchant = await this.merchants.getMerchant(auth.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");

    const now = this.now();
    const minuteSince = new Date(now.getTime() - MINUTE_MS);
    const daySince = new Date(now.getTime() - DAY_MS);

    const [usage, quarantinedPayments, deadWebhooks, connections, keys] = await Promise.all([
      this.payments.riskUsage(auth.merchantId, minuteSince, daySince, this.merchants.db),
      this.payments.countQuarantinedAttempts(auth.merchantId),
      this.webhooks.countDeadDeliveries(auth.merchantId),
      this.merchants.listProviderConnections(auth.organizationId),
      auth.scopes.includes("keys:read") || auth.scopes.includes("*")
        ? this.merchants.listApiKeys(auth.merchantId)
        : Promise.resolve([])
    ]);

    const degradedConnections = connections.filter(
      (c) => c.status === "DEGRADED" || c.status === "DISABLED"
    ).length;

    const nowMs = now.getTime();
    let expiringKeys = 0;
    let staleKeys = 0;
    for (const key of keys) {
      if (key.status !== "ACTIVE") continue;
      if (key.expiresAt) {
        const expMs = new Date(key.expiresAt).getTime();
        if (expMs > nowMs && expMs - nowMs <= EXPIRING_SOON_MS) {
          expiringKeys += 1;
        }
      }
      const lastRefMs = key.lastUsedAt
        ? new Date(key.lastUsedAt).getTime()
        : new Date(key.createdAt).getTime();
      if (nowMs - lastRefMs >= STALE_KEY_MS) {
        staleKeys += 1;
      }
    }

    return {
      merchantId: merchant.id,
      merchantStatus: merchant.status,
      risk: {
        dayVolumeMsat: usage.dayVolumeMsat,
        dailyVolumeLimitMsat: BigInt(merchant.daily_volume_msat),
        minuteCount: usage.minuteCount,
        maxPaymentsPerMinute: Number(merchant.max_payments_per_minute),
        maxPaymentMsat: BigInt(merchant.max_payment_msat),
        feeBps: Number(merchant.fee_bps)
      },
      alerts: {
        quarantinedPayments,
        deadWebhooks,
        degradedConnections,
        expiringKeys,
        staleKeys
      },
      observedAt: now.toISOString()
    };
  }

  async listAuditLogs(
    auth: AuthContext,
    options: { limit?: number; actionPrefix?: string; targetRef?: string } = {}
  ): Promise<AuditLogEntry[]> {
    this.auth.requireScope(auth, "keys:read");
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 100);
    return this.audit.listByOrganization(auth.organizationId, {
      limit,
      actionPrefix: options.actionPrefix,
      targetRef: options.targetRef
    });
  }
}
