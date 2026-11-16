# BitOS Pay — deployment topology and shared-live tenancy

Status: **Spec + planned deployment target.** No shared live multi-merchant
deployment exists. The reference has one live-provider slot per deployment and
one global live account. Dedicated per-merchant deployment is the safe choice
until the gates in this document have dated evidence.

This document answers one question: **when a new customer appears, do we deploy
a new app?** It defines the difference between a payer, a merchant and a
deployment, then records the requirements for eventually serving many live
merchants from one shared deployment.

## 1. Recommendation first

- **Payer / end customer:** do **not** deploy a new app. One merchant deployment
  serves any number of payers.
- **One live merchant now:** deploy the **same codebase** as a dedicated
  single-tenant instance. Do not fork the app.
- **Many sandbox merchants:** a shared deployment is acceptable when it has no
  real funds and no live provider credentials.
- **Many live merchants in one deployment:** **not supported yet.** It requires
  connection-scoped credentials, webhook routing, tenant enforcement, KYB/live
  activation, reconciliation/failover and isolation evidence.
- **Long-term target:** shared control plane plus connection-scoped live payment
  runtime, or fully shared live tenancy after the gates pass. A dedicated
  database or runtime remains available for high-risk merchants.

The reason is not only code size. A live merchant is a **funds, credential,
webhook and regulatory boundary**. A new customer is a new tenant, not a new
application source tree.

## 2. Terms

| Term | Meaning here |
| --- | --- |
| **Payer / customer** | The person paying a merchant. A payer never gets a deployment. |
| **Merchant** | The business collecting payment. It belongs to one organization. |
| **Organization / tenant** | The isolation boundary for merchants, keys, users, connections, transactions and ledger accounts. |
| **Deployment / instance** | One running Pay service with its own database, domain, secrets and provider configuration. |
| **Dedicated single-tenant deployment** | One live merchant per deployment, even if the schema is multi-tenant internally. |
| **Shared multi-tenant deployment** | One deployment serves several organizations or live merchants. |
| **Provider connection** | A binding to a specific provider account, node or wallet, with its own credentials, webhook secret and status. |
| **Connection token** | An opaque, high-entropy routing token used by a provider callback URL. It identifies a connection, not a merchant authority. |
| **Live activation** | A reviewed state that permits live keys and live invoices for one merchant. It is not granted by a plan payment, Nostr login or UI toggle. |

## 3. Deployment modes

| Mode | Isolation | Funds | Appropriate now | Status |
| --- | --- | --- | --- | --- |
| Dedicated single-tenant | Separate deployment, database, domain, secrets and provider account | Merchant's provider account or node; Pay records evidence | Yes, for the first real merchant(s) | Recommended reference deployment |
| Shared sandbox | Shared deployment and database, synthetic data only | None | Yes | Reference-compatible |
| Shared live multi-tenant | Shared deployment; logical tenant isolation; connection-scoped credentials | Must not commingle merchant funds | No | Planned; blocked by gates |
| Hybrid control plane + dedicated live runtime | Shared metadata/control surface; isolated live payment runtime for each merchant or risk tier | Merchant-scoped | Later | Planned |
| Merchant self-hosted | Merchant controls database, secrets and provider | Merchant-controlled | Later | Planned |
| Hosted custodial | BitOS holds or controls funds | Pooled or managed by BitOS | No | Blocked (PAY-D01) |

**Do not deploy a new application codebase per customer.** Deploy the same
image with a different configuration, database and secrets. A fork creates
version drift, duplicated security patches, divergent migrations and an
unmaintainable support matrix.

## 4. What the reference supports today

The reference is useful as a dedicated deployment but is not a shared live
merchant service:

- `organizations`, `merchants`, `provider_connections`, payments, keys and
  ledger rows carry tenant columns, and the data model requires tenant-scoped
  queries (DM-05).
- Live provider selection is **global to the deployment**:
  `PAY_LIGHTNING_PROVIDER=lnbits|blink|strike`, `PAY_LIVE_ENABLED=1` and one
  credential set. Sandbox merchants use the mock provider.
- `provider_connections` exists but is created with `credential_ref = NULL`.
  Payment creation chooses the first `ACTIVE` connection for the key's mode;
  the adapter itself is still selected from deployment configuration.
- Provider webhook routes are deployment-level:
  `/v1/providers/lnbits/webhook`, `/v1/providers/blink/webhook` and
  `/v1/providers/strike/webhook`.
