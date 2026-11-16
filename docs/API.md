# BitOS Pay — API

Status: **Spec + local reference API.** The public base URL is planned, not live:
`https://api.pay.bitos.space/v1`. The local reference serves a sandbox subset at
`http://127.0.0.1:8788`; see [RUNNING](RUNNING.md). Lightning, wallets and Nostr are first-class.

## 1. Authentication and conventions

- Server requests use `Authorization: Bearer bp_live_…` or `bp_test_…`.
  Secret keys never ship to a browser or a public client. The unauthenticated
  writes are sandbox onboarding (disabled by default) and capability-scoped
  payment-link checkout; neither accepts an arbitrary merchant, amount or API
  key.
- Production human sessions use Nostr NIP-07/NIP-46 login for dashboards. A
  session is not an API key and never authorizes payment creation by itself.
- The local `/console/` reference adapter signs in with a Nostr signer (NIP-07,
  NIP-46 or opt-in local nsec) or an API key matching `PAY_CONSOLE_MODE`
  (`sandbox` default, `live`, or `both` for the toggle), then stores a random
  session token hash server-side and an HttpOnly, `SameSite=Strict` cookie. It
  rejects a key for a mode the deployment does not allow and requires a CSRF
  header on writes. This is reference behavior, not the production human-login
  contract.
- `Idempotency-Key` is required on payment-intent, invoice, refund, payment-link
  and webhook-endpoint creation. The same key with a different body is a conflict.
  API-key creation, quote creation and settlement reconciliation are create-once
  operations and are not idempotent in this reference.
- Amounts are integers. Fiat requests carry `currency` and `scale`; Lightning
  requests use the rail's declared sat/msat unit.
- All timestamps are UTC ISO-8601. Responses include `request_id`.
- Every response is scoped to the authenticated merchant/organization. A
  cross-tenant reference returns not-found, not forbidden detail.

## 2. Operations (v1)

