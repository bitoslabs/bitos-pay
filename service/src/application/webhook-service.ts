import type { PayConfig } from "../config.ts";
import {
  PayError,
  PAYMENT_EVENTS,
  newId,
  randomToken,
  requestDigest,
  webhookSignature
} from "../domain/index.ts";
import type {
  AuthContext,
  StoredWebhookDelivery,
  WebhookDelivery,
  WebhookEndpoint
} from "../domain/types.ts";
import type {
  AuditRepository,
  PaymentRepository,
  WebhookRepository
} from "../infrastructure/repositories/index.ts";
import type { SecretBox } from "./ports/secret-box.ts";
import type { AuthService } from "./auth-service.ts";
import type {
  WebhookEndpointRegistration,
  WebhookEndpointRotation
} from "./dto.ts";

const BACKOFF_SECONDS = [0, 30, 120, 600, 1800, 7200, 21600, 86400];

export interface RegisterWebhookInput {
  url: string;
  events: string[];
}

export class WebhookService {
  private readonly payments: PaymentRepository;
  private readonly webhooks: WebhookRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly secrets: SecretBox;
  private readonly config: PayConfig;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;

  constructor(
    payments: PaymentRepository,
    webhooks: WebhookRepository,
    audit: AuditRepository,
    auth: AuthService,
    secrets: SecretBox,
    config: PayConfig,
    now: () => Date = () => new Date(),
    fetchImpl: typeof fetch = globalThis.fetch
  ) {
    this.payments = payments;
    this.webhooks = webhooks;
    this.audit = audit;
    this.auth = auth;
    this.secrets = secrets;
    this.config = config;
    this.now = now;
    this.fetchImpl = fetchImpl;
  }

