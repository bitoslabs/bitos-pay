import { msatToSat, msatToSatNumber } from "../domain/index.ts";
import type {
  ApiKeySummary,
  BalanceLine,
  ExchangeQuote,
  Invoice,
  MerchantLocation,
  PayTransaction,
  PaymentIntent,
  PaymentLink,
  Page,
  Refund,
  PaymentIntentView,
  ProviderConnectionSummary,
  SettlementResult,
  SettlementSummary,
  WebhookDelivery,
  WebhookEndpoint
} from "../domain/types.ts";
import type { CreatedApiKey } from "../application/api-key-service.ts";
import type {
  Entitlement,
  Plan,
  Subscription
} from "../infrastructure/repositories/index.ts";
import type {
  CreatedInvoice,
  CreatedPaymentIntent,
  WebhookEndpointRegistration,
  WebhookEndpointRotation
} from "../application/dto.ts";
import { refundResponse } from "../application/dto.ts";
import type { PublicCheckout } from "../application/checkout-service.ts";
import type {
  CreatedPaymentLink,
  PublicPaymentLink
} from "../application/dto.ts";

export function presentCreatedIntent(response: CreatedPaymentIntent): CreatedPaymentIntent {
  return response;
}

export function presentCreatedInvoice(response: CreatedInvoice): CreatedInvoice {
  return response;
}

export function presentIntentView(view: PaymentIntentView, requestId: string): Record<string, unknown> {
  const { intent, attempt, invoice, transaction } = view;
  return {
    ...presentIntent(intent),
    attempt: attempt
      ? {
          id: attempt.id,
          status: attempt.status,
          provider_reference: attempt.providerReference,
          failure_code: attempt.failureCode,
          created_at: attempt.createdAt,
          updated_at: attempt.updatedAt
        }
      : null,
    invoice: invoice
      ? {
          id: invoice.id,
          payment_hash: invoice.paymentHash,
          bolt11: invoice.bolt11,
          amount_msat: invoice.amountMsat.toString(),
          amount: Number(msatToSat(invoice.amountMsat)),
          status: invoice.status,
          expires_at: invoice.expiresAt,
          settled_at: invoice.settledAt
        }
      : null,
    transaction: transaction
      ? {
          id: transaction.id,
          amount_msat: transaction.amountMsat.toString(),
          fee_msat: transaction.feeMsat.toString(),
          net_msat: transaction.netMsat.toString(),
          status: transaction.status,
          settled_at: transaction.settledAt
        }
      : null,
    request_id: requestId
  };
}

export function presentPublicCheckout(
  checkout: PublicCheckout,
  requestId: string
): Record<string, unknown> {
  return {
    object: "checkout",
    payment_id: checkout.paymentId,
    merchant: { name: checkout.merchantName },
    status: checkout.status,
    amount: checkout.amountSat,
    currency: checkout.currency,
    scale: checkout.scale,
    external_reference: checkout.reference,
    livemode: checkout.livemode,
    expires_at: checkout.expiresAt,
    invoice: checkout.invoice
      ? {
          bolt11: checkout.invoice.bolt11,
          payment_hash: checkout.invoice.paymentHash,
          status: checkout.invoice.status,
          expires_at: checkout.invoice.expiresAt,
          settled_at: checkout.invoice.settledAt
        }
      : null,
    transaction: checkout.transaction
      ? {
          id: checkout.transaction.id,
          status: checkout.transaction.status,
          settled_at: checkout.transaction.settledAt
        }
      : null,
    paid_at: checkout.paidAt,
    request_id: requestId
  };
}

export function presentIntent(intent: PaymentIntent): Record<string, unknown> {
  return {
    id: intent.id,
    status: intent.status,
    amount: Number(msatToSat(intent.amountMsat)),
    amount_msat: intent.amountMsat.toString(),
    currency: intent.currency,
    scale: intent.scale,
    external_reference: intent.externalReference,
    location_id: intent.locationId,
    livemode: intent.livemode,
    expires_at: intent.expiresAt,
    created_at: intent.createdAt,
    updated_at: intent.updatedAt,
    metadata: intent.metadata
  };
}