| Method | Path | Purpose | Feature |
| --- | --- | --- | --- |
| POST | `/payment-intents` | Create a payment request and invoice | PAY-F01, F02 |
| GET | `/payment-intents/:id` | Read status and attempts, including a signed `checkout_url` | PAY-F01, F03, F14 |
| POST | `/payment-intents/:id/cancel` | Cancel before settlement | PAY-F01 |
| GET | `/payments` | List payments with filters and cursor | PAY-F12 |
| POST | `/invoices` | Create an invoice directly for a merchant | PAY-F02 |
| GET | `/invoices/:id` | Read invoice state and expiry | PAY-F02, F05 |
| GET | `/merchants/me` | Read merchant profile, support details and verification state | PAY-F11 |
| GET | `/locations` | List merchant locations | PAY-F13 |
| POST | `/locations` | Create a location with a unique code; requires `merchants:write` | PAY-F13 |
| PATCH | `/locations/:id` | Rename or enable/disable a location; requires `merchants:write` | PAY-F13 |
| POST | `/locations/:id/disable` | Disable a location; requires `merchants:write` | PAY-F13 |
| PATCH | `/merchants/me` | Update merchant name, support email and website; requires `merchants:write` | PAY-F11 |
| GET | `/balances` | Ledger-derived balance by account | PAY-F06 |
| GET | `/transactions` | List verified transactions with cursor and status | PAY-F08 |
| POST | `/refunds` | Refund a settled transaction and post reversal entries | PAY-F09 |
| GET | `/refunds` | List refunds with cursor | PAY-F09 |
| GET | `/refunds/:id` | Read a refund | PAY-F09 |
| POST | `/payment-links` | Create a reusable fixed-amount payment link | PAY-F15 |
| GET | `/payment-links` | List links with signed customer URLs | PAY-F15 |
| POST | `/payment-links/:id/disable` | Disable a payment link | PAY-F15 |
| GET | `/payment-links/:token` | Public merchant/amount projection for a signed link | PAY-F15 |
| POST | `/payment-links/:token/checkout` | Create a fresh intent and checkout URL from a link | PAY-F15 |
| GET | `/settlements` | List stored reconciliations, newest first; `limit` 1–100 | PAY-F08 |
| GET | `/settlements/summary` | Compute period gross, fees, net and ledger balance | PAY-F08 |
| POST | `/settlements/reconcile` | Store a reconciled settlement period | PAY-F08 |
| GET | `/settlements/:id` | Read a stored settlement record | PAY-F08 |
| POST | `/webhook-endpoints` | Register a signed webhook endpoint | PAY-F18 |
| GET | `/webhook-endpoints` | List endpoints | PAY-F18 |
| PATCH | `/webhook-endpoints/:id` | Replace the event selection on an active endpoint | PAY-F18 |
| POST | `/webhook-endpoints/:id/rotate` | Rotate the signing secret with a dual-signature grace window; new secret shown once | PAY-F18 |
| POST | `/webhook-endpoints/:id/disable` | Disable an endpoint | PAY-F18 |
| GET | `/webhook-deliveries` | Read the delivery log | PAY-F18 |
| POST | `/webhook-deliveries/:id/replay` | Replay a delivery by event id | PAY-F18 |
| GET | `/plans` | List active organization plans | PAY-F31 |
| POST | `/subscriptions` | Create a subscription invoice | PAY-F31 |
| GET | `/entitlements/current` | Read the current organization entitlement | PAY-F31 |
| POST | `/sandbox/subscriptions/:id/settle` | Sandbox settlement of a subscription invoice | PAY-F31 |
| GET | `/api-keys` | List scoped key metadata | PAY-F17 |
| POST | `/api-keys` | Create a scoped key; secret shown once | PAY-F17 |
| POST | `/api-keys/:id/rotate` | Atomically revoke a scoped key and issue a same-scope replacement; secret shown once | PAY-F17 |
| POST | `/api-keys/:id/revoke` | Revoke a key | PAY-F17 |
| POST | `/onboarding/sandbox` | Create a sandbox organization, merchant and test key | PAY-F32 |
| POST | `/onboarding/nostr/challenge` | Create a one-time onboarding challenge | PAY-F32 |
| POST | `/onboarding/nostr` | Create a sandbox account with a signed Nostr key | PAY-F32 |
| POST | `/onboarding/bnos` | Link or sync a signed BNOS workspace | PAY-F32 |
| POST | `/providers/lnbits/webhook` | Token-protected LNbits payment notification; server verifies with LNbits | PAY-F35 |
| POST | `/providers/blink/webhook` | Svix-signed Blink `receive.lightning` notification; server verifies with Blink | PAY-F36 |
| POST | `/providers/strike/webhook` | HMAC-signed Strike `receive-request.receive-completed` notification; server verifies with Strike | PAY-F36 |
| POST | `/exchange/quotes` | Create a sandbox LAK/SAT quote snapshot | PAY-F24 |
| GET | `/exchange/quotes/:id` | Read a quote and its expiry flag | PAY-F24 |
| GET | `/openapi.json` | Read the OpenAPI 3.1 description | PAY-F16 |

Read operations use cursor pagination (`limit`, `starting_after`) and bounded
filters; list responses never include secrets. The list shape is:

```json
{
  "object": "list",
  "data": [],
  "has_more": true,
  "next_cursor": "pi_...",
  "request_id": "req_..."
}
```

Pass `next_cursor` as `starting_after` for the next page. A cursor is scoped to
the authenticated merchant; an unknown cursor returns an empty page.

### Public checkout

`POST /payment-intents` and `POST /invoices` return an absolute `checkout_url`
when a public base URL is configured. The path is a signed, stateless checkout
token: the server HMACs the intent id with the service secret, so no browser
client needs an API key or merchant id to read the payment.

`GET /v1/checkout/:token` returns a deliberately small projection: merchant
display name, amount, reference, intent status, expiry, the Lightning invoice,
and the confirmed transaction when present. It never returns organization or
merchant ids, provider credentials, metadata, API-key state or internal risk
data. The link is readable until the intent reaches a terminal state; rotating
`PAY_SECRET_KEY` invalidates all outstanding checkout links.

`GET /checkout/:token` serves the zero-build hosted checkout page with the same
token. It polls the JSON endpoint, draws the real invoice QR and reports the
provider-confirmed status. The browser never marks a payment paid. The static
`ui/checkout.html` demo remains available without a token. The reference has no
edge rate limiter; a production deployment must bound public-link requests.

### Reusable payment links

A payment link stores a fixed SAT amount, optional reference and optional label.
`POST /payment-links` requires `payments:write` and an `Idempotency-Key`; it
returns a signed `/pay/plk_…` URL. `GET /v1/payment-links/:token` returns only
the merchant display name, amount, reference and label. Disabling a link blocks
new checkouts but leaves already-created invoices unchanged.

