# Run the BitOS Pay reference core

Status: **Reference / synthetic sandbox by default.** One Node process serves the
REST API; the static reference UI is served separately. Live LNbits, Blink and
Strike adapters are opt-in, but this is not a production payment service and no
live pilot is claimed. Pay does not maintain balances or custody; provider
accounts may be custodial. No payout, KYB or production reconciliation is
implemented.

## 1. What runs

```text
http://127.0.0.1:8788/
  /healthz                              liveness
  /readyz                               PostgreSQL connectivity
  /openapi.json                         OpenAPI 3.1 description
  /v1/payment-intents                   create (POST); read/cancel by id
  /v1/payments                          merchant-scoped cursor list + filters
  /v1/invoices                          direct create (POST); read by id
  /v1/transactions                      settled transactions with cursor/status
  /v1/refunds                           refund a settled transaction; list/read
  /v1/balances                          ledger-derived balances
  /v1/merchants/me                      authenticated merchant profile
  /v1/settlements/summary               period gross/fees/net + ledger check
  /v1/settlements/reconcile             store a reconciled period
  /v1/settlements/:id                   read a stored settlement record
  /v1/webhook-endpoints                 register, list and disable endpoints
  /v1/webhook-deliveries                delivery log and replay
  /v1/api-keys                          list/create/revoke scoped keys
  /v1/exchange/quotes                   sandbox SAT/LAK quote snapshots
  /v1/sandbox/invoices/:hash/settle     sandbox provider simulation only
```

The static reference UI is in [`../ui`](../ui). It is synthetic and does not call
the API.

### Reference implementation layout

The service is split by responsibility so HTTP, orchestration, domain rules and
storage can change independently:

```text
src/
  config.ts                 environment parsing
  container.ts              composition root
  domain/                   pure types, money, state machine, ledger, signatures
  application/              use cases and ports
    ports/                  Lightning provider and secret-box interfaces
    payment-intent-service  create/read/cancel/list intents and invoices
    settlement-service      provider proof, ledger posting, quarantine
    refund-service          refund ceiling, reversal entries and event
    risk-service            merchant status, amount and velocity checks
    settlement-reporting    period summaries and reconciliation records
    expiration-service      expiry transitions
    webhook-service         endpoints, delivery, log, replay and disable
    api-key-service         scoped key create/list/revoke
    quote-service           sandbox LAK/SAT quote snapshots
    auth-service            API-key authentication and scopes
    console-session-service reference console login, CSRF and key revalidation
    nostr-auth-service      NIP-07 challenge, signature verification and linking
    provisioning-service    synthetic merchant bootstrap
  infrastructure/           adapters
    db/                     database interfaces, PostgreSQL/PGlite, migrations
    repositories/           merchant, payment, ledger, refund, webhook,
                            quote, settlement-report and audit SQL
    providers/              mock, LNbits, Blink and Strike adapters
    crypto/                 AES-256-GCM webhook-secret box
  api/                      Fastify only
    app.ts                  Fastify instance, logger and security headers
    plugins/                error mapping
    routes/                 one module per resource
    schemas/                reusable request schemas
    openapi.ts              OpenAPI 3.1 description
    presenters.ts           domain-to-JSON mapping
  main/                     server, seed and migration entry points
```

`domain/` has no database, HTTP or provider imports. `application/` depends on
repository and provider ports. `infrastructure/` implements those ports.
`api/` authenticates, validates the request shape, calls one use case and
presents the result. The Fastify route schemas reject malformed bodies before the
domain sees them; domain validation still runs because HTTP validation is not
authority.

## 2. Prerequisites

- Node.js 24 or newer (`node --version`)
- pnpm 11 or newer (`pnpm --version`)
- No external database is required for the local reference: the default
  gitignored `service/.env` uses embedded PGlite at `pglite://./data/pglite`.
- PostgreSQL 14 or newer is optional for the PostgreSQL integration suite and
  production-like deployments.

`DATABASE_URL=pglite://./data/pglite` persists local data under the gitignored
`service/data/` directory. Use `pglite://memory` for a disposable database.
PGlite is a development dependency; a production deployment should use
PostgreSQL through `PgDatabase`.

## 3. Install and migrate

From the repository root, using the configured PGlite or PostgreSQL database:

```sh
pnpm install
pnpm --filter @bitos/pay-core migrate
```

