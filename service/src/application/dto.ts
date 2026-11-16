import { msatToSat, msatToSatNumber } from "../domain/money.ts";
import type {
  IntentStatus,
  Invoice,
  PaymentAttempt,
  PaymentIntent,
  PaymentLink,
  Refund
} from "../domain/types.ts";

export interface CreatedPaymentIntent {
  id: string;
  status: IntentStatus;
  amount: number;
  currency: string;
  scale: number;
  external_reference: string | null;
  location_id: string | null;
  attempt_id: string;
  payment: {
    method: "lightning";
    invoice: string;
    payment_hash: string;
    expires_at: string;
  };
  expires_at: string;
  checkout_url: string;
  livemode: boolean;
  request_id: string;
}

export interface CreatedPaymentLink {
  object: "payment_link";
  id: string;
  amount: number;
  amount_msat: string;
  currency: string;
  scale: number;
  reference: string | null;
  label: string | null;
  status: PaymentLink["status"];
  url: string;
  created_at: string;
  disabled_at: string | null;
}

export interface PublicPaymentLink {
  merchantName: string;
  amount: number;
  currency: string;
  scale: number;
  reference: string | null;
  label: string | null;
  url: string;
}

export interface CreatedInvoice {
  id: string;
  payment_intent_id: string;
  payment_attempt_id: string;
  payment_hash: string;
  invoice: string;
  status: Invoice["status"];
  amount: number;
  currency: string;
  scale: number;
  expires_at: string;
  checkout_url: string;
  livemode: boolean;
  request_id: string;
}

export function createdInvoiceResponse(
  created: CreatedPaymentIntent,
  invoice: Invoice,
  requestId: string
): CreatedInvoice {
  return {
    id: invoice.id,
    payment_intent_id: created.id,
    payment_attempt_id: created.attempt_id,
    payment_hash: invoice.paymentHash,
    invoice: invoice.bolt11,
    status: invoice.status,
    amount: created.amount,
    currency: created.currency,
    scale: created.scale,
    expires_at: invoice.expiresAt,
    checkout_url: created.checkout_url,
    livemode: created.livemode,
    request_id: requestId
  };
}

export function createdIntentResponse(
  intent: PaymentIntent,
  attempt: PaymentAttempt,
  invoice: Invoice,
  requestId: string,
  checkoutUrl: string
): CreatedPaymentIntent {
  return {
    id: intent.id,
    status: "PENDING",
    amount: Number(msatToSat(intent.amountMsat)),
    currency: intent.currency,
    scale: intent.scale,
    external_reference: intent.externalReference,
    location_id: intent.locationId,
    attempt_id: attempt.id,
    payment: {
      method: "lightning",
      invoice: invoice.bolt11,
      payment_hash: invoice.paymentHash,
      expires_at: invoice.expiresAt
    },
    expires_at: invoice.expiresAt,
    checkout_url: checkoutUrl,
    livemode: intent.livemode,
    request_id: requestId
  };
}

import type { WebhookEndpoint } from "../domain/types.ts";

export interface WebhookEndpointRegistration {
  endpoint: WebhookEndpoint;
  secret: string;
}

export interface WebhookEndpointRotation extends WebhookEndpointRegistration {
  previousSecretExpiresAt: string;
}

export interface RefundResponse {
  id: string;
  object: "refund";
  transaction_id: string;
  payment_intent_id: string;
  amount: number;
  amount_msat: string;
  fee: number;
  fee_msat: string;
  net: number;
  net_msat: string;
  currency: string;
  scale: number;
  reason: string | null;
  status: Refund["status"];
  livemode: boolean;
  created_at: string;
  settled_at: string | null;
  request_id: string;
}

export function refundResponse(refund: Refund, requestId: string): RefundResponse {
  return {
    id: refund.id,
    object: "refund",
    transaction_id: refund.transactionId,
    payment_intent_id: refund.paymentIntentId,
    amount: Number(msatToSat(refund.amountMsat)),
    amount_msat: refund.amountMsat.toString(),
    fee: msatToSatNumber(refund.feeMsat),
    fee_msat: refund.feeMsat.toString(),
    net: msatToSatNumber(refund.netMsat),
    net_msat: refund.netMsat.toString(),
    currency: refund.currency,
    scale: refund.scale,
    reason: refund.reason,
    status: refund.status,
    livemode: refund.livemode,
    created_at: refund.createdAt,
    settled_at: refund.settledAt,
    request_id: requestId
  };
}
