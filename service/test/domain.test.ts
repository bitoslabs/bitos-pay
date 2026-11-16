import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertAmount,
  assertAttemptTransition,
  assertBalanced,
  assertCurrency,
  assertIntentTransition,
  assertInvoiceTransition,
  computeFee,
  paymentLedgerLines,
  refundLedgerLines,
  requestDigest,
  verifyWebhookSignature,
  webhookSignature
} from "../src/domain/index.ts";
import { PayError } from "../src/domain/errors.ts";
import { createSecretBox } from "../src/infrastructure/crypto/secret-box.ts";

describe("money validation", () => {
  it("accepts positive safe integers", () => {
    assert.equal(assertAmount(1), 1n);
    assert.equal(assertAmount(1000), 1000n);
    assert.equal(assertAmount(5n), 5n);
  });

  it("rejects zero, negative, fractional and non-numeric amounts", () => {
    for (const value of [0, -1, 1.5, Number.NaN, "100", null, undefined]) {
      assert.throws(() => assertAmount(value), PayError);
    }
  });

  it("only accepts SAT with scale zero", () => {
    assert.doesNotThrow(() => assertCurrency("SAT", 0));
    assert.throws(() => assertCurrency("LAK", 0), PayError);
    assert.throws(() => assertCurrency("SAT", 2), PayError);
  });
});

describe("state machine", () => {
  it("allows only documented intent transitions", () => {
    assert.doesNotThrow(() => assertIntentTransition("CREATED", "PENDING"));
    assert.doesNotThrow(() => assertIntentTransition("PENDING", "SUCCEEDED"));
    assert.throws(() => assertIntentTransition("SUCCEEDED", "PENDING"), PayError);
    assert.throws(() => assertIntentTransition("FAILED", "SUCCEEDED"), PayError);
    assert.doesNotThrow(() => assertIntentTransition("EXPIRED", "SUCCEEDED"));
  });

  it("allows only documented invoice and attempt transitions", () => {
    assert.doesNotThrow(() => assertInvoiceTransition("ISSUED", "SETTLED"));
    assert.throws(() => assertInvoiceTransition("SETTLED", "ISSUED"), PayError);
    assert.doesNotThrow(() => assertAttemptTransition("INVOICE_ISSUED", "QUARANTINED"));
    assert.throws(() => assertAttemptTransition("QUARANTINED", "SUCCEEDED"), PayError);
    assert.doesNotThrow(() => assertInvoiceTransition("EXPIRED", "SETTLED"));
    assert.doesNotThrow(() => assertAttemptTransition("EXPIRED", "SUCCEEDED"));
    assert.throws(() => assertInvoiceTransition("CANCELLED", "SETTLED"), PayError);
  });
});

describe("fees and ledger", () => {
  it("computes an integer fee snapshot without floating point", () => {
    assert.deepEqual(computeFee(1_000_000n, 0), { feeMsat: 0n, netMsat: 1_000_000n });
    assert.deepEqual(computeFee(1_000_000n, 100), { feeMsat: 10_000n, netMsat: 990_000n });
    assert.deepEqual(computeFee(1n, 100), { feeMsat: 0n, netMsat: 1n });
    assert.throws(() => computeFee(100n, 10001), PayError);
  });

  it("builds balanced payment entries with and without a fee", () => {
    const withoutFee = paymentLedgerLines(1_000_000n, 0n);
    assert.equal(withoutFee.length, 2);
    assert.doesNotThrow(() => assertBalanced(withoutFee));

    const withFee = paymentLedgerLines(1_000_000n, 10_000n);
    assert.equal(withFee.length, 3);
    assert.doesNotThrow(() => assertBalanced(withFee));
    assert.equal(
      withFee.reduce((sum, line) => (line.direction === "debit" ? sum + line.amountMsat : sum), 0n),
      1_000_000n
    );
  });

  it("splits partial refunds proportionally and reverses the final fee", () => {
    const first = refundLedgerLines({
      originalAmountMsat: 1_000_000n,
      originalFeeMsat: 10_000n,
      refundedBeforeMsat: 0n,
      refundAmountMsat: 400_000n
    });
    assert.equal(first.feeMsat, 4_000n);
    assert.equal(first.netMsat, 396_000n);
    assert.doesNotThrow(() => assertBalanced(first.lines));

    const second = refundLedgerLines({
      originalAmountMsat: 1_000_000n,
      originalFeeMsat: 10_000n,
      refundedBeforeMsat: 400_000n,
      refundAmountMsat: 600_000n
    });
    assert.equal(second.feeMsat, 6_000n);
    assert.equal(second.netMsat, 594_000n);
    assert.doesNotThrow(() => assertBalanced(second.lines));
    assert.throws(
      () =>
        refundLedgerLines({
          originalAmountMsat: 1_000_000n,
          originalFeeMsat: 10_000n,
          refundedBeforeMsat: 1_000_000n,
          refundAmountMsat: 1n
        }),
      PayError
    );
  });

  it("rejects an unbalanced entry set", () => {
    assert.throws(
      () =>
        assertBalanced([
          { accountCode: "a", accountType: "ASSET", direction: "debit", amountMsat: 10n },
          { accountCode: "b", accountType: "LIABILITY", direction: "credit", amountMsat: 9n }
        ]),
      PayError
    );
  });
});

describe("canonical request digests", () => {
  it("does not depend on object key order", () => {
    assert.equal(
      requestDigest({ amount: 100, currency: "SAT", metadata: { b: 2, a: 1 } }),
      requestDigest({ metadata: { a: 1, b: 2 }, currency: "SAT", amount: 100 })
    );
  });

  it("changes when a value changes", () => {
    assert.notEqual(requestDigest({ amount: 100 }), requestDigest({ amount: 101 }));
  });
});

describe("webhook signatures", () => {
  it("verifies a fresh signature and rejects replay or tampering", () => {
    const secret = "whsec_test";
    const timestamp = 1_800_000_000;
    const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded" });
    const signature = webhookSignature(secret, timestamp, body);
    assert.equal(verifyWebhookSignature(secret, timestamp, body, signature, timestamp + 10), true);
    assert.equal(verifyWebhookSignature(secret, timestamp, body, signature, timestamp + 301), false);
    assert.equal(verifyWebhookSignature(secret, timestamp, body + " ", signature, timestamp + 1), false);
    assert.equal(verifyWebhookSignature("whsec_other", timestamp, body, signature, timestamp + 1), false);
  });
});

describe("webhook secret encryption", () => {
  it("round-trips and rejects a different key", () => {
    const box = createSecretBox(Buffer.alloc(32, 3).toString("base64"));
    const other = createSecretBox(Buffer.alloc(32, 4).toString("base64"));
    const ciphertext = box.encrypt("whsec_local");
    assert.equal(box.decrypt(ciphertext), "whsec_local");
    assert.throws(() => other.decrypt(ciphertext));
  });
});