export function presentLocation(
  location: MerchantLocation,
  requestId: string
): Record<string, unknown> {
  return {
    id: location.id,
    object: "merchant_location",
    name: location.name,
    code: location.code,
    status: location.status,
    created_at: location.createdAt,
    updated_at: location.updatedAt,
    request_id: requestId
  };
}

export function presentLocations(
  locations: MerchantLocation[],
  requestId: string
): Record<string, unknown> {
  return {
    object: "list",
    data: locations.map((location) => presentLocation(location, requestId)),
    request_id: requestId
  };
}

export function presentPaymentLink(
  link: PaymentLink,
  url: string,
  requestId?: string
): Record<string, unknown> {
  return {
    object: "payment_link",
    id: link.id,
    amount: Number(msatToSat(link.amountMsat)),
    amount_msat: link.amountMsat.toString(),
    currency: link.currency,
    scale: link.scale,
    reference: link.reference,
    label: link.label,
    status: link.status,
    url,
    created_at: link.createdAt,
    disabled_at: link.disabledAt,
    ...(requestId ? { request_id: requestId } : {})
  };
}

export function presentPaymentLinks(
  links: PaymentLink[],
  urlFor: (linkId: string) => string,
  requestId: string
): Record<string, unknown> {
  return {
    object: "list",
    data: links.map((link) => presentPaymentLink(link, urlFor(link.id))),
    request_id: requestId
  };
}

export function presentCreatedPaymentLink(
  created: CreatedPaymentLink,
  requestId: string
): Record<string, unknown> {
  return { ...created, request_id: requestId };
}

export function presentPublicPaymentLink(
  link: PublicPaymentLink,
  requestId: string
): Record<string, unknown> {
  return {
    object: "payment_link",
    merchant: { name: link.merchantName },
    amount: link.amount,
    currency: link.currency,
    scale: link.scale,
    external_reference: link.reference,
    label: link.label,
    request_id: requestId
  };
}

export function presentProviderConnection(
  connection: ProviderConnectionSummary,
  selected: boolean
): Record<string, unknown> {
  return {
    object: "provider_connection",
    id: connection.id,
    provider: connection.provider,
    mode: connection.mode,
    status: connection.status,
    selected,
    created_at: connection.createdAt
  };
}

export function presentInvoice(invoice: Invoice, requestId: string): Record<string, unknown> {
  return {
    id: invoice.id,
    payment_attempt_id: invoice.paymentAttemptId,
    payment_hash: invoice.paymentHash,
    bolt11: invoice.bolt11,
    amount_msat: invoice.amountMsat.toString(),
    amount: Number(msatToSat(invoice.amountMsat)),
    currency: "SAT",
    scale: 0,
    status: invoice.status,
    expires_at: invoice.expiresAt,
    settled_at: invoice.settledAt,
    request_id: requestId
  };
}

export function presentTransaction(transaction: PayTransaction): Record<string, unknown> {
  return {
    id: transaction.id,
    payment_intent_attempt_id: transaction.paymentAttemptId,
    provider_reference: transaction.providerReference,
    payment_hash: transaction.paymentHash,
    amount_msat: transaction.amountMsat.toString(),
    amount: Number(msatToSat(transaction.amountMsat)),
    fee_msat: transaction.feeMsat.toString(),
    net_msat: transaction.netMsat.toString(),
    currency: transaction.currency,
    scale: transaction.scale,
    status: transaction.status,
    settled_at: transaction.settledAt,
    created_at: transaction.createdAt
  };
}

export function presentTransactions(
  transactions: PayTransaction[],
  requestId: string
): Record<string, unknown> {
  return {
    object: "list",
    ledger_derived: false,
    data: transactions.map(presentTransaction),
    request_id: requestId
  };
}

