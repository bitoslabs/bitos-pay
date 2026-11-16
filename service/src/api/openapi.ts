const error = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["type", "code", "message"],
      properties: {
        type: { type: "string" },
        code: { type: "string" },
        message: { type: "string" },
        request_id: { type: "string" }
      }
    }
  }
} as const;

const createIntentBody = {
  type: "object",
  required: ["amount", "currency", "scale", "payment_method"],
  properties: {
    amount: { type: "integer", minimum: 1, description: "Integer minor units; SAT has scale 0." },
    currency: { type: "string", enum: ["SAT"] },
    scale: { type: "integer", enum: [0] },
    payment_method: { type: "string", enum: ["lightning"] },
    external_reference: { type: ["string", "null"], maxLength: 200 },
    location_id: { type: ["string", "null"], maxLength: 80 },
    metadata: { type: "object", additionalProperties: true }
  }
} as const;

const paymentIntent = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: {
      type: "string",
      enum: ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"]
    },
    amount: { type: "integer" },
    amount_msat: { type: "string" },
    currency: { type: "string" },
    scale: { type: "integer" },
    external_reference: { type: ["string", "null"] },
    livemode: { type: "boolean" },
    expires_at: { type: "string", format: "date-time" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    metadata: { type: "object" }
  }
} as const;

const listMeta = {
  type: "object",
  properties: {
    object: { type: "string", const: "list" },
    data: { type: "array" },
    has_more: { type: "boolean" },
    next_cursor: { type: ["string", "null"] },
    request_id: { type: "string" }
  }
} as const;

const periods = {
  type: "object",
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" }
  }
} as const;