The migration is additive and creates the configured schema (`pay` by default).
All migrations are covered by PGlite in tests. PostgreSQL integration evidence is
opt-in and requires a reachable `DATABASE_URL`. `0003` adds merchant risk limits, refund
records and the `ledger_entries.refund_id` link. `0004` adds hashed console
sessions. `0005` adds linked NIP-07 identities, one-time challenges and session
authentication metadata. `0006` adds the nullable organization `subject_ref` and `created_via` onboarding
marker. `0007` adds seeded plans, subscriptions and entitlements. `0008` adds
`owner_pubkey` and one-time onboarding challenges. Migrations are covered by PGlite; `0001`-`0009` also have live
PostgreSQL integration evidence when `PAY_RUN_INTEGRATION=1` and a PostgreSQL `DATABASE_URL` are provided.

Risk defaults are `PAY_RISK_MAX_PAYMENT_MSAT`, `PAY_RISK_DAILY_VOLUME_MSAT` and
`PAY_RISK_MAX_PAYMENTS_PER_MINUTE`; see [`../service/.env.example`](../service/.env.example).
Existing merchants use the defaults added by `0003`.

## 4. Create a sandbox account or seed a merchant

For the reference onboarding API, set `PAY_ONBOARDING_ENABLED=1`, restart, then:

```sh
curl -sS -X POST http://127.0.0.1:8788/v1/onboarding/sandbox \
  -H 'content-type: application/json' \
  -d '{"organization_name":"Demo","merchant_name":"Demo Merchant","country":"LA"}'
```

The response contains the only copy of a `bp_test_` key. This route is disabled
by default, limited per IP and cannot create live capability or a verified
merchant. It does not create an ID workspace.

To seed a fuller reference merchant, run the seed command below.

### 4.1 Plans and entitlements (sandbox)

`GET /v1/plans` lists seeded plans. With a sandbox key:

```sh
curl -sS -X POST http://127.0.0.1:8788/v1/subscriptions \
  -H "authorization: Bearer $PAY_TEST_KEY" \
  -H 'content-type: application/json' \
  -d '{"plan_code":"workspace_pro"}'
```

The response is `PENDING_PAYMENT` with a mock invoice. Settle it through the
sandbox token route, then read `GET /v1/entitlements/current`:

```sh
curl -sS -X POST "http://127.0.0.1:8788/v1/sandbox/subscriptions/$SUBSCRIPTION_ID/settle" \
  -H "authorization: Bearer $PAY_TEST_KEY" \
  -H "x-sandbox-token: $PAY_SANDBOX_TOKEN"
```

Prices are illustrative SAT values. This is not recurring live billing, and a
plan never changes merchant verification, ownership or roles.

### 4.2 Link a BNOS workspace

The BNOS Svelte app links its active organization from
**Settings → Billing → BitOS Pay** when
`PUBLIC_BITOS_PAY_URL=http://127.0.0.1:8788` is set in the BNOS environment.
The owner signs a one-time challenge with a `subject=bnos:<organizationId>`
tag; Pay provisions the sandbox account once and stores the mapping in
`organizations.subject_ref`. Add the BNOS origin to `PAY_CORS_ORIGINS`
(comma-separated exact origins); CORS is disabled when it is empty.

Later syncs update the workspace/merchant names and return the existing mapping
without reissuing the key. The owner key proves control only; it does not prove
a legal business or BNOS server attestation. The BNOS connection and sandbox key
are stored per workspace on that device, never in a relay event.

### 4.3 Seed a synthetic merchant

```sh
pnpm --filter @bitos/pay-core seed
```

Example shape (identifiers and key are generated; the key is shown once):

```json
{
  "schema": "pay",
  "organization_id": "org_...",
  "merchant_id": "mer_...",
  "provider_connection_id": "pc_...",
  "api_key": "bp_test_...",
  "livemode": false,
  "webhook": null
}
```

Store the printed `api_key` in a secret manager or a temporary shell variable.
Never commit it or paste it into a browser page. Re-run seed after a scope change:
existing keys keep the scopes they were created with, so an older key may not
access the new developer endpoints.

Set `PAY_SEED_WEBHOOK_URL=http://127.0.0.1:9000/hook` to also register a synthetic
webhook endpoint and print its `whsec_...` secret once.

Seed creates a new organization and merchant. For a live seed key, set the live
adapter first and run:

