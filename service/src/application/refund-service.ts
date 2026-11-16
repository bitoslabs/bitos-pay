import { PayError, assertAmount, newId, refundLedgerLines, requestDigest, satToMsat } from "../domain/index.ts";
import type { AuthContext, Page, Refund, RefundListOptions } from "../domain/types.ts";
import type {
  AuditRepository,
  LedgerRepository,
  PaymentRepository,
  RefundRepository
} from "../infrastructure/repositories/index.ts";
import { type RefundResponse, refundResponse } from "./dto.ts";
import type { AuthService } from "./auth-service.ts";
import type { EventPublisher } from "./event-publisher.ts";
import { API_VERSION } from "../domain/constants.ts";

export interface CreateRefundInput {
  transaction_id: string;
  amount: number;
  reason?: string | null;
}

export class RefundService {
  private readonly payments: PaymentRepository;
  private readonly refunds: RefundRepository;
  private readonly ledger: LedgerRepository;
  private readonly audit: AuditRepository;
  private readonly events: EventPublisher;
  private readonly auth: AuthService;
  private readonly now: () => Date;

  constructor(
    payments: PaymentRepository,
    refunds: RefundRepository,
    ledger: LedgerRepository,
    audit: AuditRepository,
    events: EventPublisher,
    auth: AuthService,
    now: () => Date = () => new Date()
  ) {
    this.payments = payments;
    this.refunds = refunds;
    this.ledger = ledger;
    this.audit = audit;
    this.events = events;
    this.auth = auth;
    this.now = now;
  }

