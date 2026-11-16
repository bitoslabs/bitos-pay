export type PayErrorCode =
  | "PAY_AUTH_MISSING"
  | "PAY_AUTH_INVALID"
  | "PAY_AUTH_REVOKED"
  | "PAY_AUTH_EXPIRED"
  | "PAY_AUTH_SCOPE"
  | "PAY_VALIDATION_BODY"
  | "PAY_VALIDATION_AMOUNT"
  | "PAY_VALIDATION_CURRENCY"
  | "PAY_VALIDATION_SCALE"
  | "PAY_VALIDATION_METHOD"
  | "PAY_VALIDATION_URL"
  | "PAY_NOT_FOUND_INTENT"
  | "PAY_NOT_FOUND_INVOICE"
  | "PAY_NOT_FOUND_MERCHANT"
  | "PAY_NOT_FOUND_QUOTE"
  | "PAY_NOT_FOUND_API_KEY"
  | "PAY_NOT_FOUND_MEMBER"
  | "PAY_NOT_FOUND_LOCATION"
  | "PAY_NOT_FOUND_SETTLEMENT"
  | "PAY_NOT_FOUND_TRANSACTION"
  | "PAY_NOT_FOUND_REFUND"
  | "PAY_NOT_FOUND_PLAN"
  | "PAY_NOT_FOUND_SUBSCRIPTION"
  | "PAY_NOT_FOUND_ENTITLEMENT"
  | "PAY_NOT_FOUND_PAYMENT_LINK"
  | "PAY_REFUND_EXCEEDS"
  | "PAY_RISK_LIMIT"
  | "PAY_RISK_VELOCITY"
  | "PAY_RISK_MERCHANT_STATUS"
  | "PAY_STATE_ILLEGAL"
  | "PAY_STATE_TERMINAL"
  | "PAY_STATE_EXPIRED"
  | "PAY_STATE_QUARANTINED"
  | "PAY_IDEMPOTENCY_MISSING"
  | "PAY_IDEMPOTENCY_CONFLICT"
  | "PAY_IDEMPOTENCY_IN_PROGRESS"
  | "PAY_TENANT_SCOPE"
  | "PAY_QUOTE_REQUIRED"
  | "PAY_PROVIDER_UNAVAILABLE"
  | "PAY_PROVIDER_PROOF"
  | "PAY_RATE_LIMITED"
  | "PAY_ONBOARDING_DISABLED"
  | "PAY_SUBJECT_CONFLICT"
  | "PAY_WEBHOOK_INVALID"
  | "PAY_WEBHOOK_DEAD";