```sh
PAY_SEED_LIVEMODE=1 pnpm --filter @bitos/pay-core seed
```

The output then has `"livemode": true` and an `api_key` beginning `bp_live_`.
Stop a local PGlite server first if the seed cannot open the database.

### 4.4 Create another API key from the CLI

Use an existing key with `keys:write`; the created key inherits the live/sandbox
mode of the calling key and is returned once:

```sh
export PAY_KEY="bp_test_..."   # or bp_live_...
curl -sS -X POST http://127.0.0.1:8788/v1/api-keys \
  -H "authorization: Bearer $PAY_KEY" \
  -H "content-type: application/json" \
  -d '{"scopes":["payments:read","payments:write"],"expires_in_days":90}'
```

Omit `scopes` for the full scope set and `expires_in_days` for no expiry. A
`bp_test_` caller creates a `bp_test_` key; a `bp_live_` caller creates a
`bp_live_` key. Store the returned `key` immediately; listing keys never returns
the secret. The console **Settings → API keys** form uses the same endpoint.

## 5. Start

```sh
pnpm --filter @bitos/pay-core dev   # watch mode
pnpm --filter @bitos/pay-core start
```

Expected output:

```text
{"event":"server.listening","host":"127.0.0.1","port":8788,"schema":"pay","sandbox":true,"worker_interval_ms":5000}
```

`PAY_AUTO_MIGRATE=1` runs migrations at startup for the local reference. Keep it
`0` outside disposable environments.

### 5.1 Open the static demo UI

The demo UI has no build step and no API connection:

```sh
python3 -m http.server 8899 --bind 127.0.0.1 --directory bitos-pay/ui
```

Open `http://127.0.0.1:8899/`. It uses synthetic data, shows an explicit sandbox
banner and supports English/Lao and dark/light themes. The checkout supports
simulated pending/checking/paid/expired states and a printable receipt. It is
not a production checkout and must not be presented as one.

Static asset and script check:

```sh
node bitos-pay/ui/check.mjs
```

### 5.2 Open the live merchant console

The same Fastify process serves the reference console at
`http://127.0.0.1:8788/console/`. Use **Sign in** or **Create account**. Both accept a browser
signer, **Remote signer**, or **Use nsec**. One signed five-minute kind `22242`
challenge either signs in an existing key or, when `PAY_ONBOARDING_ENABLED=1`,
creates a sandbox organization, merchant, `bp_test_` key and linked signer
identity. Create mode opens the optional workspace names and hides API-key login;
reusing an existing key signs in and shows a notice instead of creating a
duplicate. A new account lands directly in the console with the one-time key shown
once in **Workspace ready**. Optional workspace and merchant names are collapsed;
leave them blank to derive names from the key. The API-key form is collapsed under
**I already have an API key**.

With `PAY_CONSOLE_ALLOW_NSEC=1`, the local worker signs the challenge; the nsec is
cleared after signing and is never sent to the service. In the same mode, **Create
account** can generate a new nsec/npub in the browser, show the npub, mask the
nsec until revealed, offer copy and a plaintext backup download, and keep creation
disabled until the operator confirms the backup. Only the signed challenge and
optional workspace names reach the service; the welcome panel shows both the
one-time `bp_test_` key and the npub. When
`PAY_CONSOLE_NOSTR_RELAY` is set, **Remote signer** accepts a `bunker://` URL or
shows a `nostrconnect://` QR for a NIP-46 signer. None of these paths creates a
live key, verified merchant or ID workspace. The browser keeps only an HttpOnly
session cookie and an in-memory CSRF token. In sandbox mode live `bp_live_` keys
are rejected; in live/both mode the key must match the selected environment.

Existing API-key merchants can still link a NIP-07 key from the console and use
**Continue with browser signer** afterwards. The linked key inherits the API-key
scopes; revoking that API key or merchant disables the sign-in.

Two opt-in adapters extend this:

- **Local nsec:** set `PAY_CONSOLE_ALLOW_NSEC=1`. The nsec is passed to a
  same-origin Web Worker, never to the service, is not stored, and is cleared
  after signing. This is disabled by default because any page compromise can
  still steal the key; prefer NIP-07 or NIP-46.
