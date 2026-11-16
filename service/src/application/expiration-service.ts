import { API_VERSION, newId } from "../domain/index.ts";
import type { PaymentRepository } from "../infrastructure/repositories/index.ts";
import type { AuditRepository } from "../infrastructure/repositories/audit-repository.ts";
import type { EventPublisher } from "./event-publisher.ts";

export class ExpirationService {
  private readonly payments: PaymentRepository;
  private readonly audit: AuditRepository;
  private readonly events: EventPublisher;
  private readonly now: () => Date;

  constructor(
    payments: PaymentRepository,
    audit: AuditRepository,
    events: EventPublisher,
    now: () => Date = () => new Date()
  ) {
    this.payments = payments;
    this.audit = audit;
    this.events = events;
    this.now = now;
  }

  async expireDueIntents(): Promise<number> {
    const now = this.now();
    return this.payments.db.transaction(async (client) => {
      const due = await this.payments.findDueIntents(now, client);
      for (const row of due) {
        await this.payments.setIntentStatus(row.intent_id, "EXPIRED", now, client);
        await this.payments.setAttemptStatus(row.attempt_id, "EXPIRED", "expired", now, client);
        await this.payments.setInvoiceStatus(row.invoice_id, "EXPIRED", null, client);
        const event = {
          id: `evt_${row.intent_id}_expired_${now.getTime()}`,
          type: "payment.expired",
          api_version: API_VERSION,
          created_at: now.toISOString(),
          livemode: row.livemode,
          merchant_id: row.merchant_id,
          data: { payment_intent_id: row.intent_id, status: "EXPIRED" }
        };
        await this.events.publish(event, row.organization_id, client);
        await this.audit.insert(
          {
            id: newId("aud"),
            organizationId: row.organization_id,
            actorRef: "system:expiry",
            action: "payment_intent.expire",
            targetRef: row.intent_id,
            result: "EXPIRED",
            now
          },
          client
        );
      }
      return due.length;
    });
  }
}