  async createRefund(
    auth: AuthContext,
    input: CreateRefundInput,
    idempotencyKey: string | undefined,
    requestId: string
  ): Promise<RefundResponse> {
    this.auth.requireScope(auth, "payments:refund");
    if (auth.livemode) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live refunds are not implemented");
    }
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new PayError("PAY_IDEMPOTENCY_MISSING");
    }
    if (typeof input.transaction_id !== "string" || !input.transaction_id) {
      throw new PayError("PAY_VALIDATION_BODY", "transaction_id is required");
    }
    if (input.reason !== undefined && input.reason !== null) {
      if (typeof input.reason !== "string" || input.reason.length > 200) {
        throw new PayError(
          "PAY_VALIDATION_BODY",
          "reason must be a string of at most 200 characters"
        );
      }
    }
    const amountSat = assertAmount(input.amount);
    const reason = input.reason?.trim() || null;
    const digest = requestDigest({
      transaction_id: input.transaction_id,
      amount: input.amount,
      reason
    });
    const now = this.now();

    return this.payments.db.transaction(async (client) => {
      const reserved = await this.payments.reserveIdempotency(
        {
          merchantId: auth.merchantId,
          endpoint: "POST /v1/refunds",
          key: idempotencyKey,
          requestDigest: digest,
          now
        },
        client
      );
      if (!reserved) {
        const existing = await this.payments.findIdempotency(
          auth.merchantId,
          "POST /v1/refunds",
          idempotencyKey,
          client
        );
        if (!existing) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        if (existing.requestDigest !== digest) throw new PayError("PAY_IDEMPOTENCY_CONFLICT");
        if (existing.status !== 1) throw new PayError("PAY_IDEMPOTENCY_IN_PROGRESS");
        return existing.response as RefundResponse;
      }

      const transaction = await this.payments.getTransactionForUpdateById(
        auth.merchantId,
        input.transaction_id,
        client
      );
      if (!transaction) throw new PayError("PAY_NOT_FOUND_TRANSACTION");
      if (transaction.status !== "SETTLED") {
        throw new PayError("PAY_STATE_ILLEGAL", "only a settled transaction can be refunded");
      }
      const refundedBefore = await this.refunds.sumSucceededForTransaction(
        auth.merchantId,
        transaction.id,
        client
      );
      const amountMsat = satToMsat(amountSat);
      if (refundedBefore + amountMsat > transaction.amountMsat) {
        throw new PayError("PAY_REFUND_EXCEEDS");
      }
      const split = refundLedgerLines({
        originalAmountMsat: transaction.amountMsat,
        originalFeeMsat: transaction.feeMsat,
        refundedBeforeMsat: refundedBefore,
        refundAmountMsat: amountMsat
      });
      const paymentIntentId = await this.payments.getIntentIdByAttemptId(
        transaction.paymentAttemptId,
        client
      );
      if (!paymentIntentId) throw new PayError("PAY_NOT_FOUND_INTENT");

      const refundId = newId("rfd");
      const refund: Refund = {
        id: refundId,
        organizationId: auth.organizationId,
        merchantId: auth.merchantId,
        transactionId: transaction.id,
        paymentIntentId,
        amountMsat,
        feeMsat: split.feeMsat,
        netMsat: split.netMsat,
        currency: transaction.currency,
        scale: transaction.scale,
        reason,
        status: "SUCCEEDED",
        livemode: auth.livemode,
        createdAt: now.toISOString(),
        settledAt: now.toISOString()
      };
      await this.refunds.create(
        {
          id: refund.id,
          organizationId: refund.organizationId,
          merchantId: refund.merchantId,
          transactionId: refund.transactionId,
          paymentIntentId: refund.paymentIntentId,
          amountMsat: refund.amountMsat,
          feeMsat: refund.feeMsat,
          netMsat: refund.netMsat,
          currency: refund.currency,
          scale: refund.scale,
          reason: refund.reason,
          status: refund.status,
          livemode: refund.livemode,
          createdAt: now,
          settledAt: now
        },
        client
      );
      for (const line of split.lines) {
        const accountId = await this.ledger.ensureAccount(
          {
            id: newId("acct"),
            organizationId: auth.organizationId,
            code: line.accountCode,
            type: line.accountType,
            currency: transaction.currency,
            scale: transaction.scale,
            now
          },
          client
        );
        await this.ledger.insertEntry(
          {
            id: newId("le"),
            organizationId: auth.organizationId,
            transactionId: transaction.id,
            accountId,
            direction: line.direction,
            amountMsat: line.amountMsat,
            currency: transaction.currency,
            scale: transaction.scale,
            refundId,
            now
          },
          client
        );
      }
      const ledger = await this.ledger.transactionBalance(
        auth.organizationId,
        transaction.id,
        client
      );
      if (ledger.debit !== ledger.credit) {
        throw new PayError("PAY_STATE_ILLEGAL", "refund ledger entry set is not balanced");
      }

      const event = {
        id: newId("evt"),
        type: "refund.succeeded",
        api_version: API_VERSION,
        created_at: now.toISOString(),
        livemode: auth.livemode,
        merchant_id: auth.merchantId,
        data: {
          refund_id: refund.id,
          transaction_id: transaction.id,
          payment_intent_id: paymentIntentId,
          amount_msat: amountMsat.toString(),
          fee_msat: split.feeMsat.toString(),
          net_msat: split.netMsat.toString(),
          currency: transaction.currency,
          scale: transaction.scale,
          reason
        }
      };
      await this.events.publish(event, auth.organizationId, client);
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "refund.create",
          targetRef: refund.id,
          result: "ACCEPTED",
          now
        },
        client
      );
      const response = refundResponse(refund, requestId);
      await this.payments.completeIdempotency(
        {
          merchantId: auth.merchantId,
          endpoint: "POST /v1/refunds",
          key: idempotencyKey,
          response
        },
        client
      );
      return response;
    });
  }

  async listForIntent(auth: AuthContext, paymentIntentId: string, limit = 50): Promise<Refund[]> {
    this.auth.requireScope(auth, "payments:read");
    return this.refunds.listForIntent(auth.merchantId, paymentIntentId, limit);
  }

  async getRefund(auth: AuthContext, refundId: string): Promise<Refund> {
    this.auth.requireScope(auth, "payments:read");
    const refund = await this.refunds.get(auth.merchantId, refundId);
    if (!refund) throw new PayError("PAY_NOT_FOUND_REFUND");
    return refund;
  }

  async listRefunds(auth: AuthContext, options: RefundListOptions): Promise<Page<Refund>> {
    this.auth.requireScope(auth, "payments:read");
    return this.refunds.list(auth.merchantId, options);
  }
}