- **NIP-46 remote:** set `PAY_CONSOLE_NOSTR_RELAY` to the relay used by the
  bunker (`wss://…`). Paste a `bunker://` URL, or select **Show QR** to scan a
  `nostrconnect://` URI, then approve the connection in the remote signer. The QR
  has an ephemeral client key and requests only `sign_event:22242`. The browser
  CSP permits only the configured relay origin.

Rebuild the generated browser signer bundles after changing signer source:

```sh
pnpm --filter @bitos/pay-ui build:signers
```

The generated `scripts/nostr-worker.js`, `scripts/nostr-signer.js` and real
`scripts/qr.js` are checked in so the console remains build-free at runtime.

The console shows payments, balances, the 24-hour settlement summary, API keys
and webhook delivery state. Its environment is selected by
`PAY_CONSOLE_MODE=sandbox|live|both`; `both` shows a Sandbox/Live toggle in the
topbar. Switching an authenticated session signs out and requires a key for the
selected mode. It can create an intent in the selected mode, create or revoke
scoped keys, register, disable or replay webhooks and manage Nostr login. It does
not provide production login, MFA, documentation search, staff roles or merchant
onboarding.

Relevant settings:

```sh
PAY_CONSOLE_ENABLED=1
PAY_CONSOLE_MODE=both
PAY_CONSOLE_COOKIE_SECURE=0
PAY_CONSOLE_SESSION_TTL_SECONDS=28800
PAY_CONSOLE_ALLOW_NSEC=0
# PAY_CONSOLE_NOSTR_RELAY=wss://relay.example
```

Set `PAY_CONSOLE_COOKIE_SECURE=1` when the console is served over HTTPS. The
console is a reference adapter, not a production authentication system.

`PAY_CONSOLE_MODE=live` accepts only `bp_live_` keys and labels the console
**Live**. It creates real invoices through the configured live provider; live
refunds and plan changes are not implemented. `PAY_CONSOLE_MODE=both` enables
the toggle and accepts either key, but the two modes remain separate sessions
and data. `PAY_CONSOLE_MODE=live` or `both` requires `PAY_LIVE_ENABLED=1`.
Sandbox onboarding remains available only in sandbox mode.

### 5.3 Live provider adapters (opt-in)

The service starts on the mock provider. Select exactly one live provider with
`PAY_LIGHTNING_PROVIDER=lnbits`, `blink` or `strike`, and set
`PAY_LIVE_ENABLED=1`. Missing provider settings fail startup. Sandbox merchants
always stay on the mock provider; live merchants use the selected live adapter.

Common limits for all three:

- Live invoices require positive whole-sat amounts; fractional-msat amounts are
  rejected rather than rounded.
- A provider callback is only a trigger. The service re-reads the provider
  status and, where the provider exposes it, the amount before posting a
  transaction. Blink does not restate the amount; the created invoice amount is
  bound to the stored intent.
- A provider callback is the fast path. The worker also reconciles live
  invoices that are `ISSUED` or became `EXPIRED` within the last 24 hours. It
  re-checks open invoices at most every 10 seconds and expired ones at most
  every 60 seconds. A missed callback therefore settles on a later status check
  through the same proof, provider-event and ledger path. The proof carries the
  provider payment time (Blink reads `transactionsByPaymentHash.createdAt`), so
  a locally expired invoice still settles when the payment happened before its
  expiry. A payment proven at or after expiry is quarantined and is not posted
  to the ledger.
- There is no live refund, payout, KYB, per-merchant credential, failover or
  reconciliation job. One deployment uses one global live account.
- Blink and Strike are custodial providers. Funds land in the configured
  account, not a merchant-owned node.
- `PAY_SEED_LIVEMODE=1` works with whichever live adapter is selected; it issues
  a `bp_live_` key and does not register the provider callback.

For more than one live merchant, use one dedicated instance per merchant with
its own database, domain, provider account and secrets until the shared-live
gates in [TENANCY](TENANCY.md) have dated evidence. Do not pool merchants in one
Blink/Strike account. The reference does not technically block a second live
merchant, so this is an operating rule, not an enforced invariant.

To operate the console against the live account, set
`PAY_CONSOLE_MODE=live` (or `both` for the toggle) and restart the service, then
sign in with the `bp_live_` key. The live console can create and cancel invoices
and manage keys, webhooks, members and locations. It cannot refund, change a
plan, self-onboard a live merchant or verify a business. Never expose a live key
in browser storage or logs; prefer a linked Nostr identity after the first
live-key sign-in.

