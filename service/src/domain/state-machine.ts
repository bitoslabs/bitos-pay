import { PayError } from "./errors.ts";
import type { AttemptStatus, IntentStatus, InvoiceStatus } from "./types.ts";

export const INTENT_TRANSITIONS: Record<IntentStatus, readonly IntentStatus[]> = {
  CREATED: ["PENDING", "EXPIRED", "CANCELLED"],
  PENDING: ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  EXPIRED: ["SUCCEEDED"],
  CANCELLED: []
};

export const ATTEMPT_TRANSITIONS: Record<AttemptStatus, readonly AttemptStatus[]> = {
  CREATED: ["INVOICE_ISSUED", "FAILED", "CANCELLED"],
  INVOICE_ISSUED: ["PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED", "QUARANTINED"],
  PENDING: ["SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED", "QUARANTINED"],
  SUCCEEDED: [],
  FAILED: [],
  EXPIRED: ["SUCCEEDED", "QUARANTINED"],
  CANCELLED: [],
  QUARANTINED: []
};

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  ISSUED: ["SETTLED", "EXPIRED", "CANCELLED", "QUARANTINED"],
  SETTLED: [],
  EXPIRED: ["SETTLED", "QUARANTINED"],
  CANCELLED: [],
  QUARANTINED: []
};

export function assertIntentTransition(from: IntentStatus, to: IntentStatus): void {
  if (!INTENT_TRANSITIONS[from].includes(to)) {
    if (INTENT_TRANSITIONS[from].length === 0) throw new PayError("PAY_STATE_TERMINAL");
    throw new PayError("PAY_STATE_ILLEGAL", `cannot move payment intent from ${from} to ${to}`);
  }
}

export function assertAttemptTransition(from: AttemptStatus, to: AttemptStatus): void {
  if (!ATTEMPT_TRANSITIONS[from].includes(to)) {
    if (ATTEMPT_TRANSITIONS[from].length === 0) throw new PayError("PAY_STATE_TERMINAL");
    throw new PayError("PAY_STATE_ILLEGAL", `cannot move payment attempt from ${from} to ${to}`);
  }
}

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!INVOICE_TRANSITIONS[from].includes(to)) {
    if (INVOICE_TRANSITIONS[from].length === 0) throw new PayError("PAY_STATE_TERMINAL");
    throw new PayError("PAY_STATE_ILLEGAL", `cannot move invoice from ${from} to ${to}`);
  }
}

export function isTerminalStatus(status: IntentStatus): boolean {
  return INTENT_TRANSITIONS[status].length === 0;
}