- There is no KYB, live activation record, per-merchant credential,
  per-connection polling worker, provider-history reconciliation job, failover
  policy or per-merchant fund isolation. The single global live account does
  have a worker that reconciles open and recently expired invoices by provider
  status and proof time.
- Blink and Strike are custodial provider accounts. A shared account pools funds
  across merchants even if the database rows are separate.
- The console defaults to sandbox. `PAY_CONSOLE_MODE=live` or `both` opts into
  live-key console sessions; live refunds, plan changes and self-onboarding
  remain unavailable.

Consequences:

1. One live merchant per deployment is safe **only** with its own provider
   account and scoped API keys.
2. Many live merchants on one deployment would share one provider account and
   one callback route. That is a funds and attribution defect, not a cosmetic
   limitation.
3. Shared sandbox is fine because no real money or live credential is involved.

The reference does **not** technically prevent a second live merchant from being
provisioned; all live merchants would use the same global adapter and account.
Treat one live merchant per deployment as an operating rule until the gates
below are implemented and evidenced. Do not rely on convention as a security
control.

## 5. Target request and callback flow

Shared live deployment must resolve the tenant and connection before creating or
settling anything:

```text
API key (mode + scopes)
  -> auth context (organization, merchant, livemode)
  -> selected provider connection (merchant, live, ACTIVE, verified)
  -> provider adapter with that connection's credentials
  -> invoice / payment attempt
  -> provider callback at opaque connection URL
  -> resolve connection + tenant
  -> verify provider signature over raw body
  -> deduplicate provider event at the connection
  -> re-query provider status
  -> settle ledger inside the organization transaction
```

Hard rules:

- The API key does not select a connection by client-supplied id. The server
  resolves it from the authenticated merchant, mode, status and policy.
- A callback payload never supplies the trusted merchant or organization id. The
  opaque connection token resolves it; the signature proves the provider sent
  the event.
- A callback is a trigger, never payment proof. The server re-queries the
  provider and verifies invoice/hash/amount binding before posting a ledger
  transaction.
- An already-issued invoice never silently changes provider, payee or
  connection. Failover applies to new payment intents only.
- A shared deployment must not fall back to a global credential when a
  connection is missing, disabled or unavailable.

## 6. Required capabilities

The six items below are the minimum shared-live gate. Each needs implementation,
tests, operational evidence and an owner; documentation alone is not evidence.

### 6.1 Per-merchant provider connections and encrypted credentials

A connection is a real provider account or node, not just a row that selects a
global adapter.

Required behavior:

- Each live connection belongs to exactly one organization and one merchant, or
  is explicitly organization-scoped for a shared account approved by a decision.
- For multi-merchant live payments, each merchant must have its own provider
  account, node or wallet. Separate credentials pointing at the same custodial
  Blink/Strike account do not isolate funds.
- Connection fields include provider, mode, scope, merchant, status, priority,
  health, provider account reference, credential reference, credential version,
  webhook secret reference, webhook token hash, last verified time and audit
  metadata.
- Credentials are submitted write-only, stored in a secret manager or encrypted
  with envelope encryption, and returned only as a masked fingerprint. They are
  never stored in plaintext in PostgreSQL, logs, fixtures, exports or browser
  state.
- Ciphertext is bound with authenticated additional data to the organization,
  connection, provider and purpose. A copied ciphertext cannot be replayed under
  another connection.
- The payment service identity may decrypt a connection secret. The console,
  support tools and read-only analytics cannot.
- A connection can be `UNVERIFIED`, `ACTIVE`, `DEGRADED` or `DISABLED`.
  `UNVERIFIED` and `DISABLED` cannot create live invoices.
- Verification performs a provider-authenticated read, checks account identity
  and permissions, and records the result. It does not mark a merchant as KYB
  verified.
- Credential rotation creates a new version, verifies it, promotes it, and keeps
  the old version decrypt-only for a bounded window before revocation.
- A deleted or compromised credential disables the connection and fails closed;
  it does not fall back to another merchant's connection.

