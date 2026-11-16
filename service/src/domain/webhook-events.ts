export const PAYMENT_EVENTS = new Set([
  "*",
  "payment.created",
  "payment.pending",
  "payment.succeeded",
  "payment.failed",
  "payment.expired",
  "payment.cancelled",
  "payment.quarantined",
  "invoice.created",
  "invoice.settled",
  "refund.succeeded"
]);