`POST /v1/payment-links/:token/checkout` creates a fresh intent through the same
payment service, with a fixed `external_reference` of the link reference (or
`payment_link:<id>`), then returns the signed checkout URL. The browser supplies
an `Idempotency-Key`; refreshes reuse it, while a new customer gets a new invoice.
The reference rate-limits invoice creation per client IP per minute
(`PAY_PAYMENT_LINK_RATE_LIMIT`, default 20) and still applies merchant risk,
provider and expiry rules. The in-memory limiter is not a production edge
limiter. `GET /pay/:token` serves the zero-build link page.

### Reference console session

The console is served at `http://127.0.0.1:8788/console/` when
`PAY_CONSOLE_ENABLED` is on (default in the reference). `PAY_CONSOLE_MODE` is
`sandbox` (default), `live`, or `both`; `both` enables the Sandbox/Live toggle.
It is a same-origin adapter over the same services and scopes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/console/api/config` | Read the configured console mode, available modes and whether the Sandbox/Live toggle is enabled |
| POST | `/console/api/session` | Exchange an active key for a session cookie; optional `mode` must match the selected console mode |
| GET | `/console/api/session` | Read merchant, scopes, `livemode` and a rotated CSRF token |
| DELETE | `/console/api/session` | Revoke the session |
| GET | `/console/api/overview` | Merchant, plan/entitlement, balances, 24h settlement, stored reconciliations, the first 20 payments and next cursor, keys, webhook readings and read-only provider routing (no credentials) |
| GET | `/console/api/payments` | Cursor page of payments; optional `status`, `limit` and `starting_after` |
| POST | `/console/api/reconciliations` | Store a reconciliation period; requires `payments:write` and CSRF |
| GET | `/console/api/payment-intents/:id` | Read one intent with invoice, transaction, refunds and refundable balance |
| POST | `/console/api/payment-intents` | Create an intent in the session mode; requires `Idempotency-Key` and `x-pay-csrf` |
| POST | `/console/api/refunds` | Create a sandbox refund from a settled transaction; live refunds fail closed; requires `Idempotency-Key` and CSRF |
| PATCH | `/console/api/merchants/me` | Update merchant profile; requires `merchants:write` and CSRF |
| GET | `/console/api/exports/payments.csv` | Download up to 5,000 payments; optional `from`, `to`, `status`, `location_id` |
| GET | `/console/api/exports/reconciliations.csv` | Download the 100 most recent stored reconciliations |
| PATCH | `/console/api/locations/:id` | Rename or enable/disable a location; requires CSRF |
| GET | `/console/api/members` | List invited Nostr members; requires `keys:read` |
| POST | `/console/api/members` | Invite a Nostr pubkey with a preset role; requires `keys:write` and CSRF |
| POST | `/console/api/members/:id/revoke` | Revoke a non-owner member and their hidden key; requires `keys:write` and CSRF |
| POST | `/console/api/payment-links` | Create a reusable link; requires `Idempotency-Key` and CSRF |
| POST | `/console/api/payment-links/:id/disable` | Disable a reusable link; requires CSRF |
| GET/POST | `/console/api/api-keys` | List or create scoped keys |
| POST | `/console/api/api-keys/:id/rotate` | Atomically replace another key and return the new secret once |
| POST | `/console/api/api-keys/:id/revoke` | Revoke another key |
| POST | `/console/api/webhook-endpoints` | Register an endpoint; requires `Idempotency-Key` and CSRF |
| POST | `/console/api/webhook-endpoints/:id/rotate` | Rotate the signing secret; requires CSRF and returns the new secret once |
| PATCH | `/console/api/webhook-endpoints/:id` | Update active endpoint events; requires `webhooks:write` and CSRF |
| POST | `/console/api/webhook-endpoints/:id/disable` | Disable an endpoint |
| POST | `/console/api/webhook-deliveries/:id/replay` | Replay a delivery |
| GET | `/console/api/onboarding/config` | Discover whether self-service sandbox onboarding is enabled; false in live-only mode |
| POST | `/console/api/subscriptions` | Create a sandbox plan invoice; requires CSRF |
| POST | `/console/api/subscriptions/:id/settle` | Activate a sandbox plan through the mock provider; requires CSRF |
| GET | `/console/api/nostr/config` | Discover enabled signer methods and the allowed relay |
| POST | `/console/api/nostr/challenge` | Create a five-minute, one-time NIP-42 challenge |
| POST | `/console/api/nostr/enter` | Verify a signed kind `22242` event, then sign in or create a sandbox account and session |
| POST | `/console/api/nostr/login` | Verify a signed kind `22242` event for a linked key |
| POST | `/console/api/nostr/link` | Create a session-bound challenge; requires CSRF and `keys:write` |
| POST | `/console/api/nostr/link/proof` | Link the signer pubkey to the current merchant/API key |

Console sign-in with an API key requires an active sandbox key with
`payments:read`. The primary path is `POST /console/api/nostr/enter`: one signed
kind `22242` challenge either opens the linked merchant or, when onboarding is
enabled, creates a sandbox organization, merchant, key and linked signer
identity. It returns the one-time `api_key` only for a newly created account and
sets the same session cookie. A signer key maps to one sandbox identity; reusing
it signs in instead of creating another account. The signature proves key possession, not a merchant
role or legal business. The challenge is tied to the console origin, expires
after 300 seconds and can be used once. NIP-07 keeps the key in the extension. Local `nsec` signing is
disabled unless `PAY_CONSOLE_ALLOW_NSEC=1`; when enabled, the key is posted only
to a same-origin Web Worker, never to the service, and is cleared after signing.
NIP-46 remote signing is disabled unless `PAY_CONSOLE_NOSTR_RELAY` names an
allowed `ws://`/`wss://` relay; the bunker must use that relay. The console
offers a `bunker://` URL flow and a client-initiated `nostrconnect://` QR flow;
the QR contains only the ephemeral client pubkey, relay, secret and requested
`sign_event:22242` permission. The console never exposes a key in browser
storage; a newly created sandbox account receives its one-time `bp_test_` key in
the response so the operator can copy it.
Session cookies are `Secure` only when `PAY_CONSOLE_COOKIE_SECURE=1`; enable that
behind HTTPS. Raw `nsec` entry is a reference-only opt-in and is not recommended.