Planned API surface (not implemented):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/provider-connections` | Tenant-scoped metadata, health and masked fingerprint; no secrets |
| POST | `/v1/provider-connections` | Create an `UNVERIFIED` connection; secrets write-only |
| POST | `/v1/provider-connections/:id/verify` | Provider-authenticated verification |
| PATCH | `/v1/provider-connections/:id` | Change priority, label or disable; never display a secret |
| POST | `/v1/provider-connections/:id/rotate-credentials` | New secret version and bounded overlap |
| POST | `/v1/provider-connections/:id/webhook-token/rotate` | Rotate the opaque callback token; old URL stops routing |

Production onboarding should prefer provider OAuth or a hosted secret-entry flow
over accepting raw provider keys through a general JSON API. Any credential
submission must be TLS-only, scoped, rate-limited, audit-logged and excluded from
request-body logging.

### 6.2 Connection-scoped webhook endpoint and token

Each live connection needs a callback identity that cannot be confused with
another merchant.

Required behavior:

- Use a high-entropy opaque token per connection, for example
  `POST /v1/provider-webhooks/:token`, or a provider-specific path plus an
  opaque token. Never use `merchant_id`, `organization_id` or a sequential id as
  the routing secret.
- Store only a hash of the token. The full callback URL is shown once when the
  connection is created or rotated.
- Resolve the token to one connection and tenant before reading provider
  payload fields.
- Verify the provider signature over the exact raw body: LNbits token, Blink
  Svix headers with timestamp, or Strike HMAC. A valid signature for connection A
  must never settle connection B.
- Deduplicate at `(provider_connection_id, provider_event_id)`. If a provider
  lacks a stable event id, use the provider event id header if present, otherwise
  a canonical event hash plus provider timestamp, and document the collision
  rule.
- Re-query provider status after signature verification. Do not settle from the
  callback body alone.
- Reject unknown/disabled connection tokens with a generic not-found response;
  do not reveal whether a merchant exists.
- Rate-limit the callback route and record rejected signatures, unknown tokens
  and duplicate events without logging secrets or full payloads.
- Keep the current provider-specific routes for dedicated single-tenant
  deployments. A shared deployment must use connection-scoped routing.

Planned table `provider_webhook_events`:

| Field | Purpose |
| --- | --- |
| `id` | Event row id |
| `organization_id`, `merchant_id`, `provider_connection_id` | Resolved tenant and connection |
| `provider_event_id` | Provider id or canonical fallback |
| `event_type` | Normalized event type |
| `body_hash` | Raw-body hash for evidence and dedup fallback |
| `received_at` | Receipt time |
| `status` | `RECEIVED`, `VERIFIED`, `DUPLICATE`, `REJECTED`, `SETTLED`, `QUARANTINED` |
| `failure_code` | Bounded reason, no secret |

Unique key: `(provider_connection_id, provider_event_id)`.

### 6.3 Tenant enforcement on every query, settlement and refund

Tenant scope is a server invariant, not a UI filter.

Required behavior:

- Authentication produces an explicit context:
  `organization_id`, `merchant_id`, `livemode`, scopes and actor. A request
  without a complete context is denied.
- Every repository read and write requires the organization/merchant scope.
  Avoid generic `findById(id)` methods that can be called without tenant scope.
- Cross-tenant access returns not-found, not a forbidden response that confirms
  the other tenant's record exists.
- Settlement loads the intent, attempt, invoice and connection by id **and**
  tenant, then verifies that the connection belongs to the same organization and
  merchant and that the mode matches.
- Refunds lock the original transaction by tenant, verify the unrefunded
  balance, and never let a connection or merchant from another tenant reverse
  the entry.
- Background jobs carry `organization_id` and `connection_id`; they reload and
  recheck scope rather than trusting the queue payload.
- PostgreSQL row-level security is defense-in-depth, not a replacement for
  application checks. If used, the service sets a transaction-local
  organization context and tests the policy.
- Add adversarial tests: merchant A key creates or reads merchant B intent,
  attempt, invoice, transaction, refund, connection, webhook, export and
  settlement; all must fail without leaking data.
- Exports, backups, logs and support tools preserve the same boundary. A
  platform admin view is a separate, audited authority path.

### 6.4 KYB, risk and per-merchant live activation

Live capability is a reviewed state, not a configuration accident.

Required behavior:

- A merchant starts `PENDING_VERIFICATION`; live activation requires an
  authenticated provider account, a verified connection, risk limits and the
  required business verification level (PAY-D08).
- Record `merchant_verifications` with level, provider/authority, status,
  evidence reference, reviewer, validity and expiry. Do not store identity
  documents in the payment database.
- Record a `live_activations` decision with actor, timestamp, scope, limits and
  reason. Revocation is a first-class action.
- A paid plan, Nostr pubkey, workspace membership or browser toggle never grants
  live capability (PAY-D15, PAY-D19).
- Sandbox keys and sandbox connections cannot create live invoices even when the
  deployment has live credentials (PAY-D20).
- Risk checks run before invoice creation: merchant status, amount, rolling
  volume, velocity, connection health and blocklists.
- Live activation fails closed when verification, provider account, connection
  status or risk state is unavailable. Keep core access and records available;
  deny new live payments.
- Provider KYB and Blink/Strike account ownership are separate from Pay's
  merchant verification; record both rather than conflating them.

### 6.5 Status polling, reconciliation and failover

Webhook delivery is not guaranteed. A shared deployment needs recovery paths.

Required behavior:

- A per-connection worker polls non-terminal attempts with authenticated
  provider status queries, bounded backoff, jitter and a circuit breaker.
- Polling has the same idempotent settlement path as callbacks. A callback and a
  poll racing must produce one transaction and one ledger entry.
- A reconciliation job imports provider history for a connection and matches by
  provider reference and payment hash. Unmatched payments are quarantined for
  review, never marked successful automatically.
- A payment proven after expiry is quarantined; a payment proven before expiry
  may recover a locally expired intent through verified settlement.
- Expiry and cancellation jobs are tenant-scoped and connection-aware.
- Failover is explicit: priority and health choose a connection for **new**
  intents only. Existing invoices stay bound to their original connection and
  are polled there. Never switch payee or provider silently.
- A degraded connection is visible in the console and operations dashboard.
  Merchants can be routed to a healthy connection only under a reviewed policy.
- If provider state is unknown, keep the intent `PENDING` and alert. Do not
  invent failure or success.
- Reconciliation produces a stored snapshot and an evidence trail suitable for
  settlement review.

### 6.6 Secret rotation, audit and data isolation

- Every provider credential and webhook secret has a version, owner, purpose,
  creation time and revocation time. Rotation is tested, not ad hoc.
- Webhook secret rotation supports a bounded dual-signature window, then rejects
  the old secret. The new secret is shown once.
- Provider connection creation, verification, credential rotation, webhook-token
  rotation, live activation, disablement and admin access append audit records
  with actor, tenant, connection, action and result. Audit records contain no
  secrets or full payment payloads.
- Cross-tenant denial, unknown callback tokens, signature failures and
  reconciliation mismatches produce security/operations events.
- Each tenant's data, exports and backups are retrievable without another
  tenant's data. Shared-database logical isolation is acceptable only with
  tested query scope, optional RLS and encryption; high-risk merchants may need
  a dedicated database or deployment.
- Secret-manager or KMS unavailability fails live payment creation closed.
  Sandbox may remain available if it uses no live secret.
- A compromised connection disables that connection and its webhook token,
  rotates credentials and reconciles its account; it does not require rotating
  every merchant's credentials in a shared deployment.

## 7. Data-model additions (planned)

These changes are **not implemented** in the reference migration set.

| Area | Planned change |
| --- | --- |
| `provider_connections` | Add `merchant_id` (nullable only for an explicitly approved org scope), `scope`, `credential_version`, `webhook_secret_ref`, `webhook_token_hash`, `priority`, `health`, `provider_account_ref`, `last_verified_at`, `disabled_at` |
| `provider_webhook_events` | New connection-scoped event/dedup table; unique `(provider_connection_id, provider_event_id)` |
| `merchant_verifications` | Verification level, authority, status, evidence ref, reviewer, validity, expiry |
| `live_activations` | Merchant/connection activation decision, limits, actor, reason, revoked_at |
| `secret_versions` or external secret manager | Versioned secret reference, purpose, status, rotation and revocation metadata; no plaintext |
| `audit_logs` | Require organization, actor, connection and action for every privileged connection/live mutation |
| `payment_intents` / `payment_attempts` | Keep the immutable connection id and record the routing decision/reason for audit; never rewrite an issued invoice's connection |

Additional invariants:

- **DM-19 Connection scope.** Every live connection has one organization and one
  merchant, or an explicitly approved organization scope. There is no global
  fallback.
- **DM-20 No commingled live funds.** A shared deployment must not route several
  merchants to one custodial account without an approved custody model. Separate
  credentials are not separate funds.
- **DM-21 Callback binding.** A provider event resolves its connection and tenant
  before payload trust, verifies the provider signature over raw bytes, and is
  unique per connection.
- **DM-22 Credential isolation.** Provider secrets are encrypted with
  connection-bound authenticated data, versioned and unreadable from the
  database or console.
- **DM-23 Live activation.** Live payment requires merchant verification, an
  active verified connection and a live activation decision. A plan payment does
  not grant it.
- **DM-24 Failover immutability.** An issued invoice stays on its original
  connection; failover selects a connection only for a new intent.
- **DM-25 Tenant query scope.** Every tenant read and write requires an explicit
  scope; a missing scope is an error, not a global query.

## 8. Rollout plan and evidence gates

### Phase A — real customer now

Deploy one dedicated instance per live merchant:

- Same image and repository; no fork.
- Separate PostgreSQL database, domain, TLS, secrets and provider account.
- Separate console credentials; live keys are restricted to server use.
- Backups, monitoring, alert owner and restore drill per instance.
- A shared sandbox deployment may remain separate and synthetic.
- No claim of shared live multi-tenancy.

### Phase B — connection backend

Build the connection-scoped backend while live merchants remain dedicated:

- Encrypted credential store and versioned connection metadata.
- Connection-scoped webhook tokens and event dedup.
- Tenant-scoped repositories and adversarial cross-tenant tests.
- API/console metadata views with masked fingerprints only.
- No live multi-merchant pilot yet.

### Phase C — shared live pilot

Only after Phase B evidence:

- Two or three merchants, each with its own provider account or node.
- KYB/risk and explicit live activation.
- Polling, reconciliation and failover tested under fault injection.
- Per-tenant export/restore and audit review.
- Security, legal and custody review for the actual account model.
- Capped value, manual reconciliation and a rollback plan.

### Phase D — hybrid and scale

- Shared control plane for merchant metadata and onboarding.
- Dedicated live runtime/database for high-risk merchants or regulatory needs.
- Self-hosted option for merchants that control their own node.
- Keep one payment state machine and one ledger contract; do not fork them.

### Gate checklist

| Gate | Acceptance evidence |
| --- | --- |
| G1 Connection isolation | Merchant A cannot read, cancel, settle or refund merchant B using any id or key |
| G2 Callback isolation | A valid callback for A cannot settle B; forged, replayed and unknown-token callbacks are rejected |
| G3 Credential isolation | Database, logs, exports and console show no plaintext; KMS/secret-store outage fails live closed |
| G4 Live activation | Unverified merchant, plan-only merchant and sandbox key cannot create a live invoice |
| G5 Recovery | Missed callback is recovered by polling exactly once; duplicate callback has no second effect |
| G6 Failover | New intents can use a healthy connection; existing invoices stay on the original connection |
| G7 Data isolation | Export, backup and restore for one tenant contain no other tenant's data |
| G8 Audit/rotation | Every connection/live mutation is attributable; old secrets stop working after the window |
| G9 External review | Security, legal and custody review match the actual provider-account model |

No gate is satisfied by a document, a mock test or a successful sandbox payment.
Each needs dated commands/results or a signed review.

## 9. Non-goals and anti-patterns

- Do not create a new application or fork per customer.
- Do not use one shared Blink/Strike account for several live merchants.
- Do not treat a plan payment, Nostr login or workspace role as KYB or live
  activation.
- Do not trust a merchant id, amount or success flag from a callback body.
- Do not let the browser or a redirect mark a payment paid.
- Do not use a global query or `findById` without tenant scope.
- Do not auto-fail an intent when provider state is unknown; quarantine it.
- Do not switch an issued invoice to another provider or payee.
- Do not introduce microservices before the modular monolith's boundaries and
  operational need justify the split (PAY-D21).
- Do not offer hosted custody or pooled merchant balances without PAY-D01 legal,
  reserve, accounting and licensing approval.
- Do not present the current reference as a production multi-merchant PSP.

## 10. Decision checklist for PAY-D24

Before enabling shared live tenancy, record answers with owners:

1. Is a connection merchant-scoped, organization-scoped, or both with an
   explicit policy?
2. Does every merchant own its provider account/node, or is a pooled account
   proposed? If pooled, what custody decision authorizes it?
3. What is the verification level and who approves live activation/revocation?
4. Which secret manager/KMS, key hierarchy, rotation window and break-glass
   process are used?
5. What is the failover policy, and how are existing invoices protected from
   payee changes?
6. What are the per-merchant limits, reconciliation cadence and quarantine
   procedure?
7. Which merchants get logical shared isolation versus a dedicated database or
   deployment?
8. What evidence closes G1–G9, and who signs the go/no-go?

See [ARCHITECTURE](ARCHITECTURE.md), [DATA-MODEL](DATA-MODEL.md),
[SECURITY](SECURITY.md), [OPERATIONS](OPERATIONS.md) and
[DECISIONS](DECISIONS.md). The current reference limits are in
[RUNNING](RUNNING.md). Implementation gates are PAY-T37 (connection-scoped
credentials and callbacks) and PAY-T38 (tenant isolation, live activation,
reconciliation/failover and evidence) in the [task board](../../docs/TASKS.md).