export const openapiDocument = {
  openapi: "3.1.0",
  info: {
    title: "BitOS Pay reference API",
    version: "2026-11-13",
    description:
      "Synthetic reference API. Sandbox only. Provider confirmation, never a browser, changes payment state."
  },
  servers: [{ url: "http://127.0.0.1:8788" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "bp_test_… / bp_live_…" }
    },
    schemas: {
      Error: error,
      PaymentIntent: paymentIntent,
      List: listMeta,
      Periods: periods,
      Refund: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string", const: "refund" },
          transaction_id: { type: "string" },
          payment_intent_id: { type: "string" },
          amount: { type: "integer" },
          amount_msat: { type: "string" },
          fee: { type: "integer" },
          fee_msat: { type: "string" },
          net: { type: "integer" },
          net_msat: { type: "string" },
          currency: { type: "string" },
          scale: { type: "integer" },
          reason: { type: ["string", "null"] },
          status: { type: "string", enum: ["PENDING", "SUCCEEDED", "FAILED", "CANCELLED"] },
          livemode: { type: "boolean" },
          created_at: { type: "string", format: "date-time" },
          settled_at: { type: ["string", "null"], format: "date-time" }
        }
      }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/v1/onboarding/nostr/challenge": {
      post: {
        security: [],
        summary: "Create a one-time Nostr onboarding challenge",
        responses: {
          "200": { description: "Challenge bound to this service origin" },
          "403": { description: "Sandbox onboarding disabled" }
        }
      }
    },
    "/v1/onboarding/nostr": {
      post: {
        security: [],
        summary: "Create a sandbox account with a signed Nostr key",
        responses: {
          "201": { description: "Sandbox account created; key returned once" },
          "400": { description: "Invalid request body" },
          "401": { description: "Invalid, replayed or expired Nostr proof" },
          "403": { description: "Sandbox onboarding disabled" }
        }
      }
    },
    "/v1/onboarding/bnos": {
      post: {
        security: [],
        summary: "Link a signed BNOS workspace to a sandbox account",
        description:
          "The owner signs a one-time kind 22242 challenge with a subject tag bnos:<workspace_id>. Pay maps it to subject_ref, provisions on first sync and updates names on later syncs. The proof shows key control, not a legal business or BNOS server attestation.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["workspace_id", "workspace_name", "merchant_name", "event"],
                properties: {
                  workspace_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$" },
                  workspace_name: { type: "string", minLength: 2, maxLength: 120 },
                  merchant_name: { type: "string", minLength: 2, maxLength: 120 },
                  country: { type: "string", pattern: "^[A-Z]{2}$" },
                  event: { type: "object" }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Existing workspace synced; no API key reissued" },
          "201": { description: "Workspace linked; API key returned once" },
          "400": { description: "Invalid request body" },
          "401": { description: "Invalid, replayed or unbound Nostr proof" },
          "403": { description: "Sandbox onboarding disabled" },
          "409": { description: "Workspace is linked to another owner" },
          "429": { description: "Onboarding rate limit exceeded" }
        }
      }
    },
    "/v1/onboarding/sandbox": {
      post: {
        security: [],
        summary: "Create a sandbox organization, merchant and test API key",
        description:
          "Disabled unless PAY_ONBOARDING_ENABLED=1. Sandbox only; the merchant is not verified for live payments.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["organization_name", "merchant_name"],
                properties: {
                  organization_name: { type: "string", minLength: 2, maxLength: 120 },
                  merchant_name: { type: "string", minLength: 2, maxLength: 120 },
                  country: { type: "string", pattern: "^[A-Z]{2}$" }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "Sandbox account created; API key returned once" },
          "403": { description: "Sandbox onboarding disabled" },
          "429": { description: "Onboarding rate limit exceeded" }
        }
      }
    },
    "/v1/plans": {
      get: {
        security: [],
        summary: "List active organization plans",
        responses: { "200": { description: "Plan list" } }
      }
    },
    "/v1/subscriptions": {
      post: {
        summary: "Create a subscription invoice for an organization plan",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["plan_code"],
                properties: { plan_code: { type: "string", minLength: 2, maxLength: 80 } }
              }
            }
          }
        },
        responses: {
          "201": { description: "Pending subscription and provider invoice" },
          "400": { description: "Unknown or non-purchasable plan" },
          "403": { description: "Missing keys:write scope" }
        }
      }
    },
    "/v1/entitlements/current": {
      get: {
        summary: "Read the current organization entitlement",
        responses: { "200": { description: "Entitlement or default free plan" } }
      }
    },
    "/v1/sandbox/subscriptions/{id}/settle": {
      post: {
        summary: "Settle a sandbox subscription invoice and issue an entitlement",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          "200": { description: "Activated subscription and entitlement" },
          "401": { description: "Missing API key or sandbox token" },
          "403": { description: "Missing keys:write scope" },
          "404": { description: "Subscription not found" }
        }
      }
    },
    "/healthz": {
      get: {
        security: [],
        summary: "Liveness",
        responses: { "200": { description: "Process is alive" } }
      }
    },
    "/readyz": {
      get: {
        security: [],
        summary: "Readiness",
        responses: { "200": { description: "Database is ready" }, "503": { description: "Not ready" } }
      }
    },
    "/v1/payment-intents": {
      post: {
        summary: "Create a payment intent and Lightning invoice",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 200 }
          }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: createIntentBody } }
        },
        responses: {
          "201": { description: "Intent is PENDING with an issued invoice and signed checkout URL" },
          "400": { description: "Validation or idempotency error", content: { "application/json": { schema: error } } }
        }
      }
    },
    "/v1/payment-intents/{id}": {
      get: {
        summary: "Read an intent, attempt, invoice and transaction",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Intent view" }, "404": { description: "Not found" } }
      }
    },
    "/v1/payment-intents/{id}/cancel": {
      post: {
        summary: "Cancel a non-terminal intent",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Cancelled intent" }, "409": { description: "Terminal state" } }
      }
    },
    "/v1/checkout/{token}": {
      get: {
        summary: "Read the public projection of a signed checkout link",
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Merchant name, amount, invoice and provider-confirmed status" },
          "404": { description: "Invalid, unknown or expired link" }
        }
      }
    },
    "/v1/invoices": {
      post: {
        summary: "Create an invoice directly",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 200 }
          }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: createIntentBody } }
        },
        responses: { "201": { description: "Issued invoice" }, "400": { description: "Validation error" } }
      }
    },
    "/v1/invoices/{id}": {
      get: {
        summary: "Read an invoice by id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Invoice" }, "404": { description: "Not found" } }
      }
    },
    "/v1/payments": {
      get: {
        summary: "List payment intents",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { name: "starting_after", in: "query", schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["CREATED", "PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"]
            }
          }
        ],
        responses: { "200": { description: "Paginated intents" } }
      }
    },
    "/v1/transactions": {
      get: {
        summary: "List ledger-derived transactions",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { name: "starting_after", in: "query", schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["DETECTED", "CONFIRMED", "SETTLED", "REVERSED"] }
          }
        ],
        responses: { "200": { description: "Paginated transactions" } }
      }
    },
    "/v1/payment-links": {
      get: {
        summary: "List reusable fixed-amount payment links",
        responses: { "200": { description: "Links with signed customer URLs" } }
      },
      post: {
        summary: "Create a reusable fixed-amount payment link",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 200 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["amount", "currency", "scale"],
                properties: {
                  amount: { type: "integer", minimum: 1 },
                  currency: { type: "string", enum: ["SAT"] },
                  scale: { type: "integer", enum: [0] },
                  reference: { type: ["string", "null"], maxLength: 200 },
                  label: { type: ["string", "null"], maxLength: 120 }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Link and signed customer URL" } }
      }
    },
    "/v1/payment-links/{id}/disable": {
      post: {
        summary: "Disable a reusable payment link",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Disabled link" }, "404": { description: "Not found" } }
      }
    },
    "/v1/payment-links/{token}": {
      get: {
        summary: "Read the public projection of a signed payment link",
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Merchant name, fixed amount, reference and label" },
          "404": { description: "Invalid or disabled link" }
        }
      }
    },
    "/v1/payment-links/{token}/checkout": {
      post: {
        summary: "Create a fresh payment intent and checkout URL from a payment link",
        parameters: [
          { name: "token", in: "path", required: true, schema: { type: "string" } },
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 200 }
          }
        ],
        responses: {
          "201": { description: "Payment id and signed checkout URL" },
          "404": { description: "Invalid or disabled link" },
          "429": { description: "Per-client link rate limit" }
        }
      }
    },
    "/v1/refunds": {
      post: {
        summary: "Refund a settled transaction",
        description: "Requires the payments:refund scope. Sandbox reference only; the ledger posts reversal entries.",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 200 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["transaction_id", "amount"],
                properties: {
                  transaction_id: { type: "string", maxLength: 100 },
                  amount: { type: "integer", minimum: 1 },
                  reason: { type: ["string", "null"], maxLength: 200 }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "Refund succeeded and ledger reversal posted" },
          "400": { description: "Validation or idempotency error" },
          "403": { description: "Missing scope or risk denial" },
          "404": { description: "Transaction not found" },
          "409": { description: "Refund exceeds the unrefunded amount or transaction is not settled" }
        }
      },
      get: {
        summary: "List refunds",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { name: "starting_after", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "Paginated refunds" } }
      }
    },
    "/v1/refunds/{id}": {
      get: {
        summary: "Read a refund",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Refund" }, "404": { description: "Not found" } }
      }
    },
    "/v1/balances": {
      get: {
        summary: "Ledger-derived balances (never a wallet balance)",
        responses: { "200": { description: "Balances" } }
      }
    },
    "/v1/merchants/me": {
      get: {
        summary: "Read the authenticated merchant",
        responses: { "200": { description: "Merchant profile" } }
      },
      patch: {
        summary: "Update the merchant profile",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 120 },
                  support_email: { type: ["string", "null"], maxLength: 254 },
                  website: { type: ["string", "null"], maxLength: 2048 }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Updated merchant profile" },
          "403": { description: "Missing merchants:write scope" },
          "400": { description: "Invalid name, email or website" }
        }
      }
    },
    "/v1/locations": {
      get: {
        summary: "List merchant locations",
        responses: { "200": { description: "Locations for the authenticated merchant" } }
      },
      post: {
        summary: "Create a merchant location",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "code"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 120 },
                  code: { type: "string", minLength: 2, maxLength: 24 }
                }
              }
            }
          }
        },
        responses: {
          "201": { description: "Created location" },
          "409": { description: "Location code already exists" }
        }
      }
    },
    "/v1/locations/{id}": {
      patch: {
        summary: "Rename or enable/disable a merchant location",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                minProperties: 1,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 120 },
                  active: { type: "boolean" }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Updated location" }, "404": { description: "Not found" } }
      }
    },
    "/v1/locations/{id}/disable": {
      post: {
        summary: "Disable a merchant location",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Disabled location" }, "404": { description: "Not found" } }
      }
    },
    "/v1/webhook-endpoints": {
      get: {
        summary: "List webhook endpoints",
        responses: { "200": { description: "Endpoints" } }
      },
      post: {
        summary: "Register a signed webhook endpoint",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 200 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url", "events"],
                properties: {
                  url: { type: "string", maxLength: 2048 },
                  events: { type: "array", minItems: 1, items: { type: "string" } }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Endpoint and one-time signing secret" } }
      }
    },
    "/v1/webhook-endpoints/{id}": {
      patch: {
        summary: "Update an active webhook endpoint's events",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["events"],
                properties: {
                  events: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Updated endpoint" },
          "400": { description: "Unsupported event or inactive endpoint" }
        }
      }
    },
    "/v1/webhook-endpoints/{id}/rotate": {
      post: {
        summary: "Rotate a webhook signing secret with a dual-signature grace window",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "New one-time secret and previous-secret expiry" },
          "404": { description: "Active endpoint not found" }
        }
      }
    },
    "/v1/webhook-endpoints/{id}/disable": {
      post: {
        summary: "Disable a webhook endpoint",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Disabled endpoint" }, "404": { description: "Not found" } }
      }
    },
    "/v1/webhook-deliveries": {
      get: {
        summary: "List webhook deliveries",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }
        ],
        responses: { "200": { description: "Delivery log" } }
      }
    },
    "/v1/webhook-deliveries/{id}/replay": {
      post: {
        summary: "Replay a delivery with the same event id",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Delivery reset to PENDING" }, "404": { description: "Not found" } }
      }
    },
    "/v1/api-keys": {
      get: {
        summary: "List scoped API keys",
        responses: { "200": { description: "Key metadata; secrets are never returned" } }
      },
      post: {
        summary: "Create a scoped API key",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  scopes: { type: "array", items: { type: "string" }, uniqueItems: true },
                  expires_in_days: {
                    type: ["integer", "null"],
                    minimum: 1,
                    maximum: 365,
                    description: "Optional expiry; omitted or null means no expiry."
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Key metadata with the secret shown once" } }
      }
    },
    "/v1/api-keys/{id}/rotate": {
      post: {
        summary: "Rotate an API key atomically",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "201": { description: "Replacement key metadata with the secret shown once" },
          "409": { description: "Key is current, inactive or from another mode" }
        }
      }
    },
    "/v1/api-keys/{id}/revoke": {
      post: {
        summary: "Revoke an API key",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Revoked key" }, "409": { description: "Cannot revoke current key" } }
      }
    },
    "/v1/exchange/quotes": {
      post: {
        summary: "Create a sandbox LAK/SAT quote snapshot",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["base_currency", "quote_currency", "amount"],
                properties: {
                  base_currency: { type: "string", enum: ["SAT", "LAK"] },
                  quote_currency: { type: "string", enum: ["SAT", "LAK"] },
                  amount: { type: "integer", minimum: 1 }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Quote snapshot" }, "400": { description: "Unsupported pair" } }
      }
    },
    "/v1/exchange/quotes/{id}": {
      get: {
        summary: "Read a quote snapshot",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Quote and expiry flag" }, "404": { description: "Not found" } }
      }
    },
    "/v1/settlements": {
      get: {
        summary: "List stored settlement records",
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 20 }
          }
        ],
        responses: { "200": { description: "Settlement records, newest first" } }
      }
    },
    "/v1/settlements/summary": {
      get: {
        summary: "Compute a ledger-derived settlement period",
        parameters: [
          { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" } }
        ],
        responses: { "200": { description: "Settlement summary" } }
      }
    },
    "/v1/settlements/{id}": {
      get: {
        summary: "Read a stored settlement record",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Settlement record" }, "404": { description: "Not found" } }
      }
    },
    "/v1/settlements/reconcile": {
      post: {
        summary: "Record a reconciled settlement period",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["period_start", "period_end"],
                properties: {
                  period_start: { type: "string", format: "date-time" },
                  period_end: { type: "string", format: "date-time" }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Stored settlement record" } }
      }
    },
    "/v1/sandbox/invoices/{paymentHash}/settle": {
      post: {
        summary: "Sandbox-only provider settlement simulation",
        description: "Requires X-Sandbox-Token. Never available in live mode.",
        parameters: [
          { name: "paymentHash", in: "path", required: true, schema: { type: "string" } },
          { name: "X-Sandbox-Token", in: "header", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: ["object", "null"],
                properties: { amount: { type: "integer", minimum: 1 }, amount_msat: { type: "integer", minimum: 1 } }
              }
            }
          }
        },
        responses: { "200": { description: "Settled or duplicate" }, "202": { description: "Quarantined late settlement" } }
      }
    }
  }
} as const;
