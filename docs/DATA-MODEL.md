# BitOS Pay — data model

Status: **Spec + synthetic reference schema.** PostgreSQL is the intended source of truth. `service/migrations/0001`-`0014` implement a reference subset; it is not a production migration or a complete model. Money is always an integer; no float is permitted.

## 1. Entities

| Entity | Purpose | Key fields | Scope |
| --- | --- | --- | --- |
| `organizations` | Legal/business tenant | `id`, `name`, `country`, `status`, `subject_ref` (nullable; `bnos:<workspace_id>` for the sandbox BNOS link, otherwise reserved for ID), `owner_pubkey` (nullable; signer possession only), `created_via` | Tenant root |
| `merchants` | Collecting business | `id`, `organization_id`, `name`, `status`, `default_currency`, `support_email`, `website`, `fee_bps`, `max_payment_msat`, `daily_volume_msat`, `max_payments_per_minute` | Organization |
| `merchant_users` | Staff and roles | `merchant_id`, `subject_ref`, `role`, `status` | Organization |
| `merchant_locations` | Merchant branch registry | `id`, `organization_id`, `merchant_id`, `name`, `code`, `status`, `created_at`, `updated_at` | Merchant |
| `payment_methods` | Enabled rail per merchant | `merchant_id`, `rail`, `provider_connection_id`, `enabled` | Organization |
| `payment_links` | Reusable fixed-amount link | `id`, `organization_id`, `merchant_id`, `amount_msat`, `currency`, `scale`, `reference`, `label`, `status`, `created_at`, `disabled_at` | Merchant |
| `payment_intents` | Request to collect an amount | `id`, `merchant_id`, `external_reference`, `location_id`, `amount_msat`, `amount_minor`, `currency`, `scale`, `status`, `expires_at`, `retry_of_intent_id` | Organization |
| `checkout link` | Derived, not a table: HMAC-signed token over `payment_intent.id`; possession grants a read-only public projection | No stored secret; invalidated only by rotating `PAY_SECRET_KEY` or changing intent state | Payment intent |
| `payment_attempts` | One provider interaction | `id`, `payment_intent_id`, `provider_connection_id`, `provider_reference`, `status`, `failure_code` | Organization |
| `invoices` | Lightning invoice binding | `id`, `payment_attempt_id`, `payment_hash`, `bolt11`, `amount_msat`, `status`, `expires_at` | Organization |
| `transactions` | Verified money movement | `id`, `payment_attempt_id`, `provider_reference`, `amount_msat`, `fee_msat`, `net_msat`, `status`, `settled_at` | Organization |
| `ledger_accounts` | Chart of accounts | `id`, `organization_id`, `code`, `type`, `currency`, `scale` | Organization |
| `ledger_entries` | Debit or credit line | `id`, `transaction_id`, `account_id`, `direction`, `amount`, `currency`, `scale`, `refund_id`, `posted_at` | Organization |
| `refunds` | Merchant refund linked to a transaction | `id`, `transaction_id`, `payment_intent_id`, `amount_msat`, `fee_msat`, `net_msat`, `status`, `reason` | Organization |
| `settlements` | Reconciliation/payout record | `id`, `merchant_id`, `period_start`, `period_end`, `gross`, `fees`, `net`, `status`, `transaction_count`, `ledger_balanced` | Organization |
| `fees` | Fee snapshot | `id`, `transaction_id`, `rule_ref`, `basis`, `amount`, `currency`, `scale` | Organization |
| `webhook_endpoints` | Developer destination | `id`, `merchant_id`, `url`, `secret_ref`, `events`, `status` | Organization |
| `webhook_deliveries` | Delivery attempt log | `id`, `endpoint_id`, `event_id`, `event_type`, `status`, `attempt`, `response_code` | Organization |
| `api_keys` | Scoped credentials | `id`, `merchant_id`, `key_prefix`, `key_hash`, `scopes`, `livemode`, `status`, `last_used_at`, `expires_at`, `kind`, `created_at` | Organization |
| `console_sessions` | Reference browser session | `id`, `merchant_id`, `api_key_id`, `token_hash`, `csrf_hash`, `scopes`, `auth_method`, `nostr_pubkey`, `expires_at`, `revoked_at` | Organization |
| `console_nostr_identities` | Linked NIP-07 signer/member | `id`, `merchant_id`, `organization_id`, `api_key_id`, `pubkey`, `status`, `role`, `label`, `last_seen_at` | Organization |
| `console_nostr_challenges` | One-time NIP-42 challenge | `id`, `challenge_hash`, `purpose`, `merchant_id`, `session_id`, `expires_at`, `consumed_at` | Organization |
| `onboarding_challenges` | One-time sandbox/Nostr onboarding challenge | `id`, `challenge_hash`, `created_at`, `expires_at`, `consumed_at` | Reference |
| `audit_logs` | Change and access trail | `id`, `organization_id`, `actor_ref`, `action`, `target_ref`, `result`, `occurred_at` | Organization + admin |
| `exchange_quotes` | Rate snapshot | `id`, `base_currency`, `quote_currency`, `base_amount`, `quote_amount`, `rate`, `source`, `quoted_at`, `expires_at` | Reference |
| `provider_connections` | Provider or node binding | `id`, `organization_id`, `provider`, `mode`, `status`, `credential_ref`; the routed connection is derived from active mode and creation order, not stored per intent | Organization |
| `plans` | Sellable organization feature package | `code`, `name`, `version`, `features`, `limits`, `price_msat`, `currency`, `status` | Platform |
| `subscriptions` | Organization plan purchase and period | `id`, `organization_id`, `merchant_id`, `plan_code`, `status`, `provider_reference`, `payment_hash`, `bolt11`, `amount_msat`, `period_start`, `period_end`, `paid_at` | Organization |
| `entitlements` | Read-only feature claim for a consumer | `id`, `organization_id`, `subscription_id`, `plan_code`, `features`, `limits`, `status`, `valid_from`, `valid_until`, `revision` | Organization |