const META: Record<PayErrorCode, { status: number; type: string; message: string }> = {
  PAY_AUTH_MISSING: { status: 401, type: "PAY_AUTH_MISSING", message: "missing API key" },
  PAY_AUTH_INVALID: { status: 401, type: "PAY_AUTH_INVALID", message: "invalid API key" },
  PAY_AUTH_REVOKED: { status: 401, type: "PAY_AUTH_REVOKED", message: "API key is revoked" },
  PAY_AUTH_EXPIRED: { status: 401, type: "PAY_AUTH_EXPIRED", message: "API key has expired" },
  PAY_AUTH_SCOPE: { status: 403, type: "PAY_AUTH_SCOPE", message: "API key lacks the required scope" },
  PAY_VALIDATION_BODY: { status: 400, type: "PAY_VALIDATION_BODY", message: "invalid request body" },
  PAY_VALIDATION_AMOUNT: { status: 400, type: "PAY_VALIDATION_AMOUNT", message: "amount must be a positive integer" },
  PAY_VALIDATION_CURRENCY: { status: 400, type: "PAY_VALIDATION_CURRENCY", message: "unsupported currency" },
  PAY_VALIDATION_SCALE: { status: 400, type: "PAY_VALIDATION_SCALE", message: "invalid currency scale" },
  PAY_VALIDATION_METHOD: { status: 400, type: "PAY_VALIDATION_METHOD", message: "unsupported payment method" },
  PAY_VALIDATION_URL: { status: 400, type: "PAY_VALIDATION_URL", message: "invalid webhook URL" },
  PAY_NOT_FOUND_INTENT: { status: 404, type: "PAY_NOT_FOUND_INTENT", message: "payment intent not found" },
  PAY_NOT_FOUND_INVOICE: { status: 404, type: "PAY_NOT_FOUND_INVOICE", message: "invoice not found" },
  PAY_NOT_FOUND_MERCHANT: { status: 404, type: "PAY_NOT_FOUND_MERCHANT", message: "merchant not found" },
  PAY_NOT_FOUND_QUOTE: { status: 404, type: "PAY_NOT_FOUND_QUOTE", message: "quote not found" },
  PAY_NOT_FOUND_API_KEY: { status: 404, type: "PAY_NOT_FOUND_API_KEY", message: "API key not found" },
  PAY_NOT_FOUND_MEMBER: { status: 404, type: "PAY_NOT_FOUND_MEMBER", message: "merchant member not found" },
  PAY_NOT_FOUND_LOCATION: { status: 404, type: "PAY_NOT_FOUND_LOCATION", message: "merchant location not found" },
  PAY_NOT_FOUND_SETTLEMENT: { status: 404, type: "PAY_NOT_FOUND_SETTLEMENT", message: "settlement not found" },
  PAY_NOT_FOUND_TRANSACTION: { status: 404, type: "PAY_NOT_FOUND_TRANSACTION", message: "transaction not found" },
  PAY_NOT_FOUND_REFUND: { status: 404, type: "PAY_NOT_FOUND_REFUND", message: "refund not found" },
  PAY_NOT_FOUND_PLAN: { status: 404, type: "PAY_NOT_FOUND_PLAN", message: "plan not found" },
  PAY_NOT_FOUND_SUBSCRIPTION: { status: 404, type: "PAY_NOT_FOUND_SUBSCRIPTION", message: "subscription not found" },
  PAY_NOT_FOUND_ENTITLEMENT: { status: 404, type: "PAY_NOT_FOUND_ENTITLEMENT", message: "entitlement not found" },
  PAY_NOT_FOUND_PAYMENT_LINK: { status: 404, type: "PAY_NOT_FOUND_PAYMENT_LINK", message: "payment link not found" },
  PAY_REFUND_EXCEEDS: { status: 409, type: "PAY_REFUND_EXCEEDS", message: "refund exceeds the unrefunded amount" },
  PAY_RISK_LIMIT: { status: 403, type: "PAY_RISK_LIMIT", message: "merchant risk limit exceeded" },
  PAY_RISK_VELOCITY: { status: 429, type: "PAY_RISK_VELOCITY", message: "merchant payment velocity exceeded" },
  PAY_RISK_MERCHANT_STATUS: { status: 403, type: "PAY_RISK_MERCHANT_STATUS", message: "merchant is not active" },
  PAY_STATE_ILLEGAL: { status: 409, type: "PAY_STATE_ILLEGAL", message: "illegal state transition" },
  PAY_STATE_TERMINAL: { status: 409, type: "PAY_STATE_TERMINAL", message: "payment intent is terminal" },
  PAY_STATE_EXPIRED: { status: 409, type: "PAY_STATE_EXPIRED", message: "invoice has expired" },
  PAY_STATE_QUARANTINED: { status: 409, type: "PAY_STATE_QUARANTINED", message: "payment is quarantined for reconciliation" },
  PAY_IDEMPOTENCY_MISSING: { status: 400, type: "PAY_IDEMPOTENCY_MISSING", message: "Idempotency-Key is required" },
  PAY_IDEMPOTENCY_CONFLICT: { status: 409, type: "PAY_IDEMPOTENCY_CONFLICT", message: "idempotency key reused with a different body" },
  PAY_IDEMPOTENCY_IN_PROGRESS: { status: 409, type: "PAY_IDEMPOTENCY_IN_PROGRESS", message: "an identical request is in progress" },
  PAY_TENANT_SCOPE: { status: 403, type: "PAY_TENANT_SCOPE", message: "resource is outside the authenticated merchant" },
  PAY_QUOTE_REQUIRED: { status: 422, type: "PAY_QUOTE_REQUIRED", message: "a valid exchange quote is required for fiat pricing" },
  PAY_PROVIDER_UNAVAILABLE: { status: 503, type: "PAY_PROVIDER_UNAVAILABLE", message: "payment provider is unavailable" },
  PAY_PROVIDER_PROOF: { status: 502, type: "PAY_PROVIDER_PROOF", message: "provider proof does not match the invoice binding" },
  PAY_RATE_LIMITED: { status: 429, type: "PAY_RATE_LIMITED", message: "rate limited" },
  PAY_ONBOARDING_DISABLED: { status: 403, type: "PAY_ONBOARDING_DISABLED", message: "sandbox onboarding is disabled" },
  PAY_SUBJECT_CONFLICT: { status: 409, type: "PAY_SUBJECT_CONFLICT", message: "workspace is linked to another owner" },
  PAY_WEBHOOK_INVALID: { status: 400, type: "PAY_WEBHOOK_INVALID", message: "invalid webhook endpoint" },
  PAY_WEBHOOK_DEAD: { status: 409, type: "PAY_WEBHOOK_DEAD", message: "webhook delivery is dead" }
};

export class PayError extends Error {
  code: PayErrorCode;
  status: number;
  errorType: string;

  constructor(code: PayErrorCode, message?: string) {
    super(message ?? META[code].message);
    this.name = "PayError";
    this.code = code;
    this.status = META[code].status;
    this.errorType = META[code].type;
  }
}

export function metaFor(code: PayErrorCode): { status: number; type: string; message: string } {
  return META[code];
}
