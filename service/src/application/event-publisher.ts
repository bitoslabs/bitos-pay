import type { DbClient } from "../infrastructure/db/database.ts";
import type { WebhookRepository } from "../infrastructure/repositories/index.ts";
import type { WebhookEvent } from "../domain/types.ts";

export class EventPublisher {
  private readonly webhooks: WebhookRepository;

  constructor(webhooks: WebhookRepository) {
    this.webhooks = webhooks;
  }

  async publish(event: WebhookEvent, organizationId: string, client: DbClient): Promise<void> {
    await this.webhooks.insertOutboxEvent(
      {
        id: event.id,
        organizationId,
        merchantId: event.merchant_id,
        type: event.type,
        apiVersion: event.api_version,
        livemode: event.livemode,
        payload: event,
        now: new Date(event.created_at)
      },
      client
    );
    await this.webhooks.enqueueDeliveries(event, new Date(event.created_at), client);
  }
}