function apiKeyBody(key: ApiKeySummary): Record<string, unknown> {
  return {
    id: key.id,
    key_prefix: key.keyPrefix,
    scopes: key.scopes,
    livemode: key.livemode,
    status: key.status,
    last_used_at: key.lastUsedAt,
    created_at: key.createdAt,
    expires_at: key.expiresAt
  };
}

export function presentApiKey(
  key: ApiKeySummary,
  requestId: string
): Record<string, unknown> {
  return { ...apiKeyBody(key), request_id: requestId };
}

export function presentCreatedApiKey(
  key: CreatedApiKey,
  requestId: string
): Record<string, unknown> {
  return { ...presentApiKey(key, requestId), key: key.key };
}

export function presentApiKeys(
  keys: ApiKeySummary[],
  requestId: string
): Record<string, unknown> {
  return {
    object: "list",
    data: keys.map(apiKeyBody),
    request_id: requestId
  };
}

export function presentQuote(
  quote: ExchangeQuote & { expired?: boolean },
  requestId: string
): Record<string, unknown> {
  return {
    id: quote.id,
    base_currency: quote.baseCurrency,
    quote_currency: quote.quoteCurrency,
    base_amount: quote.baseAmount,
    quote_amount: quote.quoteAmount,
    rate: quote.rate,
    source: quote.source,
    quoted_at: quote.quotedAt,
    expires_at: quote.expiresAt,
    expired: quote.expired ?? false,
    request_id: requestId
  };
}

export function presentBalances(
  balances: BalanceLine[],
  requestId: string
): Record<string, unknown> {
  return {
    object: "list",
    ledger_derived: true,
    wallet_balance: false,
    data: balances,
    request_id: requestId
  };
}

export function presentMerchant(
  merchant: {
    id: string;
    organization_id: string;
    name: string;
    status: string;
    default_currency: string;
    support_email: string | null;
    website: string | null;
  },
  requestId: string
): Record<string, unknown> {
  return { ...merchant, request_id: requestId };
}

export function presentWebhookRegistration(
  registration: WebhookEndpointRegistration,
  requestId: string
): Record<string, unknown> {
  return {
    id: registration.endpoint.id,
    url: registration.endpoint.url,
    events: registration.endpoint.events,
    status: registration.endpoint.status,
    secret: registration.secret,
    request_id: requestId
  };
}

export function presentWebhookRotation(
  rotation: WebhookEndpointRotation,
  requestId: string
): Record<string, unknown> {
  return {
    ...presentWebhookRegistration(rotation, requestId),
    previous_secret_expires_at: rotation.previousSecretExpiresAt
  };
}

export function presentWebhookEndpoint(endpoint: WebhookEndpoint): Record<string, unknown> {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    status: endpoint.status,
    created_at: endpoint.createdAt
  };
}

export function presentWebhookDelivery(delivery: WebhookDelivery): Record<string, unknown> {
  return {
    id: delivery.id,
    endpoint_id: delivery.endpointId,
    event_id: delivery.eventId,
    event_type: delivery.eventType,
    status: delivery.status,
    attempt: delivery.attempt,
    response_code: delivery.responseCode,
    last_error: delivery.lastError,
    next_attempt_at: delivery.nextAttemptAt,
    created_at: delivery.createdAt,
    updated_at: delivery.updatedAt
  };
}

export function presentWebhookDeliveries(
  deliveries: WebhookDelivery[],
  requestId: string
): Record<string, unknown> {
  return {
    object: "list",
    data: deliveries.map(presentWebhookDelivery),
    request_id: requestId
  };
}

export function presentWebhookEndpoints(
  endpoints: WebhookEndpoint[],
  requestId: string
): Record<string, unknown> {
  return {
    object: "list",
    data: endpoints.map(presentWebhookEndpoint),
    request_id: requestId
  };
}

