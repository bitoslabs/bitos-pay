import {
  API_VERSION,
  PayError,
  assertAttemptTransition,
  assertBalanced,
  assertIntentTransition,
  assertInvoiceTransition,
  computeFee,
  newId,
  paymentLedgerLines
} from "../domain/index.ts";
import type {
  ProviderEventInput,
  SettlementResult
} from "../domain/types.ts";
import type {
  LedgerRepository,
  MerchantRepository,
  PaymentRepository
} from "../infrastructure/repositories/index.ts";
import type { AuditRepository } from "../infrastructure/repositories/audit-repository.ts";
import type { ProviderProof } from "./ports/lightning-provider.ts";
import type { LightningProviders } from "../infrastructure/providers/index.ts";
import type { DbClient } from "../infrastructure/db/database.ts";
import type { EventPublisher } from "./event-publisher.ts";

const LIVE_STATUS_CHECK_MS = 10_000;
const LIVE_EXPIRED_STATUS_CHECK_MS = 60_000;
const LIVE_RECONCILE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export class SettlementService {
  private readonly payments: PaymentRepository;
  private readonly merchants: MerchantRepository;
  private readonly ledger: LedgerRepository;
  private readonly audit: AuditRepository;
  private readonly events: EventPublisher;
  private readonly providers: LightningProviders;
  private readonly now: () => Date;
  private readonly lastLiveStatusCheck = new Map<string, number>();

  constructor(
    payments: PaymentRepository,
    merchants: MerchantRepository,
    ledger: LedgerRepository,
    audit: AuditRepository,
    events: EventPublisher,
    providers: LightningProviders,
    now: () => Date = () => new Date()
  ) {
    this.payments = payments;
    this.merchants = merchants;
    this.ledger = ledger;
    this.audit = audit;
    this.events = events;
    this.providers = providers;
    this.now = now;
  }

  async settleInvoice(input: ProviderEventInput): Promise<SettlementResult> {
    const mode = input.mode ?? "sandbox";
    const provider = mode === "live" ? this.providers.live : this.providers.sandbox;
    if (!provider) throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live provider is not configured");
    const proof = await provider.verifyProof({
      providerReference: input.providerReference,
      paymentHash: input.paymentHash,
      amountMsat: input.amountMsat
    });
    const now = this.now();
    return this.payments.db.transaction(async (client) => {
      const inserted = await this.payments.insertProviderEvent(
        {
          id: newId("pev"),
          providerConnectionId: input.providerConnectionId,
          providerEventId: proof.providerEventId,
          paymentHash: proof.paymentHash,
          status: "ACCEPTED",
          payload: {
            provider_reference: proof.providerReference,
            payment_hash: proof.paymentHash,
            amount_msat: proof.amountMsat.toString(),
            occurred_at: proof.occurredAt.toISOString()
          },
          now
        },
        client
      );
      if (!inserted) return this.handleDuplicate(input, proof, client);

      const invoice = await this.payments.getInvoiceForUpdateByHash(proof.paymentHash, client);
      if (!invoice) throw new PayError("PAY_NOT_FOUND_INVOICE");
      if (invoice.amountMsat !== proof.amountMsat) {
        await this.payments.setProviderEventStatus(
          input.providerConnectionId,
          proof.providerEventId,
          "REJECTED",
          client
        );
        throw new PayError("PAY_PROVIDER_PROOF", "settled amount does not match the invoice");
      }
      const reportedAt = proof.occurredAt.getTime();
      const settledAt =
        reportedAt <= now.getTime() && reportedAt >= Date.parse(invoice.createdAt)
          ? proof.occurredAt
          : now;
      const attempt = await this.payments.getAttempt(invoice.paymentAttemptId, client);
      if (!attempt) throw new PayError("PAY_NOT_FOUND_INVOICE");
      const intent = await this.payments.getIntentByIdForUpdate(attempt.paymentIntentId, client);
      if (!intent) throw new PayError("PAY_NOT_FOUND_INTENT");
      const connection = await this.merchants.getProviderConnection(
        input.providerConnectionId,
        intent.organizationId
      );
      if (!connection || connection.status !== "ACTIVE") {
        throw new PayError("PAY_PROVIDER_UNAVAILABLE");
      }
      if (intent.providerConnectionId !== input.providerConnectionId) {
        await this.payments.setProviderEventStatus(
          input.providerConnectionId,
          proof.providerEventId,
          "REJECTED",
          client
        );
        throw new PayError("PAY_PROVIDER_PROOF", "provider connection does not own this invoice");
      }

      if (invoice.status === "SETTLED" || intent.status === "SUCCEEDED") {
        const transaction = await this.payments.getTransactionByPaymentHash(proof.paymentHash);
        await this.payments.setProviderEventStatus(
          input.providerConnectionId,
          proof.providerEventId,
          "DUPLICATE",
          client
        );
        return {
          status: "DUPLICATE",
          intentId: intent.id,
          transactionId: transaction?.id ?? null,
          invoiceStatus: "SETTLED",
          intentStatus: "SUCCEEDED"
        } satisfies SettlementResult;
      }
      if (invoice.status === "CANCELLED") {
        await this.payments.setProviderEventStatus(
          input.providerConnectionId,
          proof.providerEventId,
          "REJECTED",
          client
        );
        throw new PayError("PAY_STATE_ILLEGAL", "invoice was cancelled");
      }
      if (invoice.status === "QUARANTINED") {
        return {
          status: "QUARANTINED",
          intentId: intent.id,
          transactionId: null,
          invoiceStatus: "QUARANTINED",
          intentStatus: intent.status
        } satisfies SettlementResult;
      }

      if (settledAt.getTime() >= Date.parse(invoice.expiresAt)) {
        assertInvoiceTransition(invoice.status, "QUARANTINED");
        assertAttemptTransition(attempt.status, "QUARANTINED");
        await this.payments.setInvoiceStatus(invoice.id, "QUARANTINED", null, client);
        await this.payments.setAttemptStatus(
          attempt.id,
          "QUARANTINED",
          "late_settlement",
          now,
          client
        );
        await this.payments.setProviderEventStatus(
          input.providerConnectionId,
          proof.providerEventId,
          "QUARANTINED",
          client
        );
        const event = this.event("payment.quarantined", intent.merchantId, intent.livemode, now, {
          payment_intent_id: intent.id,
          attempt_id: attempt.id,
          payment_hash: invoice.paymentHash,
          amount_msat: invoice.amountMsat.toString(),
          reason: "late_settlement"
        });
        await this.events.publish(event, intent.organizationId, client);
        await this.audit.insert(
          {
            id: newId("aud"),
            organizationId: intent.organizationId,
            actorRef: `provider:${input.providerConnectionId}`,
            action: "invoice.settle",
            targetRef: invoice.id,
            result: "QUARANTINED",
            now
          },
          client
        );
        return {
          status: "QUARANTINED",
          intentId: intent.id,
          transactionId: null,
          invoiceStatus: "QUARANTINED",
          intentStatus: intent.status
        } satisfies SettlementResult;
      }

      const merchant = await this.merchants.getMerchant(intent.merchantId, client);
      if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
      const { feeMsat, netMsat } = computeFee(invoice.amountMsat, merchant.fee_bps);
      const transactionId = newId("txn");
      await this.payments.createTransaction(
        {
          id: transactionId,
          organizationId: intent.organizationId,
          merchantId: intent.merchantId,
          attemptId: attempt.id,
          providerConnectionId: input.providerConnectionId,
          providerReference: proof.providerReference,
          paymentHash: proof.paymentHash,
          amountMsat: invoice.amountMsat,
          feeMsat,
          netMsat,
          currency: intent.currency,
          scale: intent.scale,
          now: settledAt
        },
        client
      );
      await this.payments.insertFee(
        {
          id: newId("fee"),
          transactionId,
          ruleRef: `merchant:${merchant.id}:fee_bps:${merchant.fee_bps}`,
          basis: "amount_msat",
          amountMsat: feeMsat,
          currency: intent.currency,
          scale: intent.scale,
          now: settledAt
        },
        client
      );
      const lines = paymentLedgerLines(invoice.amountMsat, feeMsat);
      assertBalanced(lines);
      for (const line of lines) {
        const accountId = await this.ledger.ensureAccount(
          {
            id: newId("acct"),
            organizationId: intent.organizationId,
            code: line.accountCode,
            type: line.accountType,
            currency: intent.currency,
            scale: intent.scale,
            now
          },
          client
        );
        await this.ledger.insertEntry(
          {
            id: newId("le"),
            organizationId: intent.organizationId,
            transactionId,
            accountId,
            direction: line.direction,
            amountMsat: line.amountMsat,
            currency: intent.currency,
            scale: intent.scale,
            now: settledAt
          },
          client
        );
      }
      const ledger = await this.ledger.transactionBalance(
        intent.organizationId,
        transactionId,
        client
      );
      if (ledger.debit !== ledger.credit) {
        throw new PayError("PAY_STATE_ILLEGAL", "ledger entry set is not balanced");
      }

      assertInvoiceTransition(invoice.status, "SETTLED");
      await this.payments.setInvoiceStatus(invoice.id, "SETTLED", settledAt, client);
      assertAttemptTransition(attempt.status, "SUCCEEDED");
      assertIntentTransition(intent.status, "SUCCEEDED");
      await this.payments.setAttemptStatus(attempt.id, "SUCCEEDED", null, now, client);
      await this.payments.setIntentStatus(intent.id, "SUCCEEDED", now, client);
      await this.payments.setProviderEventStatus(
        input.providerConnectionId,
        proof.providerEventId,
        "ACCEPTED",
        client
      );

      const event = this.event("payment.succeeded", intent.merchantId, intent.livemode, now, {
        payment_intent_id: intent.id,
        attempt_id: attempt.id,
        transaction_id: transactionId,
        payment_hash: proof.paymentHash,
        amount_msat: invoice.amountMsat.toString(),
        fee_msat: feeMsat.toString(),
        net_msat: netMsat.toString(),
        currency: intent.currency,
        scale: intent.scale,
        settled_at: settledAt.toISOString()
      });
      const invoiceEvent = this.event("invoice.settled", intent.merchantId, intent.livemode, now, {
        invoice_id: invoice.id,
        payment_intent_id: intent.id,
        payment_hash: proof.paymentHash,
        status: "SETTLED",
        settled_at: settledAt.toISOString()
      });
      await this.events.publish(event, intent.organizationId, client);
      await this.events.publish(invoiceEvent, intent.organizationId, client);
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: intent.organizationId,
          actorRef: `provider:${input.providerConnectionId}`,
          action: "invoice.settle",
          targetRef: invoice.id,
          result: "ACCEPTED",
          now
        },
        client
      );
      return {
        status: "SETTLED",
        intentId: intent.id,
        transactionId,
        invoiceStatus: "SETTLED",
        intentStatus: "SUCCEEDED"
      } satisfies SettlementResult;
    });
  }

  async sandboxSettle(paymentHash: string, amountMsat?: bigint): Promise<SettlementResult> {
    const invoice = await this.payments.getInvoiceByHash(paymentHash);
    if (!invoice) throw new PayError("PAY_NOT_FOUND_INVOICE");
    const attempt = await this.payments.getAttempt(invoice.paymentAttemptId);
    if (!attempt?.providerReference) throw new PayError("PAY_NOT_FOUND_INVOICE");
    return this.settleInvoice({
      mode: "sandbox",
      providerConnectionId: attempt.providerConnectionId,
      providerEventId: "",
      providerReference: attempt.providerReference,
      paymentHash: invoice.paymentHash,
      amountMsat: amountMsat ?? invoice.amountMsat,
      occurredAt: this.now()
    });
  }

  async settleLiveProviderReference(providerReference: string): Promise<SettlementResult> {
    const provider = this.providers.live;
    if (!provider) throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live provider is not configured");
    if (!provider.resolvePaymentHash) {
      throw new PayError(
        "PAY_PROVIDER_UNAVAILABLE",
        "live provider cannot resolve a webhook payment reference"
      );
    }
    const paymentHash = await provider.resolvePaymentHash({ providerReference });
    return this.settleLive(paymentHash);
  }

  async settleLive(paymentHash: string): Promise<SettlementResult> {
    const invoice = await this.payments.getInvoiceByHash(paymentHash);
    if (!invoice) throw new PayError("PAY_NOT_FOUND_INVOICE");
    const attempt = await this.payments.getAttempt(invoice.paymentAttemptId);
    if (!attempt?.providerReference) throw new PayError("PAY_NOT_FOUND_INVOICE");
    const intent = await this.payments.getIntentById(attempt.paymentIntentId);
    if (!intent) throw new PayError("PAY_NOT_FOUND_INTENT");
    if (!intent.livemode) {
      throw new PayError("PAY_PROVIDER_PROOF", "sandbox invoice cannot settle as live");
    }
    const connection = await this.merchants.getProviderConnection(
      attempt.providerConnectionId,
      intent.organizationId
    );
    if (!connection || connection.mode !== "live") {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live provider connection is not active");
    }
    return this.settleInvoice({
      mode: "live",
      providerConnectionId: attempt.providerConnectionId,
      providerEventId: "",
      providerReference: attempt.providerReference,
      paymentHash: invoice.paymentHash,
      amountMsat: invoice.amountMsat,
      occurredAt: this.now()
    });
  }

  async reconcileLiveInvoices(
    limit = 20
  ): Promise<{ checked: number; settled: number }> {
    const provider = this.providers.live;
    if (!provider) return { checked: 0, settled: 0 };
    const bounded = Math.min(Math.max(1, limit), 100);
    const now = this.now();
    const since = new Date(now.getTime() - LIVE_RECONCILE_LOOKBACK_MS);
    const invoices = await this.payments.listReconcilableLiveInvoices(since, bounded);
    let checked = 0;
    let settled = 0;
    for (const invoice of invoices) {
      const last = this.lastLiveStatusCheck.get(invoice.paymentHash) ?? 0;
      const interval =
        invoice.status === "EXPIRED" ? LIVE_EXPIRED_STATUS_CHECK_MS : LIVE_STATUS_CHECK_MS;
      if (now.getTime() - last < interval) continue;
      const attempt = await this.payments.getAttempt(invoice.paymentAttemptId);
      if (!attempt?.providerReference) continue;
      this.lastLiveStatusCheck.set(invoice.paymentHash, now.getTime());
      checked += 1;
      try {
        const status = await provider.status({
          providerReference: attempt.providerReference
        });
        if (status !== "SETTLED") continue;
        const result = await this.settleLive(invoice.paymentHash);
        if (result.status === "SETTLED") {
          this.lastLiveStatusCheck.delete(invoice.paymentHash);
          settled += 1;
        }
      } catch {
        // Keep the intent pending and retry on the next worker tick.
      }
    }
    return { checked, settled };
  }

  private async handleDuplicate(
    input: ProviderEventInput,
    proof: ProviderProof,
    client: DbClient
  ): Promise<SettlementResult> {
    const eventStatus = await this.payments.getProviderEventStatus(
      input.providerConnectionId,
      proof.providerEventId
    );
    if (eventStatus === "QUARANTINED") {
      const invoice = await this.payments.getInvoiceByHash(proof.paymentHash);
      const attempt = invoice
        ? await this.payments.getAttempt(invoice.paymentAttemptId)
        : null;
      const intent = attempt
        ? await this.payments.getIntentByIdForUpdate(attempt.paymentIntentId, client)
        : null;
      return {
        status: "QUARANTINED",
        intentId: intent?.id ?? "",
        transactionId: null,
        invoiceStatus: "QUARANTINED",
        intentStatus: intent?.status ?? "PENDING"
      } satisfies SettlementResult;
    }
    const transaction = await this.payments.getTransactionByPaymentHash(proof.paymentHash);
    if (!transaction) {
      throw new PayError("PAY_STATE_QUARANTINED", "duplicate provider event has no transaction");
    }
    const intentId = await this.payments.getIntentIdByAttemptId(transaction.paymentAttemptId);
    await this.payments.setProviderEventStatus(
      input.providerConnectionId,
      proof.providerEventId,
      "DUPLICATE",
      client
    );
    return {
      status: "DUPLICATE",
      intentId: intentId ?? "",
      transactionId: transaction.id,
      invoiceStatus: "SETTLED",
      intentStatus: "SUCCEEDED"
    } satisfies SettlementResult;
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