  async registerEndpoint(
    auth: AuthContext,
    input: RegisterWebhookInput,
    idempotencyKey: string | undefined
  ): Promise<WebhookEndpointRegistration> {
    this.auth.requireScope(auth, "webhooks:write");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new PayError("PAY_IDEMPOTENCY_MISSING");
    }
    const url = this.validateUrl(input.url);
    const events = input.events.length > 0 ? input.events : ["*"];
    for (const event of events) {
      if (!PAYMENT_EVENTS.has(event)) {
        throw new PayError("PAY_WEBHOOK_INVALID", `unsupported event ${event}`);
      }
    }
    const digest = requestDigest({ url, events });
    const now = this.now();
    const endpointId = newId("whe");
    const secret = randomToken("whsec_", 32);
    const ciphertext = this.secrets.encrypt(secret);
    return this.payments.db.transaction(async (client) => {
      const reserved = await this.payments.reserveIdempotency(
        {
          merchantId: auth.merchantId,
          endpoint: "POST /v1/webhook-endpoints",
          key: idempotencyKey,
          requestDigest: digest,
          now
        },
        client
      );
      if (!reserved) {
        const existing = await this.payments.findIdempotency(
          auth.merchantId,
          "POST /v1/webhook-endpoints",
          idempotencyKey,
          client
        );
        if (!existing) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        if (existing.requestDigest !== digest) throw new PayError("PAY_IDEMPOTENCY_CONFLICT");
        if (existing.status !== 1) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        return existing.response as WebhookEndpointRegistration;
      }
      await this.webhooks.createEndpoint(
        {
          id: endpointId,
          organizationId: auth.organizationId,
          merchantId: auth.merchantId,
          url,
          secretCiphertext: ciphertext,
          events,
          now
        },
        client
      );
      const endpoint: WebhookEndpoint = {
        id: endpointId,
        organizationId: auth.organizationId,
        merchantId: auth.merchantId,
        url,
        events,
        status: "ACTIVE",
        createdAt: now.toISOString()
      };
      const response: WebhookEndpointRegistration = { endpoint, secret };
      await this.payments.completeIdempotency(
        {
          merchantId: auth.merchantId,
          endpoint: "POST /v1/webhook-endpoints",
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
          action: "webhook_endpoint.create",
          targetRef: endpointId,
          result: "ACCEPTED",
          now
        },
        client
      );
      return response;
    });
  }

  async rotateEndpointSecret(
    auth: AuthContext,
    endpointId: string
  ): Promise<WebhookEndpointRotation> {
    this.auth.requireScope(auth, "webhooks:write");
    const now = this.now();
    const secret = randomToken("whsec_", 32);
    const previousSecretExpiresAt = new Date(
      now.getTime() + this.config.webhookRotationGraceSeconds * 1000
    );
    return this.payments.db.transaction(async (client) => {
      const endpoint = await this.webhooks.rotateEndpointSecret(
        auth.merchantId,
        endpointId,
        this.secrets.encrypt(secret),
        previousSecretExpiresAt,
        client
      );
      if (!endpoint) throw new PayError("PAY_WEBHOOK_INVALID", "active endpoint not found");
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "webhook_endpoint.rotate_secret",
          targetRef: endpointId,
          result: "ACCEPTED",
          now
        },
        client
      );
      return {
        endpoint,
        secret,
        previousSecretExpiresAt: previousSecretExpiresAt.toISOString()
      };
    });
  }

  async listEndpoints(auth: AuthContext): Promise<WebhookEndpoint[]> {
    this.auth.requireScope(auth, "webhooks:read");
    return this.webhooks.listEndpoints(auth.merchantId);
  }

  async listDeliveries(auth: AuthContext, limit: number): Promise<WebhookDelivery[]> {
    this.auth.requireScope(auth, "webhooks:read");
    return this.webhooks.listDeliveries(auth.merchantId, limit);
  }

  async replayDelivery(auth: AuthContext, deliveryId: string): Promise<WebhookDelivery> {
    this.auth.requireScope(auth, "webhooks:write");
    const now = this.now();
    const delivery = await this.webhooks.getDelivery(auth.merchantId, deliveryId);
    if (!delivery) throw new PayError("PAY_WEBHOOK_INVALID", "delivery not found");
    const reset = await this.webhooks.resetDelivery(auth.merchantId, deliveryId, now);
    if (!reset) throw new PayError("PAY_WEBHOOK_INVALID", "delivery not found");
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "webhook_delivery.replay",
      targetRef: deliveryId,
      result: "ACCEPTED",
      now
    });
    return {
      ...delivery,
      status: "PENDING",
      attempt: 0,
      responseCode: null,
      lastError: null,
      nextAttemptAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
  }

  async updateEndpoint(
    auth: AuthContext,
    endpointId: string,
    events: string[]
  ): Promise<WebhookEndpoint> {
    this.auth.requireScope(auth, "webhooks:write");
    if (!Array.isArray(events) || events.length === 0) {
      throw new PayError("PAY_WEBHOOK_INVALID", "at least one event is required");
    }
    for (const event of events) {
      if (!PAYMENT_EVENTS.has(event)) {
        throw new PayError("PAY_WEBHOOK_INVALID", `unsupported event ${event}`);
      }
    }
    const endpoint = await this.webhooks.updateEndpointEvents(
      auth.merchantId,
      endpointId,
      events
    );
    if (!endpoint) throw new PayError("PAY_WEBHOOK_INVALID", "endpoint not found or inactive");
    const now = this.now();
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "webhook_endpoint.update",
      targetRef: endpointId,
      result: "ACCEPTED",
      now
    });
    return endpoint;
  }

  async disableEndpoint(auth: AuthContext, endpointId: string): Promise<WebhookEndpoint> {
    this.auth.requireScope(auth, "webhooks:write");
    const endpoint = await this.webhooks.disableEndpoint(auth.merchantId, endpointId);
    if (!endpoint) throw new PayError("PAY_WEBHOOK_INVALID", "endpoint not found");
    const now = this.now();
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "webhook_endpoint.disable",
      targetRef: endpointId,
      result: "ACCEPTED",
      now
    });
    return endpoint;
  }

  async deliverDue(now = this.now()): Promise<{ delivered: number; failed: number; dead: number }> {
    const deliveries = await this.webhooks.dueDeliveries(now, 20);
    let delivered = 0;
    let failed = 0;
    let dead = 0;
    for (const delivery of deliveries) {
      const result = await this.deliverOne(delivery, now);
      if (result === "DELIVERED") delivered += 1;
      else if (result === "FAILED") failed += 1;
      else dead += 1;
    }
    return { delivered, failed, dead };
  }

  private async deliverOne(
    delivery: StoredWebhookDelivery,
    now: Date
  ): Promise<"DELIVERED" | "FAILED" | "DEAD"> {
    let secret: string;
    try {
      secret = this.secrets.decrypt(delivery.secret);
    } catch {
      await this.webhooks.markDelivery({
        id: delivery.id,
        status: "DEAD",
        attempt: delivery.attempt + 1,
        nextAttemptAt: now,
        responseCode: null,
        lastError: "webhook secret could not be decrypted",
        now
      });
      return "DEAD";
    }
    let previousSecret: string | null = null;
    if (
      delivery.previousSecret &&
      delivery.previousSecretExpiresAt &&
      Date.parse(delivery.previousSecretExpiresAt) > now.getTime()
    ) {
      try {
        previousSecret = this.secrets.decrypt(delivery.previousSecret);
      } catch {
        previousSecret = null;
      }
    }
    const timestamp = Math.floor(now.getTime() / 1000);
    const body = JSON.stringify(delivery.payload);
    const signature = webhookSignature(secret, timestamp, body);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "bitos-pay-reference/0.1",
      "BitOS-Pay-Event-Id": delivery.eventId,
      "BitOS-Pay-Event-Type": delivery.eventType,
      "BitOS-Pay-Delivery-Id": delivery.id,
      "BitOS-Pay-Timestamp": String(timestamp),
      "BitOS-Pay-Signature": signature
    };
    if (previousSecret) {
      headers["BitOS-Pay-Signature-Previous"] = webhookSignature(previousSecret, timestamp, body);
    }
    let responseCode: number | null = null;
    let lastError: string | null = null;
    let success = false;
    try {
      const response = await this.fetchImpl(delivery.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(this.config.webhookTimeoutMs)
      });
      responseCode = response.status;
      success = response.status >= 200 && response.status < 300;
      if (!success) lastError = `endpoint returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    const attempt = delivery.attempt + 1;
    const status = success
      ? "DELIVERED"
      : attempt >= this.config.webhookMaxAttempts
        ? "DEAD"
        : "FAILED";
    const delayIndex = Math.min(attempt, BACKOFF_SECONDS.length - 1);
    const nextAttemptAt = success
      ? new Date(now.getTime() + 86400_000)
      : new Date(now.getTime() + BACKOFF_SECONDS[delayIndex] * 1000);
    await this.webhooks.markDelivery({
      id: delivery.id,
      status,
      attempt,
      nextAttemptAt,
      responseCode,
      lastError,
      now
    });
    if (success) {
      await this.webhooks.markOutboxPublished(delivery.eventId, now);
      return "DELIVERED";
    }
    return status === "DEAD" ? "DEAD" : "FAILED";
  }

  private validateUrl(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new PayError("PAY_VALIDATION_URL");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new PayError("PAY_VALIDATION_URL");
    }
    if (url.username || url.password) throw new PayError("PAY_VALIDATION_URL");
    if (!this.config.webhookAllowPrivate) {
      const host = url.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(".local") ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
      ) {
        throw new PayError("PAY_VALIDATION_URL", "private webhook destinations are disabled");
      }
    }
    return url.toString();
  }
}
