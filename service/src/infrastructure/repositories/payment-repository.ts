import type { DbClient } from "../db/database.ts";
import type {
  AttemptStatus,
  IntentStatus,
  Invoice,
  InvoiceStatus,
  PayTransaction,
  PaymentAttempt,
  PaymentIntent,
  PaymentIntentView,
  PaymentListOptions,
  Page,
  TransactionListOptions
} from "../../domain/types.ts";
import { BaseRepository } from "./base-repository.ts";
import {
  mapAttempt,
  mapIntent,
  mapInvoice,
  mapTransaction,
  type AttemptRow,
  type IntentRow,
  type InvoiceRow,
  type TransactionRow
} from "./rows.ts";

export interface DueIntentRow {
  intent_id: string;
  attempt_id: string;
  invoice_id: string;
  organization_id: string;
  merchant_id: string;
  livemode: boolean;
}

export interface ProviderEventStatus {
  status: "ACCEPTED" | "DUPLICATE" | "QUARANTINED" | "REJECTED";
}

export class PaymentRepository extends BaseRepository {
  async exportPayments(
    merchantId: string,
    options: {
      from: Date | null;
      to: Date | null;
      status: string | null;
      locationId: string | null;
      limit: number;
    }
  ): Promise<PaymentIntent[]> {
    const result = await this.db.query<IntentRow>(
      `SELECT * FROM ${this.t("payment_intents")}
        WHERE merchant_id = $1
          AND ($2::timestamptz IS NULL OR created_at >= $2)
          AND ($3::timestamptz IS NULL OR created_at < $3)
          AND ($4::text IS NULL OR status = $4)
          AND ($5::text IS NULL OR location_id = $5)
        ORDER BY created_at DESC, id DESC
        LIMIT $6`,
      [
        merchantId,
        options.from?.toISOString() ?? null,
        options.to?.toISOString() ?? null,
        options.status,
        options.locationId,
        options.limit
      ]
    );
    return result.rows.map(mapIntent);
  }

