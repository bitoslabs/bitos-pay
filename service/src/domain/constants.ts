export const API_VERSION = "2026-11-01";
export const SAT_CURRENCY = "SAT";
export const SAT_SCALE = 0;

export const API_KEY_SCOPES = [
  "payments:read",
  "payments:write",
  "payments:refund",
  "webhooks:read",
  "webhooks:write",
  "keys:read",
  "keys:write",
  "merchants:write",
  "quotes:read"
] as const;