### Create a payment intent

```json
{
  "merchant_id": "merchant_123",
  "external_reference": "BNOS-ORDER-001",
  "amount": 100000, "currency": "SAT", "scale": 0,
  "payment_method": "lightning",
  "metadata": { "source": "BNOS", "order_id": "ORDER-001" }
}
```

```json
{
  "id": "pi_123456",
  "status": "PENDING",
  "amount": 100000, "currency": "SAT", "scale": 0,
  "attempt_id": "pa_123456",
  "payment": { "method": "lightning", "invoice": "lnbc…", "payment_hash": "…" },
  "expires_at": "2026-11-10T18:00:00Z",
  "checkout_url": "http://127.0.0.1:8788/checkout/pcl_…"
}
```

The reference accepts SAT with scale `0`; LAK pricing and payment remain P1.
Identifiers and the invoice are synthetic; `amount` is an integer with no decimals.

The reference enforces per-merchant risk before creating a provider invoice:
`max_payment_msat`, a rolling 24-hour `daily_volume_msat` and
`max_payments_per_minute` (defaults: 100,000 SAT per payment, 1,000,000 SAT per
rolling day, 60 per minute). An amount or volume breach returns `PAY_RISK_LIMIT`
(403); a velocity breach returns `PAY_RISK_VELOCITY` (429 with
`Retry-After: 60`). A merchant that is not `ACTIVE` is rejected at
authentication. There is no admin API for changing limits in this reference;
seed/config values and the repository are the only writes.

`POST /payment-intents/:id/cancel` succeeds only while the intent is `CREATED`
or `PENDING` and the provider confirms the invoice is unpayable. A paid intent
returns a state error; use the refund workflow (PAY-F09) instead of mutating the intent.

### Create an invoice directly

`POST /invoices` uses the same body and idempotency rules as a payment intent and
returns the invoice-focused shape:

```json
{
  "id": "in_123456",
  "payment_intent_id": "pi_123456",
  "payment_attempt_id": "pa_123456",
  "payment_hash": "…",
  "invoice": "lnbc…",
  "status": "ISSUED",
  "amount": 100000, "currency": "SAT", "scale": 0,
  "expires_at": "2026-11-10T18:00:00Z",
  "livemode": false
}
```

An invoice still belongs to one intent and one attempt. It is never a second
payment state machine.

### Quote snapshot