#### LNbits

```sh
PAY_LIGHTNING_PROVIDER=lnbits
PAY_LIVE_ENABLED=1
PAY_LNBITS_URL=https://lnbits.example
PAY_LNBITS_API_KEY=replace-with-a-live-key
PAY_LNBITS_WEBHOOK_SECRET=replace-with-at-least-16-random-characters
```

Register `https://<pay-host>/v1/providers/lnbits/webhook?token=<PAY_LNBITS_WEBHOOK_SECRET>`
in LNbits. The callback body only needs `payment_hash`. LNbits is the
self-hosted, node-backed option.

#### Blink

```sh
PAY_LIGHTNING_PROVIDER=blink
PAY_LIVE_ENABLED=1
PAY_BLINK_API_KEY=replace-with-a-blink-api-key
PAY_BLINK_WALLET_ID=replace-with-a-btc-wallet-id
PAY_BLINK_WEBHOOK_SECRET=whsec_replace-with-the-svix-signing-secret
# Optional; this is the default:
PAY_BLINK_API_URL=https://api.blink.sv/graphql
```

Create a Blink API key with **Read** and **Receive** access (Read is needed for
the status and receive-time queries) and read the BTC wallet ID from the Blink
API or dashboard. Add a callback endpoint in the Blink dashboard or with the
`callbackEndpointAdd` GraphQL mutation:

```text
https://<pay-host>/v1/providers/blink/webhook
```

The callback is signed by Svix. The signing secret is generated by Blink's Svix
tenant, not by this repository, and it is not returned by the Blink GraphQL
`callbackEndpointAdd` mutation (that returns only the endpoint id). To retrieve
it:

1. Open the Blink Dashboard and select **Callback Endpoints**.
2. Use **Callback Portal** to open the Svix application portal for the account.
3. Copy the endpoint's signing secret (`whsec_...`).
4. Set `PAY_BLINK_WEBHOOK_SECRET` to that value and restart the service.

If the portal is not available for the account, test the receiver with a
`play.svix.com` endpoint or contact Blink support; do not invent a secret, since
the route rejects every unsigned or incorrectly signed request. The route checks
`svix-id`, `svix-timestamp` (five minute window) and `svix-signature` against the
raw body. Only `receive.lightning` callbacks are settled automatically.
Intra-ledger callbacks and callbacks without a payment hash are ignored.

When the local service has no public HTTPS callback URL, leave the Blink
callback unconfigured and rely on the live status reconciliation described in
5.3. The paid invoice is still settled by the worker after the provider reports
`PAID`; the callback only makes it faster. This polling fallback is not a
substitute for a production callback, monitoring or provider reconciliation.

The adapter creates a Blink Lightning invoice in the configured BTC wallet,
reads status by payment hash, reads the receive time through
`transactionsByPaymentHash.createdAt` and cancels through `lnInvoiceCancel`.
Blink's status response does not restate the amount, so the amount is the one
bound to the created invoice; the service still checks the stored intent amount.
If the receive-time query is unavailable (for example, the key lacks Read), the
proof falls back to the processing time, so a locally expired invoice will not
recover and is quarantined instead.

#### Strike

```sh
PAY_LIGHTNING_PROVIDER=strike
PAY_LIVE_ENABLED=1
PAY_STRIKE_API_KEY=replace-with-a-strike-api-key
PAY_STRIKE_WEBHOOK_SECRET=replace-with-the-subscription-secret
# Optional; this is the default:
PAY_STRIKE_API_URL=https://api.strike.me/v1
```

Strike uses a BTC-denominated receive request. The API key needs receive-request
create/read access. Configure a Strike webhook subscription for
`receive-request.receive-completed` with this URL and the same secret:

```text
https://<pay-host>/v1/providers/strike/webhook
```

The route verifies `X-Webhook-Signature` as HMAC-SHA256 over the raw body,
resolves `data.entityId` to the receive request's payment hash and then verifies
the completed receive and BTC amount through the Strike API.

Strike has no receive-request cancellation endpoint in the adapter, so live
cancellation fails closed with `PAY_STATE_ILLEGAL`. Strike account availability,
country restrictions and KYC are provider-controlled. The adapter has only been
tested with mocked HTTP responses in this repository; it has not been run against
a funded Strike or Blink account.