  async createIntent(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      providerConnectionId: string;
      externalReference: string | null;
      locationId: string | null;
      amountMsat: bigint;
      currency: string;
      scale: number;
      livemode: boolean;
      expiresAt: Date;
      metadata: Record<string, unknown>;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("payment_intents")}
        (id, organization_id, merchant_id, provider_connection_id, external_reference,
         location_id, amount_msat, currency, scale, status, retry_of_intent_id, livemode,
         expires_at, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CREATED',NULL,$10,$11,$12::jsonb,$13,$13)`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.providerConnectionId,
        input.externalReference,
        input.locationId,
        input.amountMsat.toString(),
        input.currency,
        input.scale,
        input.livemode,
        input.expiresAt.toISOString(),
        JSON.stringify(input.metadata),
        input.now.toISOString()
      ]
    );
  }

  async createAttempt(
    input: { id: string; intentId: string; providerConnectionId: string; now: Date },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("payment_attempts")}
        (id, payment_intent_id, provider_connection_id, provider_reference, status, failure_code, created_at, updated_at)
       VALUES ($1,$2,$3,NULL,'CREATED',NULL,$4,$4)`,
      [input.id, input.intentId, input.providerConnectionId, input.now.toISOString()]
    );
  }

  async bindInvoice(
    input: {
      id: string;
      attemptId: string;
      providerReference: string;
      paymentHash: string;
      bolt11: string;
      amountMsat: bigint;
      expiresAt: Date;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("invoices")}
        (id, payment_attempt_id, payment_hash, bolt11, amount_msat, status, expires_at, created_at, settled_at)
       VALUES ($1,$2,$3,$4,$5,'ISSUED',$6,$7,NULL)`,
      [
        input.id,
        input.attemptId,
        input.paymentHash,
        input.bolt11,
        input.amountMsat.toString(),
        input.expiresAt.toISOString(),
        input.now.toISOString()
      ]
    );
    await client.query(
      `UPDATE ${this.t("payment_attempts")}
          SET provider_reference = $2, status = 'INVOICE_ISSUED', updated_at = $3
        WHERE id = $1`,
      [input.attemptId, input.providerReference, input.now.toISOString()]
    );
  }

  async activateIntent(
    intentId: string,
    attemptId: string,
    now: Date,
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.t("payment_intents")} SET status = 'PENDING', updated_at = $2 WHERE id = $1`,
      [intentId, now.toISOString()]
    );
    await client.query(
      `UPDATE ${this.t("payment_attempts")} SET status = 'PENDING', updated_at = $2 WHERE id = $1`,
      [attemptId, now.toISOString()]
    );
  }

  async findIdempotency(
    merchantId: string,
    endpoint: string,
    key: string,
    client: DbClient = this.db
  ): Promise<{ requestDigest: string; status: number; response: unknown } | null> {
    const result = await client.query<{
      request_digest: string;
      status: number;
      response_json: unknown;
    }>(
      `SELECT request_digest, status, response_json FROM ${this.t("idempotency_keys")}
        WHERE merchant_id = $1 AND endpoint = $2 AND key = $3
        FOR UPDATE`,
      [merchantId, endpoint, key]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      requestDigest: row.request_digest,
      status: Number(row.status),
      response: row.response_json
    };
  }

  async reserveIdempotency(
    input: {
      merchantId: string;
      endpoint: string;
      key: string;
      requestDigest: string;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO ${this.t("idempotency_keys")}
        (merchant_id, endpoint, key, request_digest, status, response_json, created_at)
       VALUES ($1,$2,$3,$4,0,'{}'::jsonb,$5)
       ON CONFLICT (merchant_id, endpoint, key) DO NOTHING
       RETURNING key`,
      [input.merchantId, input.endpoint, input.key, input.requestDigest, input.now.toISOString()]
    );
    return result.rows.length > 0;
  }

  async completeIdempotency(
    input: { merchantId: string; endpoint: string; key: string; response: unknown },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.t("idempotency_keys")}
          SET status = 1, response_json = $4::jsonb
        WHERE merchant_id = $1 AND endpoint = $2 AND key = $3`,
      [input.merchantId, input.endpoint, input.key, JSON.stringify(input.response)]
    );
  }

  async getIntent(
    merchantId: string,
    intentId: string,
    client: DbClient = this.db,
    forUpdate = false
  ): Promise<PaymentIntent | null> {
    const result = await client.query<IntentRow>(
      `SELECT * FROM ${this.t("payment_intents")}
        WHERE id = $1 AND merchant_id = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [intentId, merchantId]
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async getIntentByIdForUpdate(intentId: string, client: DbClient): Promise<PaymentIntent | null> {
    const result = await client.query<IntentRow>(
      `SELECT * FROM ${this.t("payment_intents")} WHERE id = $1 FOR UPDATE`,
      [intentId]
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async getIntentById(intentId: string): Promise<PaymentIntent | null> {
    const result = await this.db.query<IntentRow>(
      `SELECT * FROM ${this.t("payment_intents")} WHERE id = $1`,
      [intentId]
    );
    return result.rows[0] ? mapIntent(result.rows[0]) : null;
  }

  async getIntentViewById(intentId: string): Promise<PaymentIntentView | null> {
    const intent = await this.getIntentById(intentId);
    if (!intent) return null;
    const attempt = await this.getLatestAttempt(intentId);
    const invoice = attempt ? await this.getInvoiceByAttemptId(attempt.id) : null;
    const transaction = attempt ? await this.getTransactionByAttemptId(attempt.id) : null;
    return { intent, attempt, invoice, transaction };
  }

  async getIntentView(merchantId: string, intentId: string): Promise<PaymentIntentView | null> {
    return this.getIntentViewWithClient(merchantId, intentId, this.db);
  }

  async getIntentViewWithClient(
    merchantId: string,
    intentId: string,
    client: DbClient
  ): Promise<PaymentIntentView | null> {
    const intent = await this.getIntent(merchantId, intentId, client);
    if (!intent) return null;
    const attempt = await this.getLatestAttempt(intentId, client);
    const invoice = attempt ? await this.getInvoiceByAttemptId(attempt.id, client) : null;
    const transaction = attempt ? await this.getTransactionByAttemptId(attempt.id, client) : null;
    return { intent, attempt, invoice, transaction };
  }

  async getLatestAttempt(
    intentId: string,
    client: DbClient = this.db
  ): Promise<PaymentAttempt | null> {
    const result = await client.query<AttemptRow>(
      `SELECT * FROM ${this.t("payment_attempts")}
        WHERE payment_intent_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [intentId]
    );
    return result.rows[0] ? mapAttempt(result.rows[0]) : null;
  }

  async getInvoiceByAttemptId(
    attemptId: string,
    client: DbClient = this.db
  ): Promise<Invoice | null> {
    const result = await client.query<InvoiceRow>(
      `SELECT * FROM ${this.t("invoices")} WHERE payment_attempt_id = $1`,
      [attemptId]
    );
    return result.rows[0] ? mapInvoice(result.rows[0]) : null;
  }

  async getInvoiceById(merchantId: string, invoiceId: string): Promise<Invoice | null> {
    const result = await this.db.query<InvoiceRow>(
      `SELECT inv.*
         FROM ${this.t("invoices")} inv
         JOIN ${this.t("payment_attempts")} a ON a.id = inv.payment_attempt_id
         JOIN ${this.t("payment_intents")} i ON i.id = a.payment_intent_id
        WHERE inv.id = $1 AND i.merchant_id = $2`,
      [invoiceId, merchantId]
    );
    return result.rows[0] ? mapInvoice(result.rows[0]) : null;
  }

  async getInvoiceForUpdateByHash(
    paymentHash: string,
    client: DbClient
  ): Promise<Invoice | null> {
    const result = await client.query<InvoiceRow>(
      `SELECT * FROM ${this.t("invoices")} WHERE payment_hash = $1 FOR UPDATE`,
      [paymentHash]
    );
    return result.rows[0] ? mapInvoice(result.rows[0]) : null;
  }

  async getInvoiceByHashForMerchant(
    merchantId: string,
    paymentHash: string
  ): Promise<Invoice | null> {
    const result = await this.db.query<InvoiceRow>(
      `SELECT inv.*
         FROM ${this.t("invoices")} inv
         JOIN ${this.t("payment_attempts")} a ON a.id = inv.payment_attempt_id
         JOIN ${this.t("payment_intents")} i ON i.id = a.payment_intent_id
        WHERE inv.payment_hash = $1 AND i.merchant_id = $2`,
      [paymentHash, merchantId]
    );
    return result.rows[0] ? mapInvoice(result.rows[0]) : null;
  }

  async getInvoiceByHash(paymentHash: string): Promise<Invoice | null> {
    const result = await this.db.query<InvoiceRow>(
      `SELECT * FROM ${this.t("invoices")} WHERE payment_hash = $1`,
      [paymentHash]
    );
    return result.rows[0] ? mapInvoice(result.rows[0]) : null;
  }

  async listReconcilableLiveInvoices(since: Date, limit: number): Promise<Invoice[]> {
    const result = await this.db.query<InvoiceRow>(
      `SELECT inv.*
         FROM ${this.t("invoices")} inv
         JOIN ${this.t("payment_attempts")} a ON a.id = inv.payment_attempt_id
         JOIN ${this.t("payment_intents")} i ON i.id = a.payment_intent_id
        WHERE inv.status IN ('ISSUED', 'EXPIRED') AND i.livemode = TRUE
          AND inv.expires_at > $1
        ORDER BY inv.created_at ASC
        LIMIT $2`,
      [since.toISOString(), limit]
    );
    return result.rows.map(mapInvoice);
  }

  async getAttempt(
    attemptId: string,
    client: DbClient = this.db
  ): Promise<PaymentAttempt | null> {
    const result = await client.query<AttemptRow>(
      `SELECT * FROM ${this.t("payment_attempts")} WHERE id = $1`,
      [attemptId]
    );
    return result.rows[0] ? mapAttempt(result.rows[0]) : null;
  }

  async setIntentStatus(
    intentId: string,
    status: IntentStatus,
    now: Date,
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.t("payment_intents")} SET status = $2, updated_at = $3 WHERE id = $1`,
      [intentId, status, now.toISOString()]
    );
  }

  async setAttemptStatus(
    attemptId: string,
    status: AttemptStatus,
    failureCode: string | null,
    now: Date,
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.t("payment_attempts")}
          SET status = $2, failure_code = $3, updated_at = $4
        WHERE id = $1`,
      [attemptId, status, failureCode, now.toISOString()]
    );
  }

  async setInvoiceStatus(
    invoiceId: string,
    status: InvoiceStatus,
    settledAt: Date | null,
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.t("invoices")} SET status = $2, settled_at = $3 WHERE id = $1`,
      [invoiceId, status, settledAt ? settledAt.toISOString() : null]
    );
  }

  async insertProviderEvent(
    input: {
      id: string;
      providerConnectionId: string;
      providerEventId: string;
      paymentHash: string;
      status: "ACCEPTED" | "DUPLICATE" | "QUARANTINED" | "REJECTED";
      payload: Record<string, unknown>;
      now: Date;
    },
    client: DbClient
  ): Promise<boolean> {
    const result = await client.query(
      `INSERT INTO ${this.t("provider_events")}
        (id, provider_connection_id, provider_event_id, payment_hash, status, payload, received_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (provider_connection_id, provider_event_id) DO NOTHING
       RETURNING id`,
      [
        input.id,
        input.providerConnectionId,
        input.providerEventId,
        input.paymentHash,
        input.status,
        JSON.stringify(input.payload),
        input.now.toISOString()
      ]
    );
    return result.rows.length > 0;
  }

  async setProviderEventStatus(
    providerConnectionId: string,
    providerEventId: string,
    status: "ACCEPTED" | "DUPLICATE" | "QUARANTINED" | "REJECTED",
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `UPDATE ${this.t("provider_events")} SET status = $3
        WHERE provider_connection_id = $1 AND provider_event_id = $2`,
      [providerConnectionId, providerEventId, status]
    );
  }

  async getProviderEventStatus(
    providerConnectionId: string,
    providerEventId: string
  ): Promise<"ACCEPTED" | "DUPLICATE" | "QUARANTINED" | "REJECTED" | null> {
    const result = await this.db.query<ProviderEventStatus>(
      `SELECT status FROM ${this.t("provider_events")}
        WHERE provider_connection_id = $1 AND provider_event_id = $2`,
      [providerConnectionId, providerEventId]
    );
    return result.rows[0]?.status ?? null;
  }

  async createTransaction(
    input: {
      id: string;
      organizationId: string;
      merchantId: string;
      attemptId: string;
      providerConnectionId: string;
      providerReference: string;
      paymentHash: string;
      amountMsat: bigint;
      feeMsat: bigint;
      netMsat: bigint;
      currency: string;
      scale: number;
      now: Date;
    },
    client: DbClient
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("transactions")}
        (id, organization_id, merchant_id, payment_attempt_id, provider_connection_id,
         provider_reference, payment_hash, amount_msat, fee_msat, net_msat, currency, scale,
         status, settled_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'SETTLED',$13,$13)`,
      [
        input.id,
        input.organizationId,
        input.merchantId,
        input.attemptId,
        input.providerConnectionId,
        input.providerReference,
        input.paymentHash,
        input.amountMsat.toString(),
        input.feeMsat.toString(),
        input.netMsat.toString(),
        input.currency,
        input.scale,
        input.now.toISOString()
      ]
    );
  }

  async insertFee(
    input: {
      id: string;
      transactionId: string;
      ruleRef: string;
      basis: string;
      amountMsat: bigint;
      currency: string;
      scale: number;
      now: Date;
    },
    client: DbClient
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("fees")}
        (id, transaction_id, rule_ref, basis, amount_msat, currency, scale, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.id,
        input.transactionId,
        input.ruleRef,
        input.basis,
        input.amountMsat.toString(),
        input.currency,
        input.scale,
        input.now.toISOString()
      ]
    );
  }

  async getTransactionByAttemptId(
    attemptId: string,
    client: DbClient = this.db
  ): Promise<PayTransaction | null> {
    const result = await client.query<TransactionRow>(
      `SELECT * FROM ${this.t("transactions")} WHERE payment_attempt_id = $1`,
      [attemptId]
    );
    return result.rows[0] ? mapTransaction(result.rows[0]) : null;
  }

  async getTransactionByPaymentHash(paymentHash: string): Promise<PayTransaction | null> {
    const result = await this.db.query<TransactionRow>(
      `SELECT * FROM ${this.t("transactions")} WHERE payment_hash = $1`,
      [paymentHash]
    );
    return result.rows[0] ? mapTransaction(result.rows[0]) : null;
  }

  async getTransactionForUpdateById(
    merchantId: string,
    transactionId: string,
    client: DbClient
  ): Promise<PayTransaction | null> {
    const result = await client.query<TransactionRow>(
      `SELECT * FROM ${this.t("transactions")}
        WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [transactionId, merchantId]
    );
    return result.rows[0] ? mapTransaction(result.rows[0]) : null;
  }

  async riskUsage(
    merchantId: string,
    minuteSince: Date,
    daySince: Date,
    client: DbClient
  ): Promise<{ minuteCount: number; dayVolumeMsat: bigint }> {
    const result = await client.query<{ minute_count: number | string; day_volume_msat: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= $2) AS minute_count,
         COALESCE(SUM(amount_msat) FILTER (WHERE created_at >= $3), 0) AS day_volume_msat
         FROM ${this.t("payment_intents")}
        WHERE merchant_id = $1`,
      [merchantId, minuteSince.toISOString(), daySince.toISOString()]
    );
    const row = result.rows[0];
    return {
      minuteCount: Number(row?.minute_count ?? 0),
      dayVolumeMsat: BigInt(row?.day_volume_msat ?? 0)
    };
  }

  async getIntentIdByAttemptId(
    attemptId: string,
    client: DbClient = this.db
  ): Promise<string | null> {
    const result = await client.query<{ payment_intent_id: string }>(
      `SELECT payment_intent_id FROM ${this.t("payment_attempts")} WHERE id = $1`,
      [attemptId]
    );
    return result.rows[0]?.payment_intent_id ?? null;
  }

  async listPayments(
    merchantId: string,
    options: PaymentListOptions
  ): Promise<Page<PaymentIntent>> {
    const params: unknown[] = [merchantId];
    let where = "i.merchant_id = $1";
    if (options.status) {
      params.push(options.status);
      where += ` AND i.status = $${params.length}`;
    }
    if (options.startingAfter) {
      params.push(options.startingAfter);
      where += ` AND (i.created_at, i.id) < (
        SELECT created_at, id FROM ${this.t("payment_intents")}
         WHERE id = $${params.length} AND merchant_id = $1
      )`;
    }
    params.push(options.limit + 1);
    const result = await this.db.query<IntentRow>(
      `SELECT i.* FROM ${this.t("payment_intents")} i
        WHERE ${where}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $${params.length}`,
      params
    );
    return {
      items: result.rows.slice(0, options.limit).map(mapIntent),
      hasMore: result.rows.length > options.limit
    };
  }

  async listTransactions(
    merchantId: string,
    options: TransactionListOptions
  ): Promise<Page<PayTransaction>> {
    const params: unknown[] = [merchantId];
    let where = "t.merchant_id = $1";
    if (options.status) {
      params.push(options.status);
      where += ` AND t.status = $${params.length}`;
    }
    if (options.startingAfter) {
      params.push(options.startingAfter);
      where += ` AND (t.created_at, t.id) < (
        SELECT created_at, id FROM ${this.t("transactions")}
         WHERE id = $${params.length} AND merchant_id = $1
      )`;
    }
    params.push(options.limit + 1);
    const result = await this.db.query<TransactionRow>(
      `SELECT t.* FROM ${this.t("transactions")} t
        WHERE ${where}
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT $${params.length}`,
      params
    );
    return {
      items: result.rows.slice(0, options.limit).map(mapTransaction),
      hasMore: result.rows.length > options.limit
    };
  }

  async findDueIntents(now: Date, client: DbClient): Promise<DueIntentRow[]> {
    const result = await client.query<DueIntentRow>(
      `SELECT i.id AS intent_id, a.id AS attempt_id, inv.id AS invoice_id,
              i.organization_id, i.merchant_id, i.livemode
         FROM ${this.t("payment_intents")} i
         JOIN ${this.t("payment_attempts")} a ON a.payment_intent_id = i.id
         JOIN ${this.t("invoices")} inv ON inv.payment_attempt_id = a.id
        WHERE i.status IN ('CREATED', 'PENDING') AND i.expires_at <= $1
          AND inv.status = 'ISSUED'
        FOR UPDATE OF i`,
      [now.toISOString()]
    );
    return result.rows;
  }

  async countQuarantinedAttempts(merchantId: string): Promise<number> {
    const result = await this.db.query<{ total: number | string }>(
      `SELECT COUNT(*) AS total
         FROM ${this.t("payment_attempts")} a
         JOIN ${this.t("payment_intents")} i ON i.id = a.payment_intent_id
        WHERE i.merchant_id = $1 AND a.status = 'QUARANTINED'`,
      [merchantId]
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}