`POST /exchange/quotes` stores a 60-second snapshot and returns `base_amount`,
`quote_amount`, `rate`, `source`, `quoted_at` and `expires_at`. The reference
uses fixed synthetic SAT/LAK rates and rejects unsupported pairs. A quote is
informational; it does not authorize a fiat payment or a price lock.

### Refunds and reversals

`POST /refunds` requires `payments:refund`, a valid `transaction_id`, an integer
SAT `amount`, an optional `reason` and an `Idempotency-Key`. It is sandbox-only:
a live key fails closed because no live refund provider exists. The console
uses the same service through `POST /console/api/refunds`; the payment-detail
response includes the refund history and remaining refundable amount. A partial
refund leaves the remainder refundable; an over-refund is rejected with
`PAY_REFUND_EXCEEDS`.

```json
{
  "transaction_id": "txn_123456",
  "amount": 400,
  "reason": "customer_request"
}
```

```json
{
  "id": "rfd_123456",
  "object": "refund",
  "transaction_id": "txn_123456",
  "payment_intent_id": "pi_123456",
  "amount": 400, "amount_msat": "400000",
  "fee": 4, "fee_msat": "4000",
  "net": 396, "net_msat": "396000",
  "currency": "SAT", "scale": 0,
  "reason": "customer_request",
  "status": "SUCCEEDED",
  "livemode": false
}
```

The refund is a separate record linked to the original transaction. It never
edits an invoice or a posted ledger entry. The ledger posts the opposite
movement: credit `provider_clearing`, debit `merchant_payable` and debit
`platform_fee_revenue` by the proportional fee. Repeated partial refunds true up
the fee on the final amount, so a fully refunded transaction has zero
ledger-derived balances. The API rejects an amount above the unrefunded
amount. This reference does not move real bitcoin or create a provider refund;
it records the local reversal and publishes `refund.succeeded`.

### Locations

Locations are per-merchant branches with a unique uppercase code. Creating or
disabling one requires `merchants:write`; listing requires `payments:read`. A
payment intent may include an active `location_id`; the API returns
`PAY_NOT_FOUND_LOCATION` for a missing, disabled or cross-merchant location.
Staff roles are not yet scoped to a location.

### CSV exports

Console exports require a session and `payments:read`. Payments include the
tenant's intents in a date range (newest first, capped at 5,000) with SAT and
msat amounts; reconciliations include stored ledger snapshots. Cells are RFC 4180
quoted and leading `= + - @` characters are prefixed with `'` to prevent
spreadsheet formula execution. Exports are not a settlement proof or wallet
balance.

### Merchant members

Console team members are Nostr signers linked to a merchant. Invitation requires
`keys:write`, a 64-character hex pubkey and a role. The service creates a hidden
`bp_test_` member key with preset scopes; the secret is never shown and the key
is excluded from `/api-keys` listings. Roles map to scopes:

| Role | Scopes |
| --- | --- |
| `ADMIN` | all API-key scopes |
| `MANAGER` | payments read/write/refund, webhooks read/write, `merchants:write`, `quotes:read` |
| `CASHIER` | `payments:read`, `payments:write` |
| `VIEWER` | `payments:read` |

Owners cannot be revoked. Revocation revokes the member key and identity, so
existing member sessions fail on their next request. This is a reference role
model; multi-branch assignment and organization-wide roles are not built.

### API keys

`POST /api-keys` accepts an optional `scopes` array and optional
`expires_in_days` (1–365; omitted or `null` means no expiry), and returns the
secret exactly once. Rotation preserves the expiry. Expired keys return
`PAY_AUTH_EXPIRED` and cannot be rotated, but can be revoked. Supported scopes
are `payments:read`, `payments:write`, `payments:refund`, `webhooks:read`,
`webhooks:write`, `keys:read`, `keys:write`, `merchants:write` and
`quotes:read`. `GET /api-keys` never returns a secret or hash. Revocation is
immediate for the next request. `POST /api-keys/:id/rotate` runs in one database
transaction: the old key becomes `REVOKED`, a same-scope/same-mode replacement is
created, and the new secret is returned once. Rotating the key used for the
request is rejected. The console uses the same operation and never returns the
secret from a list.

### Settlement summary

`GET /settlements` lists stored reconciliation snapshots. `GET
/settlements/summary?from=…&to=…` computes settled transaction count,
gross, fees and net after successful refunds in the period, plus whether ledger
debits equal credits. `POST
/settlements/reconcile` stores the same snapshot with an `stl_` id. These are
ledger-derived reporting records, not payouts or wallet balances.