### 5.4 Server-side SDK

[`../sdk`](../sdk) is the reference `@bitos/pay-js` client and webhook verifier:

```sh
pnpm --filter @bitos/pay-js typecheck
pnpm --filter @bitos/pay-js test
```

It is server-side only and has no runtime dependencies. It defaults to
`https://api.pay.bitos.space`; set `baseUrl: "http://127.0.0.1:8788"` for this
reference. See the [SDK README](../sdk/README.md).

## 6. Create and settle a payment

Create an intent (`Idempotency-Key` is required):

```sh
export PAY_KEY="bp_test_..."   # printed by seed
curl -sS http://127.0.0.1:8788/v1/payment-intents \
  -H "authorization: Bearer $PAY_KEY" \
  -H "content-type: application/json" \
  -H "idempotency-key: demo-intent-001" \
  -d '{
    "amount": 1000,
    "currency": "SAT",
    "scale": 0,
    "payment_method": "lightning",
    "external_reference": "BNOS-ORDER-001",
    "metadata": {"source": "local-demo"}
  }'
```

The response is `PENDING` and contains a synthetic `lnbcrt...` invoice and a
`payment_hash`. The mock provider is not a real Lightning node.

Simulate the provider settlement (sandbox token only):

```sh
export PAY_SANDBOX_TOKEN="$(grep '^PAY_SANDBOX_TOKEN=' bitos-pay/service/.env | cut -d= -f2-)"
curl -sS "http://127.0.0.1:8788/v1/sandbox/invoices/<payment_hash>/settle" \
  -H "x-sandbox-token: $PAY_SANDBOX_TOKEN" \
  -H "content-type: application/json" \
  -d '{}'
```

Then inspect the intent and the ledger-derived balance:

```sh
curl -sS "http://127.0.0.1:8788/v1/payment-intents/<intent_id>" \
  -H "authorization: Bearer $PAY_KEY"
curl -sS http://127.0.0.1:8788/v1/balances \
  -H "authorization: Bearer $PAY_KEY"
```

A settled 1000 SAT payment with 0 fee posts one debit of `1000000` msat to
`provider_clearing` and one credit of `1000000` msat to `merchant_payable`. The
balance response is labeled `ledger_derived: true` and `wallet_balance: false`.

Refund a settled transaction in the sandbox (requires the `payments:refund`
scope and a unique idempotency key):

```sh
curl -sS http://127.0.0.1:8788/v1/refunds \
  -H "authorization: Bearer $PAY_KEY" \
  -H "content-type: application/json" \
  -H "idempotency-key: demo-refund-001" \
  -d '{"transaction_id":"txn_...","amount":400,"reason":"customer_request"}'
```

The refund posts opposite ledger entries and returns a separate `rfd_...` record.
A full refund leaves `provider_clearing`, `merchant_payable` and
`platform_fee_revenue` at zero. Live refunds fail closed because no real refund
provider is implemented.

## 7. Signed webhooks

Register an endpoint with `POST /v1/webhook-endpoints` and an `Idempotency-Key`:

```json
{
  "url": "http://127.0.0.1:9000/hook",
  "events": ["payment.succeeded", "payment.expired", "payment.quarantined"]
}
```

The response contains a `whsec_...` secret exactly once. Delivery headers:

```text
BitOS-Pay-Event-Id
BitOS-Pay-Event-Type
BitOS-Pay-Delivery-Id
BitOS-Pay-Timestamp
BitOS-Pay-Signature: v1=<hex HMAC-SHA256(timestamp + "." + raw_body)>
```

Consumers must verify the signature, reject timestamps outside five minutes,
deduplicate by event id and return a 2xx quickly. Retries run in-process with
exponential backoff; exhausted deliveries become `DEAD`. The reference exposes
the delivery log, replay and endpoint disable through the API. The reference
console can manage webhook endpoints and replay deliveries; there is no durable
queue, documentation browser or production developer console.

## 7.1 Merchant profile

Settings edits the merchant display name, support email and website. The name is
used on hosted checkout and payment-link pages; support details remain private.
`PATCH /v1/merchants/me` requires a key with `merchants:write`; the console also
requires CSRF. Validation rejects non-http(s) websites and malformed email.
Verification state stays read-only.

## 7.2 Reusable payment links