## 2. Relationships

```text
organizations
  ├── merchants
  │     ├── merchant_users
  │     ├── merchant_locations
  │     ├── payment_methods ── provider_connections
  │     ├── webhook_endpoints ── webhook_deliveries
  │     ├── api_keys ── console_sessions
  │     └── console_nostr_identities ── console_nostr_challenges
  ├── subscriptions ── plans
  │     └── entitlements
  └── payment_intents
        ├── payment_attempts
        │     ├── invoices
        │     └── transactions
        │           ├── fees
        │           ├── refunds
        │           └── ledger_entries ── ledger_accounts
        ├── settlements
        └── exchange_quotes (referenced snapshot)
audit_logs references every privileged mutation
```

## 3. Status values

| Record | Values |
| --- | --- |
| Intent | `CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED` |
| Attempt | `CREATED`, `INVOICE_ISSUED`, `PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED`, `QUARANTINED` |
| Invoice | `ISSUED`, `SETTLED`, `EXPIRED`, `CANCELLED`, `QUARANTINED` |
| Transaction | `DETECTED`, `CONFIRMED`, `SETTLED`, `REVERSED` |
| Refund | `PENDING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| Settlement | `PENDING`, `COMPLETED`, `FAILED`, `REVERSED` |
| Webhook delivery | `PENDING`, `DELIVERED`, `FAILED`, `DEAD` |
| Merchant | `PENDING_VERIFICATION`, `ACTIVE`, `RESTRICTED`, `SUSPENDED`, `CLOSED` |
| Provider connection | `UNVERIFIED`, `ACTIVE`, `DEGRADED`, `DISABLED` |
| Subscription | `PENDING_PAYMENT`, `ACTIVE`, `EXPIRED`, `CANCELLED`, `REFUNDED` |
| Entitlement | `ACTIVE`, `GRACE`, `EXPIRED`, `REVOKED` |

The six intent states are canonical for this pack. Payment success is a transition
to `SUCCEEDED` only after provider confirmation.

## 4. Invariants

- **DM-01 Balanced ledger.** For every transaction, the sum of debits equals the
  sum of credits in the same currency and scale. An unbalanced set is rejected.
- **DM-02 Integer money.** Rail amounts are `BIGINT` msat or sat. Fiat uses
  integer minor units with `currency` and `scale`. No floating point anywhere.
- **DM-03 Snapshot pricing.** The exchange quote, fee rule and computed fee are
  stored with the transaction; reads never recompute history from current rates.
- **DM-04 Immutable ledger.** Posted entries are never updated or deleted. A
  correction is a new reversal plus a new correct entry, linked to the original.
- **DM-05 Tenant scope.** Every tenant row carries `organization_id`; every
  query is scoped before retrieval, not filtered in the UI.
- **DM-06 Idempotency.** `(merchant_id, endpoint, idempotency_key)` is unique and
  binds a request digest. Reuse with different content is a conflict.
- **DM-07 Provider dedup.** `(provider_connection_id, provider_event_id)` is
  unique, and `transactions.provider_reference` is unique per connection.
- **DM-08 One settlement.** One payment hash and one invoice settle at most one
  transaction, and one intent has at most one successful attempt.
- **DM-09 Balance separation.** Ledger-derived merchant balance is distinct from
  the observed provider wallet balance; neither silently overwrites the other.
- **DM-10 Terminal immutability.** `SUCCEEDED`, `FAILED`, `EXPIRED` and
  `CANCELLED` intents do not change. A retry is a new attempt; a terminal intent
  is retried through a new intent.
- **DM-11 No secrets.** API keys are stored as hashes with a visible prefix;
  webhook secrets and provider credentials are references to encrypted storage.
- **DM-12 Audit.** Price, fee, settlement, key and authority changes append an
  audit record with actor, action and result.
- **DM-13 Expiry.** A payment proven after `expires_at` cannot settle; a payment
  proven before expiry can recover a locally expired invoice. A late provider
  success is quarantined for human reconciliation.
- **DM-14 Refund ceiling.** A refund links to one settled transaction, never
  exceeds the unrefunded amount, and posts balanced reversal entries; it never
  edits an invoice or posted entry.
- **DM-15 Risk limits.** Payment creation checks merchant status, amount, rolling
  daily volume and per-minute velocity before a provider invoice is created.
- **DM-16 No implied deposit.** No table may present a customer stored balance
  unless the custodial model is approved (PAY-D01).
- **DM-17 Entitlement is not authority.** An entitlement may list features and
  limits only. It carries no owner, membership, role, API key or live-payment
  flag. Pay owns the record; consumers enforce feature gates and keep their own
  authorization checks.
- **DM-18 Plan activation.** A subscription becomes active only from a
  provider-confirmed payment. A browser return, entitlement edit or client flag
  cannot activate it. Expiry or refund downgrades features without deleting
  payment records or changing organization ownership.
- **DM-19 Connection scope.** Every live provider connection has one
  organization and one merchant, or an explicitly approved organization scope.
  There is no global credential fallback.
- **DM-20 No commingled live funds.** Separate credentials pointing at one
  custodial account do not isolate funds. A shared live deployment cannot route
  several merchants to one account without an approved custody model (PAY-D01).
- **DM-21 Callback binding.** A provider callback resolves its connection and
  tenant before payload trust, verifies the provider signature over raw bytes,
  and is unique per `(provider_connection_id, provider_event_id)`.
- **DM-22 Credential isolation.** Provider secrets are encrypted with
  connection-bound authenticated data, versioned and unreadable from PostgreSQL,
  logs, exports or the console.
- **DM-23 Live activation.** Live payment requires merchant verification, an
  active verified connection and an explicit live activation. A plan payment,
  Nostr proof or UI toggle does not grant it.
- **DM-24 Failover immutability.** An issued invoice stays on its original
  connection; failover selects a connection only for a new intent.
- **DM-25 Tenant query scope.** Every tenant read and write requires an explicit
  organization/merchant scope; a missing scope is an error, not a global query.

## 5. Money representation

- Internal Lightning amounts: `amount_msat BIGINT`; sat is a display unit.
- Fiat: `amount_minor BIGINT`, ISO currency, explicit scale (LAK scale `0`,
  USD scale `2` are illustrative configured values, not inferred).
- Wire composition uses ecosystem `bitos.amount/1` integer minor-unit strings;
  storage stays integer. The shared contract excludes BTC pending review, so a
  Lightning amount must not be silently mapped to a BTC amount (PAY-D07).
- A quote binds base, quote, rate, source, `quoted_at` and `expires_at`; an
  expired quote cannot price a new intent.

## 6. Privacy classes

| Class | Data | Rule |
| --- | --- | --- |
| Public projection | Merchant display name, logo, public payment link label | Explicit opt-in, allowlisted fields, rebuildable |
| Tenant-private | Intents, invoices, transactions, fees, settlements, locations, staff | Organization-scoped read; no public relay |
| Secret | Key hashes, webhook secrets, provider and NWC credentials | Encrypted store, restricted service access, never logged |
| Audit | `audit_logs`, admin access history | Append-only, redacted, restricted retention |

No transaction detail, customer reference, phone number or address is published
to a public relay. Public projections contain no payment status.

## 7. Retention

Financial records, ledger entries and settlements are retained for a
legal-review-defined period (candidate 7 years, PAY-D13). Provider raw payloads
and webhook bodies have a shorter operational window and are redacted after
dispute resolution. Deletion never removes ledger history. See
[SECURITY](SECURITY.md) for threat controls and [OPERATIONS](OPERATIONS.md) for
backup and restore.

## 8. Shared-live tenancy additions (planned)

The reference `provider_connections` row has provider, mode, status and a
nullable `credential_ref`; it does not yet contain per-merchant credentials or a
callback identity. Shared live tenancy needs these additions before use; they are
**not** in migrations `0001`-`0014`.

| Area | Planned fields or table |
| --- | --- |
| `provider_connections` | `merchant_id` (nullable only for approved organization scope), `scope`, `credential_version`, `webhook_secret_ref`, `webhook_token_hash`, `priority`, `health`, `provider_account_ref`, `last_verified_at`, `disabled_at` |
| `provider_webhook_events` | `organization_id`, `merchant_id`, `provider_connection_id`, `provider_event_id`, `event_type`, `body_hash`, `received_at`, `status`, `failure_code`; unique `(provider_connection_id, provider_event_id)` |
| `merchant_verifications` | Level, authority, status, evidence reference, reviewer, validity, expiry |
| `live_activations` | Merchant, scope, limits, actor, reason, activated_at, revoked_at |
| Secret metadata | Version, purpose, status, rotation/revocation timestamps and a reference to KMS/secret storage; no plaintext |
| `audit_logs` | Organization, actor, connection and action for every privileged connection/live mutation |

`payment_intents`/`payment_attempts` keep the immutable connection id; a routing
decision or reason may be added for audit, but an issued invoice never changes
connection or payee. See [TENANCY](TENANCY.md) for the full flow, API surface and
gates.