### Create a sandbox organization

`POST /onboarding/sandbox` is unauthenticated but disabled by default and limited
per client IP per hour (`PAY_ONBOARDING_MAX_PER_HOUR`, default 5). It creates an
organization with `created_via=sandbox_onboarding`, an `ACTIVE` sandbox merchant,
a sandbox provider connection and one `bp_test_` key. The key is returned once.

```json
{
  "organization_name": "Sandbox Organization",
  "merchant_name": "Sandbox Merchant",
  "country": "LA"
}
```

The route cannot create a live key, verify a merchant or attach an ID subject.
It is a reference onboarding path, not production identity or workspace
creation.

`POST /onboarding/nostr/challenge` and `POST /onboarding/nostr` add the same
sandbox-only flow with a signed kind `22242` event bound to this origin. The
event proves possession of the key and sets `organizations.owner_pubkey`; it does
not create a global BitOS ID, verify a business or populate `subject_ref`.
Challenges are one-time and expire after 300 seconds.

### Link a BNOS workspace

`POST /onboarding/bnos` is the local-first BNOS bridge. The BNOS owner signs the
same one-time kind `22242` challenge, with an additional subject binding:

```json
["subject", "bnos:org-bnos1234"]
```

The request body carries `workspace_id`, `workspace_name`, `merchant_name`, an
optional `country` and the signed `event`. Pay verifies the signature, origin,
freshness and subject tag, then maps the workspace to
`organizations.subject_ref = bnos:<workspace_id>`.

- First sync returns `201`, provisions the sandbox organization/merchant/test key
  and returns the key once.
- Later syncs return `200` with `created=false`, `api_key=null`, update the
  organization and merchant names and keep the same origin mapping.
- The same workspace id cannot be linked to a different owner key; that returns
  `409 PAY_SUBJECT_CONFLICT`.
- The proof shows control of the owner key, not a legal business, BNOS server
  attestation or ID authority. `verification` is reported as `owner_key_only`.

The BNOS client calls this after the user explicitly connects the workspace and
refreshes the link after login when a local connection record exists.

### Live provider adapters (opt-in)

The reference has one live-provider slot. Select `lnbits`, `blink` or `strike`
with `PAY_LIGHTNING_PROVIDER`, set `PAY_LIVE_ENABLED=1` and provide that
provider's credentials and webhook secret; incomplete settings fail startup.
Sandbox merchants always use the mock provider. Live merchants use the selected
adapter, chosen by `livemode` and the provider connection.

Common behavior:

- Live invoices are whole-sat only. Fractional-msat amounts are rejected rather
  than rounded.
- A callback is a trigger, not proof. The server re-reads the provider status
  and settles through the same idempotent provider-event and ledger path as
  sandbox. Duplicate callbacks return `DUPLICATE`; a provider-confirmed payment
  without a pre-expiry proof is quarantined.
- The worker reconciles live invoices that are open or expired within the last
  24 hours, so a lost callback settles on a later tick through the same proof
  and idempotent settlement path. The provider proof time decides late
  settlement: a payment made before expiry can still settle after a local
  expiry, while a payment at or after expiry is quarantined. No refund, payout,
  KYB, merchant credential isolation or failover is implemented.
- One deployment uses one global live provider account. Blink and Strike are
  custodial accounts, not merchant-owned nodes.

Provider-specific verification:

- LNbits: `POST /providers/lnbits/webhook?token=…` accepts only
  `{ "payment_hash": "…" }`; the token is compared in constant time.
- Blink: `POST /providers/blink/webhook` validates Svix `svix-id`,
  `svix-timestamp` (five minute window) and `svix-signature` over the raw body.
  Only `receive.lightning` events are settled automatically.
- Strike: `POST /providers/strike/webhook` validates `X-Webhook-Signature` as
  HMAC-SHA256 over the raw body, resolves the receive-request id to a payment
  hash, and verifies the completed receive and BTC amount.
- Do not enable live without the operational, custody and compliance work in
  [SECURITY](SECURITY.md).

### Planned shared-live surface

