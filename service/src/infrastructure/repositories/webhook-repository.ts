import type { DbClient } from "../db/database.ts";
import type {
  StoredWebhookDelivery,
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEndpoint,
  WebhookEvent
} from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import { toIso, toJsonArray } from "./rows.ts";

export class WebhookRepository extends BaseRepository {
  async insertOutboxEvent(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      type: string;
      apiVersion: string;
      livemode: boolean;
      payload: WebhookEvent;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("outbox_events")}
        (id, organization_id, merchant_id, type, api_version, livemode, payload, created_at, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NULL)`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.type,
        input.apiVersion,
        input.livemode,
        JSON.stringify(input.payload),
        input.now.toISOString()
      ]
    );
  }

  async enqueueDeliveries(
    event: WebhookEvent,
    now: Date,
    client: DbClient = this.db
  ): Promise<number> {
    const endpoints = await client.query<{ id: string; events: unknown }>(
      `SELECT e.id, e.events
         FROM ${this.t("webhook_endpoints")} e
        WHERE e.merchant_id = $1 AND e.status = 'ACTIVE'`,
      [event.merchant_id]
    );
    let inserted = 0;
    for (const endpoint of endpoints.rows) {
      const events = toJsonArray(endpoint.events);
      if (events.length > 0 && !events.includes(event.type) && !events.includes("*")) continue;
      const result = await client.query(
        `INSERT INTO ${this.t("webhook_deliveries")}
          (id, endpoint_id, event_id, event_type, status, attempt, next_attempt_at, response_code, last_error, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'PENDING',0,$5,NULL,NULL,$6,$6)
         ON CONFLICT (endpoint_id, event_id) DO NOTHING
         RETURNING id`,
        [
          `whd_${endpoint.id}_${event.id}`,
          endpoint.id,
          event.id,
          event.type,
          now.toISOString(),
          now.toISOString()
        ]
      );
      inserted += result.rows.length;
    }
    return inserted;
  }

  async markOutboxPublished(eventId: string, now: Date): Promise<void> {
    await this.db.query(
      `UPDATE ${this.t("outbox_events")} SET published_at = $2
        WHERE id = $1 AND published_at IS NULL`,
      [eventId, now.toISOString()]
    );
  }

  async createEndpoint(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      url: string;
      secretCiphertext: string;
      events: string[];
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("webhook_endpoints")}
        (id, organization_id, merchant_id, url, secret_ciphertext, events, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'ACTIVE',$7)`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.url,
        input.secretCiphertext,
        JSON.stringify(input.events),
        input.now.toISOString()
      ]
    );
  }

  async listEndpoints(merchantId: string): Promise<WebhookEndpoint[]> {
    const result = await this.db.query<{
      id: string;
      organization_id: string;
      merchant_id: string;
      url: string;
      events: unknown;
      status: "ACTIVE" | "DISABLED";
      created_at: Date | string;
    }>(
      `SELECT id, organization_id, merchant_id, url, events, status, created_at
         FROM ${this.t("webhook_endpoints")} WHERE merchant_id = $1 ORDER BY created_at DESC`,
      [merchantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      merchantId: row.merchant_id,
      url: row.url,
      events: toJsonArray(row.events),
      status: row.status,
      createdAt: toIso(row.created_at)
    }));
  }

  async listDeliveries(merchantId: string, limit: number): Promise<WebhookDelivery[]> {
    const result = await this.db.query<{
      id: string;
      endpoint_id: string;
      event_id: string;
      event_type: string;
      status: WebhookDeliveryStatus;
      attempt: number;
      response_code: number | null;
      last_error: string | null;
      next_attempt_at: Date | string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT d.id, d.endpoint_id, d.event_id, d.event_type, d.status, d.attempt,
              d.response_code, d.last_error, d.next_attempt_at, d.created_at, d.updated_at
         FROM ${this.t("webhook_deliveries")} d
         JOIN ${this.t("webhook_endpoints")} e ON e.id = d.endpoint_id
        WHERE e.merchant_id = $1
        ORDER BY d.created_at DESC LIMIT $2`,
      [merchantId, limit]
    );
    return result.rows.map(mapDelivery);
  }

  async getDelivery(merchantId: string, deliveryId: string): Promise<WebhookDelivery | null> {
    const result = await this.db.query<{
      id: string;
      endpoint_id: string;
      event_id: string;
      event_type: string;
      status: WebhookDeliveryStatus;
      attempt: number;
      response_code: number | null;
      last_error: string | null;
      next_attempt_at: Date | string;
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT d.id, d.endpoint_id, d.event_id, d.event_type, d.status, d.attempt,
              d.response_code, d.last_error, d.next_attempt_at, d.created_at, d.updated_at
         FROM ${this.t("webhook_deliveries")} d
         JOIN ${this.t("webhook_endpoints")} e ON e.id = d.endpoint_id
        WHERE d.id = $1 AND e.merchant_id = $2`,
      [deliveryId, merchantId]
    );
    const row = result.rows[0];
    return row ? mapDelivery(row) : null;
  }

  async resetDelivery(merchantId: string, deliveryId: string, now: Date): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE ${this.t("webhook_deliveries")} d
          SET status = 'PENDING', attempt = 0, next_attempt_at = $3,
              response_code = NULL, last_error = NULL, updated_at = $3
         FROM ${this.t("webhook_endpoints")} e
        WHERE d.id = $1 AND d.endpoint_id = e.id AND e.merchant_id = $2
        RETURNING d.id`,
      [deliveryId, merchantId, now.toISOString()]
    );
    return result.rows.length > 0;
  }

  async updateEndpointEvents(
    merchantId: string,
    endpointId: string,
    events: string[]
  ): Promise<WebhookEndpoint | null> {
    const result = await this.db.query<{
      id: string;
      organization_id: string;
      merchant_id: string;
      url: string;
      events: unknown;
      status: "ACTIVE" | "DISABLED";
      created_at: Date | string;
    }>(
      `UPDATE ${this.t("webhook_endpoints")}
          SET events = $3::jsonb
        WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'
        RETURNING id, organization_id, merchant_id, url, events, status, created_at`,
      [endpointId, merchantId, JSON.stringify(events)]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      merchantId: row.merchant_id,
      url: row.url,
      events: toJsonArray(row.events),
      status: row.status,
      createdAt: toIso(row.created_at)
    };
  }

  async disableEndpoint(merchantId: string, endpointId: string): Promise<WebhookEndpoint | null> {
    const result = await this.db.query<{
      id: string;
      organization_id: string;
      merchant_id: string;
      url: string;
      events: unknown;
      status: "ACTIVE" | "DISABLED";
      created_at: Date | string;
    }>(
      `UPDATE ${this.t("webhook_endpoints")}
          SET status = 'DISABLED'
        WHERE id = $1 AND merchant_id = $2
        RETURNING id, organization_id, merchant_id, url, events, status, created_at`,
      [endpointId, merchantId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      merchantId: row.merchant_id,
      url: row.url,
      events: toJsonArray(row.events),
      status: row.status,
      createdAt: toIso(row.created_at)
    };
  }

  async rotateEndpointSecret(
    merchantId: string,
    endpointId: string,
    secretCiphertext: string,
    previousSecretExpiresAt: Date,
    client: DbClient = this.db
  ): Promise<WebhookEndpoint | null> {
    const result = await client.query<{
      id: string;
      organization_id: string;
      merchant_id: string;
      url: string;
      events: unknown;
      status: "ACTIVE" | "DISABLED";
      created_at: Date | string;
    }>(
      `UPDATE ${this.t("webhook_endpoints")}
          SET previous_secret_ciphertext = secret_ciphertext,
              previous_secret_expires_at = $3,
              secret_ciphertext = $4
        WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE'
        RETURNING id, organization_id, merchant_id, url, events, status, created_at`,
      [endpointId, merchantId, previousSecretExpiresAt.toISOString(), secretCiphertext]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      merchantId: row.merchant_id,
      url: row.url,
      events: toJsonArray(row.events),
      status: row.status,
      createdAt: toIso(row.created_at)
    };
  }

  async dueDeliveries(now: Date, limit: number): Promise<StoredWebhookDelivery[]> {
    const result = await this.db.query<{
      id: string;
      endpoint_id: string;
      event_id: string;
      event_type: string;
      status: WebhookDeliveryStatus;
      attempt: number;
      next_attempt_at: Date | string;
      url: string;
      secret_ciphertext: string;
      previous_secret_ciphertext: string | null;
      previous_secret_expires_at: Date | string | null;
      payload: unknown;
    }>(
      `SELECT d.id, d.endpoint_id, d.event_id, d.event_type, d.status, d.attempt, d.next_attempt_at,
              e.url, e.secret_ciphertext, e.previous_secret_ciphertext,
              e.previous_secret_expires_at, o.payload
         FROM ${this.t("webhook_deliveries")} d
         JOIN ${this.t("webhook_endpoints")} e ON e.id = d.endpoint_id
         JOIN ${this.t("outbox_events")} o ON o.id = d.event_id
        WHERE d.status IN ('PENDING', 'FAILED') AND d.next_attempt_at <= $1
          AND e.status = 'ACTIVE'
        ORDER BY d.next_attempt_at ASC LIMIT $2`,
      [now.toISOString(), limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      endpointId: row.endpoint_id,
      eventId: row.event_id,
      eventType: row.event_type,
      payload: row.payload as WebhookEvent,
      url: row.url,
      secret: row.secret_ciphertext,
      previousSecret: row.previous_secret_ciphertext,
      previousSecretExpiresAt: row.previous_secret_expires_at
        ? toIso(row.previous_secret_expires_at)
        : null,
      status: row.status,
      attempt: Number(row.attempt),
      nextAttemptAt: toIso(row.next_attempt_at)
    }));
  }

  async markDelivery(
    input: {
      id: string;
      status: WebhookDeliveryStatus;
      attempt: number;
      nextAttemptAt: Date;
      responseCode: number | null;
      lastError: string | null;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.t("webhook_deliveries")}
          SET status = $2, attempt = $3, next_attempt_at = $4,
              response_code = $5, last_error = $6, updated_at = $7
        WHERE id = $1`,
      [
        input.id,
        input.status,
        input.attempt,
        input.nextAttemptAt.toISOString(),
        input.responseCode,
        input.lastError,
        input.now.toISOString()
      ]
    );
  }
}

function mapDelivery(row: {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  response_code: number | null;
  last_error: string | null;
  next_attempt_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}): WebhookDelivery {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    eventType: row.event_type,
    status: row.status,
    attempt: Number(row.attempt),
    responseCode: row.response_code,
    lastError: row.last_error,
    nextAttemptAt: toIso(row.next_attempt_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}