Create a fixed-amount link from the console or API, then open the returned
`/pay/plk_…` URL. Each customer gets a fresh intent and checkout. Creation is
limited per client IP per minute by `PAY_PAYMENT_LINK_RATE_LIMIT` (default 20);
the reference limiter is in-process, so a production edge must add its own.

```sh
curl -sS http://127.0.0.1:8788/v1/payment-links \
  -H "Authorization: Bearer $PAY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: link-demo-0001" \
  -d '{"amount":25000,"currency":"SAT","scale":0,"label":"Coffee"}'
```

## 7.3 Hosted checkout

`POST /v1/payment-intents` returns `checkout_url`. Open it in a browser or serve
the zero-build page directly:

```sh
curl -sS http://127.0.0.1:8788/v1/payment-intents \
  -H "Authorization: Bearer $PAY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: checkout-demo-0001" \
  -d '{"amount":25000,"currency":"SAT","scale":0,"payment_method":"lightning"}'
```

The returned URL is HMAC-signed and read-only. In the console, create a request
and use **Open checkout**; the page polls `/v1/checkout/:token` and never marks a
payment paid from browser input. In sandbox mode, settle with the sandbox token
and watch the page update after provider confirmation.

## 8. Tests

```sh
pnpm --filter @bitos/pay-core check:structure
pnpm --filter @bitos/pay-core typecheck
pnpm --filter @bitos/pay-core test
```

The test suite uses an in-process PostgreSQL-compatible database (PGlite) for the
reference integration tests. It does not replace a real PostgreSQL release test.
The Pay Core suite has 120 tests; the SDK has 11. The structure check covers the
domain, port, application, API and provider boundaries described in
[STRUCTURE](STRUCTURE.md). Blink and Strike adapter tests use mocked HTTP only;
see [EVIDENCE-2026-11-14](EVIDENCE-2026-11-14.md).

To run the real PostgreSQL integration test against the configured database:

```sh
PAY_RUN_INTEGRATION=1 pnpm --filter @bitos/pay-core test:integration
```

The integration test creates and drops a unique `pay_it_<timestamp>` schema. It
passed against PostgreSQL 16.14 on 2026-11-13 and needs an account that can create
and drop schemas. A separate live smoke run covers direct invoices, pagination, quotes, scoped
keys, settlement reporting, signed webhook delivery/replay/disable, refunds and
merchant risk limits. The console suite covers cookie login, CSRF, overview,
payment creation, key lifecycle, key-revocation fail-closed behavior and logout.

## 9. What is not implemented

- A real Lightning provider or node; the only adapter is `MockLightningProvider`.
- Production dashboard, checkout, developer console and Nuxt/React/node wrappers.
  `@bitos/pay-js` is a server-side reference; the demo
  pages in `../ui` are synthetic. `/console/` is a reference API-key/NIP-07
  console with opt-in local nsec and relay-gated NIP-46 adapters, not production
  login, MFA or production signer custody.
- Fiat payment and real LAK pricing; only synthetic SAT/LAK quote snapshots exist.
- Payouts and provider-history reconciliation jobs. Refunds only post a local sandbox reversal; no bitcoin moves.
- BNOS order integration; webhook payloads are generic and additive.
- A funded live Blink/Strike run, per-connection polling, provider-history
  reconciliation, failover or callback monitoring. The worker polls only the one
  global live account and a bounded expiry lookback.
- Admin APIs for changing risk limits, merchant roles/MFA, atomic key rotation, a secret manager and a durable queue. Per-merchant limits are seeded/config values only.
- ID workspace creation and the ID-to-Pay organization mapping; sandbox and
  Nostr onboarding leave `subject_ref` null. `owner_pubkey` is not a global ID.
- Recurring live plan billing and plan refunds. PAY-F31 has seeded plans, a
  sandbox subscription/entitlement API and a console plan card, but no live
  billing.
- Hosted custody, stored balances or any real-money handling.
- Shared live multi-tenant deployment, per-merchant provider connections or
  pooled merchant funds. Use a dedicated instance per live merchant until the
  [TENANCY](TENANCY.md) gates pass.

## 10. Reset the reference database

Drop only the synthetic schema after stopping the process:

```sh
psql "$DATABASE_URL" -c 'DROP SCHEMA IF EXISTS pay CASCADE;'
```

Never run that against a schema containing data you did not create.