Shared live tenancy is not implemented. The reference has one live-provider slot
and one global live account per deployment; use one dedicated instance per live
merchant until the gates in [TENANCY](TENANCY.md) pass. The planned contract adds:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/provider-connections` | Tenant-scoped connection metadata, health and masked fingerprint; never a secret |
| POST | `/v1/provider-connections` | Create an `UNVERIFIED` connection; credentials are write-only |
| POST | `/v1/provider-connections/:id/verify` | Provider-authenticated account and permission check |
| PATCH | `/v1/provider-connections/:id` | Change priority/label or disable; no secret read |
| POST | `/v1/provider-connections/:id/rotate-credentials` | Add a new credential version with bounded overlap |
| POST | `/v1/provider-connections/:id/webhook-token/rotate` | Rotate the opaque callback token and stop the old URL |

The shared callback should use an opaque connection token, for example
`POST /v1/provider-webhooks/:token`, resolve the connection and tenant, verify the
provider signature over the raw body, deduplicate at
`(provider_connection_id, provider_event_id)`, and re-query provider status. It
must never trust a merchant id in the payload or fall back to a global
credential. Existing `/v1/providers/{provider}/webhook` routes remain for
dedicated deployments.

Planned failures: `PAY_CONNECTION_NOT_FOUND`, `PAY_CONNECTION_SCOPE`,
`PAY_CONNECTION_UNAVAILABLE`, `PAY_LIVE_NOT_ACTIVATED` and
`PAY_WEBHOOK_UNKNOWN_CONNECTION`. Cross-tenant references remain not-found.

### Organization plans and entitlements (sandbox reference)

PAY-F31 is a sandbox reference slice. Billing plans are seeded in migration
`0007_pay_plans.sql`; prices are illustrative SAT values, not market prices.
`GET /plans` is public. `POST /subscriptions` requires `keys:write` and creates a
provider invoice with the selected plan; it does not activate the plan.

| Method | Path | Purpose | Feature |
| --- | --- | --- | --- |
| GET | `/plans` | List active plans and limits | PAY-F31 |
| POST | `/subscriptions` | Create a pending subscription and invoice | PAY-F31 |
| GET | `/entitlements/current` | Read the active or expired entitlement | PAY-F31 |
| POST | `/sandbox/subscriptions/:id/settle` | Sandbox provider proof, activation and entitlement issue | PAY-F31 |

A subscription request names a plan code:

```json
{ "plan_code": "workspace_pro" }
```

The response includes `status=PENDING_PAYMENT`, the plan, amount and a mock
Lightning invoice. Activation requires the sandbox settle route with the sandbox
token and an authenticated key. That route verifies the provider invoice and
then, in one transaction, marks the subscription `ACTIVE`, issues the versioned
entitlement and records an audit event.

An entitlement is a versioned, read-only object:

```json
{
  "object": "entitlement",
  "organization_id": "org_...",
  "plan": "workspace_pro",
  "features": ["core", "audit_export", "advanced_roles"],
  "limits": { "members": 25, "retention_days": 365, "ai_collaborators": 1 },
  "status": "ACTIVE",
  "valid_from": "2026-11-14T00:00:00Z",
  "valid_until": "2026-12-14T00:00:00Z",
  "revision": 1,
  "source": "subscription",
  "request_id": "req_..."
}
```

An organization with no subscription gets a synthetic `workspace_free`
entitlement with `source=default_free` and revision `0`. The entitlement contains
no role, owner flag, API key or payment credential. Consumers may cache it only
for its bounded validity window. A missing, expired or unverified entitlement
must not activate a new paid feature.

## 3. Webhook events

| Event | Meaning |
| --- | --- |
| `payment.created` | Intent and invoice created |
| `payment.pending` | Invoice issued and awaiting payment |
| `payment.succeeded` | Provider-confirmed settlement and ledger posting |
| `payment.failed` | Provider-confirmed failure |
| `payment.expired` | Invoice or intent expired unpaid |
| `invoice.created` | Invoice record created |
| `invoice.settled` | Invoice settled and bound to a transaction |
| `refund.succeeded` | Refund recorded and reversal entries posted |
| `settlement.completed` | Settlement period or payout completed |
| `settlement.failed` | Settlement failed and needs review |

Event envelope: `id`, `type`, `api_version`, `created_at`, `livemode`,
`merchant_id`, `data`. `data` carries the intent, invoice or settlement and
never a secret key or customer personal data beyond the agreed contract.

### Signature and delivery

Headers: `BitOS-Pay-Event-Id` (stable event identity), `BitOS-Pay-Event-Type`,
`BitOS-Pay-Delivery-Id` (one per attempt), `BitOS-Pay-Timestamp` (Unix seconds)
`BitOS-Pay-Signature` = `v1=<hex HMAC-SHA256(timestamp + "." + raw_body)>`, and,
during a rotation grace window, `BitOS-Pay-Signature-Previous` with the same
timestamp and body signed by the old secret.

Consumers must: verify the signature with the endpoint secret, reject a
timestamp outside a five-minute window, deduplicate by event id, process
idempotently, and return any 2xx quickly. During rotation, verify the primary
signature with the new secret or the previous-signature header with the old
secret, then remove the old secret before its expiry. Retries use exponential backoff with
jitter (illustrative: immediate, 30s, 2m, 10m, 30m, 2h, 6h, 24h). Exhausted
deliveries become `DEAD`. The reference exposes the delivery log at
`GET /webhook-deliveries`, replay at `POST /webhook-deliveries/:id/replay`, and
disable at `POST /webhook-endpoints/:id/disable`. Delivery logs retain event id,
attempt count, response code and an error string; they never return the signing
secret. `POST /webhook-endpoints/:id/rotate` returns the new `whsec_` secret once
and `previous_secret_expires_at`; the old secret remains valid only for dual
signing until that time. Rotating again before expiry replaces the previous
secret, so only the immediately prior secret is dual-signed. Rotating an inactive
endpoint is rejected.

Webhook delivery does not prove payment; provider reconciliation is final.

## 4. Error groups

| Group | HTTP | Meaning |
| --- | --- | --- |
| `PAY_AUTH_*` | 401/403 | Missing, invalid, revoked, expired or under-scoped key |
| `PAY_VALIDATION_*` | 400 | Malformed body, bad amount, missing scale, unsupported currency |
| `PAY_NOT_FOUND_*` | 404 | Unknown or out-of-scope resource |
| `PAY_STATE_*` | 409 | Illegal transition, paid cancel, expired settlement |
| `PAY_IDEMPOTENCY_*` | 409 | Key reuse with different content |
| `PAY_TENANT_*` | 403 | Authenticated but wrong organization |
| `PAY_REFUND_*` | 409 | Refund exceeds the unrefunded amount |
| `PAY_RISK_*` | 403/429 | Amount/volume limit, velocity or inactive merchant |
| `PAY_ONBOARDING_*` | 403 | Sandbox onboarding is disabled |
| `PAY_NOT_FOUND_PLAN` | 404 | Unknown plan |
| `PAY_NOT_FOUND_SUBSCRIPTION` | 404 | Unknown or out-of-scope subscription |
| `PAY_NOT_FOUND_ENTITLEMENT` | 404 | No entitlement when one is required |
| `PAY_QUOTE_*` | 422 | Missing, stale or unsupported quote |
| `PAY_PROVIDER_*` | 502/503 | Provider unavailable or returned an unverified state |
| `PAY_RATE_*` | 429 | Rate limit; `Retry-After` included |
| `PAY_WEBHOOK_*` | 400 | Invalid endpoint URL, event filter or secret state |

Error body: `{ "error": { "type", "code", "message", "request_id" } }`. Codes are
stable within `v1`; messages are human-readable and may change.

## 5. SDK surface

| Package | Scope | Timing |
| --- | --- | --- |
| `@bitos/pay-js` | Server-side intents, invoices, refunds, payment links, settlements, webhooks, rotation and signature verification | Reference in [`../sdk`](../sdk) |
| `@bitos/pay-nuxt` | Nuxt server routes, composables, checkout components | First |
| `@bitos/pay-node` | Node server helpers and typed webhook handler | Later |
| `@bitos/pay-react` | React checkout component and status hook | Later |

The reference `@bitos/pay-js` client is server-side only, has zero runtime
dependencies, covers the typed operations above and verifies webhook signatures
against the raw body. It generates idempotency keys for create calls when the
caller does not supply one. A browser-side client may read the status of its own
intent through a short-lived token; it may not create intents, cancel payments or
hold a secret key. SDK retries never retry an unsafe operation without the same
idempotency key.

## 6. Versioning

`v1` is additive: new optional fields and events are allowed. Removing a field,
changing a state name or changing signature input requires a new major version
and consumer migration. Deprecation has a dated notice and no silent removal.

See [INTEGRATION](INTEGRATION.md) for composition and [TESTING](TESTING.md) for gates.
