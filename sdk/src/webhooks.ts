import { createHmac, timingSafeEqual } from "node:crypto";
import { BitOSPayWebhookError } from "./errors.ts";
import type { WebhookEvent } from "./types.ts";

export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export interface VerifyWebhookOptions {
  rawBody: string;
  headers: WebhookHeaders;
  secret: string;
  previousSecret?: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function signature(secret: string, timestamp: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")}`;
}

export function verifyWebhookSignature(options: VerifyWebhookOptions): true {
  if (!options.secret) throw new BitOSPayWebhookError("missing_secret", "webhook secret is required");
  const timestampHeader = header(options.headers, "bitos-pay-timestamp");
  const supplied = header(options.headers, "bitos-pay-signature");
  const previousSupplied = header(options.headers, "bitos-pay-signature-previous");
  if (!timestampHeader) {
    throw new BitOSPayWebhookError("missing_timestamp", "missing BitOS-Pay-Timestamp header");
  }
  if (!supplied) {
    throw new BitOSPayWebhookError("missing_signature", "missing BitOS-Pay-Signature header");
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp)) {
    throw new BitOSPayWebhookError("invalid_timestamp", "BitOS-Pay-Timestamp must be an integer");
  }
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? 300;
  if (!Number.isInteger(tolerance) || tolerance < 1) {
    throw new BitOSPayWebhookError("invalid_tolerance", "toleranceSeconds must be a positive integer");
  }
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    throw new BitOSPayWebhookError("stale_timestamp", "webhook timestamp is outside the allowed window");
  }

  const secrets = [options.secret, options.previousSecret].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  const suppliedSignatures = [supplied, previousSupplied].filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  const valid = secrets.some((candidateSecret) => {
    const expected = Buffer.from(signature(candidateSecret, timestamp, options.rawBody), "utf8");
    return suppliedSignatures.some((candidate) => {
      const actual = Buffer.from(candidate, "utf8");
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
  });
  if (!valid) {
    throw new BitOSPayWebhookError("invalid_signature", "webhook signature does not match the raw body");
  }
  return true;
}

export function constructWebhookEvent<T = Record<string, unknown>>(
  options: VerifyWebhookOptions
): WebhookEvent<T> {
  verifyWebhookSignature(options);
  let event: unknown;
  try {
    event = JSON.parse(options.rawBody);
  } catch {
    throw new BitOSPayWebhookError("invalid_json", "webhook body is not valid JSON");
  }
  if (!event || typeof event !== "object") {
    throw new BitOSPayWebhookError("invalid_event", "webhook body must be a JSON object");
  }
  const value = event as Partial<WebhookEvent<T>>;
  if (
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.api_version !== "string" ||
    typeof value.created_at !== "string" ||
    typeof value.livemode !== "boolean" ||
    typeof value.merchant_id !== "string" ||
    !value.data ||
    typeof value.data !== "object"
  ) {
    throw new BitOSPayWebhookError("invalid_event", "webhook envelope is missing required fields");
  }
  const eventId = header(options.headers, "bitos-pay-event-id");
  if (eventId && eventId !== value.id) {
    throw new BitOSPayWebhookError("event_mismatch", "webhook event id header does not match the body");
  }
  return value as WebhookEvent<T>;
}