export function presentSettlementSummary(
  summary: SettlementSummary & { createdAt?: string },
  requestId: string
): Record<string, unknown> {
  return {
    id: summary.id,
    object: "settlement_summary",
    ledger_derived: true,
    wallet_balance: false,
    period_start: summary.periodStart,
    period_end: summary.periodEnd,
    transaction_count: summary.transactionCount,
    gross_msat: summary.grossMsat.toString(),
    gross: msatToSatNumber(summary.grossMsat),
    fees_msat: summary.feesMsat.toString(),
    fees: msatToSatNumber(summary.feesMsat),
    net_msat: summary.netMsat.toString(),
    net: msatToSatNumber(summary.netMsat),
    ledger_balanced: summary.ledgerBalanced,
    status: summary.status,
    ...(summary.createdAt ? { created_at: summary.createdAt } : {}),
    request_id: requestId
  };
}

export function presentSettlement(
  result: SettlementResult,
  requestId: string
): Record<string, unknown> {
  return { ...result, request_id: requestId };
}


export function presentRefund(refund: Refund, requestId: string): Record<string, unknown> {
  return { ...refundResponse(refund, requestId) };
}

export function presentRefunds(
  page: Page<Refund>,
  requestId: string
): Record<string, unknown> {
  const last = page.items.at(-1);
  return {
    object: "list",
    data: page.items.map((refund) => refundResponse(refund, requestId)),
    has_more: page.hasMore,
    next_cursor: page.hasMore && last ? last.id : null,
    request_id: requestId
  };
}

export function presentPlan(plan: Plan, requestId: string): Record<string, unknown> {
  return {
    object: "plan",
    code: plan.code,
    name: plan.name,
    version: plan.version,
    features: plan.features,
    limits: plan.limits,
    price_msat: plan.priceMsat.toString(),
    price: msatToSatNumber(plan.priceMsat),
    currency: plan.currency,
    status: plan.status,
    request_id: requestId
  };
}

export function presentSubscription(
  subscription: Subscription,
  requestId: string
): Record<string, unknown> {
  return {
    object: "subscription",
    id: subscription.id,
    organization_id: subscription.organizationId,
    merchant_id: subscription.merchantId,
    plan: subscription.planCode,
    status: subscription.status,
    amount_msat: subscription.amountMsat.toString(),
    amount: msatToSatNumber(subscription.amountMsat),
    currency: subscription.currency,
    expires_at: subscription.expiresAt,
    period_start: subscription.periodStart,
    period_end: subscription.periodEnd,
    paid_at: subscription.paidAt,
    created_at: subscription.createdAt,
    request_id: requestId
  };
}

export function presentSubscriptionInvoice(
  result: {
    subscription: Subscription;
    invoice: {
      provider_reference: string;
      payment_hash: string;
      bolt11: string;
      amount_msat: bigint;
      expires_at: string;
    };
  },
  requestId: string
): Record<string, unknown> {
  return {
    ...presentSubscription(result.subscription, requestId),
    invoice: {
      provider_reference: result.invoice.provider_reference,
      payment_hash: result.invoice.payment_hash,
      bolt11: result.invoice.bolt11,
      amount_msat: result.invoice.amount_msat.toString(),
      amount: msatToSatNumber(result.invoice.amount_msat),
      expires_at: result.invoice.expires_at
    }
  };
}

export function presentEntitlement(
  entitlement: Entitlement,
  requestId: string
): Record<string, unknown> {
  return {
    object: "entitlement",
    id: entitlement.id,
    organization_id: entitlement.organizationId,
    subscription_id: entitlement.subscriptionId,
    plan: entitlement.planCode,
    features: entitlement.features,
    limits: entitlement.limits,
    status: entitlement.status,
    valid_from: entitlement.validFrom,
    valid_until: entitlement.validUntil,
    revision: entitlement.revision,
    source: entitlement.revision === 0 ? "default_free" : "subscription",
    request_id: requestId
  };
}
