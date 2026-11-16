import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  BitOSPayWebhookError,
  constructWebhookEvent,
  verifyWebhookSignature
} from "../src/index.ts";

const secret = "whsec_test_secret";
const rawBody = JSON.stringify({
  id: "evt_1",
  type: "payment.succeeded",
  api_version: "2026-11-01",
  created_at: "2026-11-13T09:50:00.000Z",
  livemode: false,
  merchant_id: "mer_1",
  data: { payment_intent_id: "pi_1", amount_msat: "1000000" }
});
const now = 1_800_000_000;
const timestamp = now - 5;

function signature(body = rawBody, at = timestamp): string {
  return `v1=${createHmac("sha256", secret).update(`${at}.${body}`, "utf8").digest("hex")}`;
}

function headers(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "bitos-pay-timestamp": String(timestamp),
    "bitos-pay-signature": signature(),
    "bitos-pay-event-id": "evt_1",
    ...overrides
  };
}

describe("webhook verification", () => {
  it("constructs a verified event from the exact raw body", () => {
    const event = constructWebhookEvent<{ payment_intent_id: string }>({
      rawBody,
      headers: headers(),
      secret,
      nowSeconds: now
    });
    assert.equal(event.id, "evt_1");
    assert.equal(event.type, "payment.succeeded");
    assert.equal(event.data.payment_intent_id, "pi_1");
    assert.equal(
      verifyWebhookSignature({ rawBody, headers: headers(), secret, nowSeconds: now }),
      true
    );
  });

  it("verifies the previous signature during a secret rotation", () => {
    const previous = "whsec_previous_secret";
    const previousSignature = `v1=${createHmac("sha256", previous)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex")}`;
    assert.equal(
      verifyWebhookSignature({
        rawBody,
        headers: headers({
          "bitos-pay-signature": previousSignature,
          "bitos-pay-signature-previous": signature()
        }),
        secret,
        previousSecret: previous,
        nowSeconds: now
      }),
      true
    );
  });

  it("accepts Headers objects with case-insensitive names", () => {
    const event = constructWebhookEvent({
      rawBody,
      headers: new Headers(headers()),
      secret,
      nowSeconds: now
    });
    assert.equal(event.id, "evt_1");
  });

  it("rejects a tampered body", () => {
    assert.throws(
      () =>
        verifyWebhookSignature({
          rawBody: rawBody.replace("1000000", "2000000"),
          headers: headers(),
          secret,
          nowSeconds: now
        }),
      (error: unknown) =>
        error instanceof BitOSPayWebhookError && error.reason === "invalid_signature"
    );
  });

  it("rejects a stale timestamp and a missing signature", () => {
    assert.throws(
      () =>
        verifyWebhookSignature({
          rawBody,
          headers: headers({
            "bitos-pay-timestamp": String(now - 301),
            "bitos-pay-signature": signature(rawBody, now - 301)
          }),
          secret,
          nowSeconds: now
        }),
      (error: unknown) =>
        error instanceof BitOSPayWebhookError && error.reason === "stale_timestamp"
    );
    assert.throws(
      () =>
        verifyWebhookSignature({
          rawBody,
          headers: { "bitos-pay-timestamp": String(timestamp) },
          secret,
          nowSeconds: now
        }),
      (error: unknown) =>
        error instanceof BitOSPayWebhookError && error.reason === "missing_signature"
    );
  });

  it("rejects an event id header that does not match the body", () => {
    assert.throws(
      () =>
        constructWebhookEvent({
          rawBody,
          headers: headers({ "bitos-pay-event-id": "evt_other" }),
          secret,
          nowSeconds: now
        }),
      (error: unknown) =>
        error instanceof BitOSPayWebhookError && error.reason === "event_mismatch"
    );
  });
});
