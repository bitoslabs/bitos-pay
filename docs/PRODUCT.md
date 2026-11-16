# BitOS Pay — product

Status: **Spec + synthetic reference core.** `Reference` means a local synthetic
implementation with dated evidence; it is not production, a pilot or a real-money
claim. Features not marked `Reference` remain `Planned`.

## 1. Product statement

A merchant or platform creates a payment request; BitOS Pay returns a Lightning
invoice, verifies settlement with the provider, records the money movement and
notifies the caller. The customer uses any compatible Lightning wallet. No
BitOS Pay account or stored balance is required to pay.

## 2. Features

### Pay Core

| ID | Feature | Priority | Status |
| --- | --- | --- | --- |
| PAY-F01 | Payment intent creation with amount, currency, merchant and external reference | P0 | Reference |
| PAY-F02 | Invoice creation through a provider adapter (Lightning first) | P0 | Reference |
| PAY-F03 | Provider-verified payment confirmation; browser claims never mark paid | P0 | Reference (mock provider) |
| PAY-F04 | Payment attempts; a retry is a new attempt and never mutates a terminal state | P0 | Reference |
| PAY-F05 | Invoice expiry and intent expiry handling | P0 | Reference |
| PAY-F06 | Double-entry ledger with immutable entries and reversal entries | P0 | Reference |
| PAY-F07 | Fee calculation with a fee snapshot on every transaction | P0 | Reference |
| PAY-F08 | Settlement records and daily reconciliation | P0 | Reference (local ledger + console history) |
| PAY-F09 | Refund and reversal workflow | P1 | Reference (sandbox API + console detail) |
| PAY-F10 | Risk limits, velocity checks and merchant status gates | P1 | Reference (no admin API) |

### Pay Merchant

| ID | Feature | Priority | Status |
| --- | --- | --- | --- |
| PAY-F11 | Merchant registration, organization profile and verification state | P0 | Reference (profile edit; verification read-only) |
| PAY-F12 | Dashboard: payment request, QR, history and transaction detail | P0 | Reference (console + live checkout link) |
| PAY-F13 | Staff roles, permissions and multi-branch management | P1 | Reference (Nostr roles + location registry/assignment; no branch-scoped staff) |
| PAY-F14 | Hosted checkout page with QR, countdown and status | P0 | Reference (API-backed hosted checkout; demo remains) |
| PAY-F15 | Payment links and reusable QR for a fixed amount | P1 | Reference (signed public link + fresh checkout) |
| PAY-F31 | Organization plan, subscription invoice and feature entitlement | P2 | Reference (sandbox) |
| PAY-F32 | Self-service sandbox organization, merchant and test-key onboarding | P1 | Reference (env-gated; no live) |
| PAY-F33 | Signed BNOS workspace link, idempotent name sync and sandbox console access | P1 | Reference (owner-key proof; no business verification) |
| PAY-F34 | Signer-first console entry: existing key signs in, new key auto-creates sandbox access and one-time API key | P1 | Reference (sandbox; no live or business verification) |
| PAY-F35 | Opt-in live LNbits adapter, dual sandbox/live provider routing and token-protected provider webhook | P0 | Adapter reference (no KYB, payouts or production approval) |
| PAY-F36 | Direct Blink and Strike live adapters with provider-specific signed webhooks behind the shared provider port | P1 | Adapter reference (mock-tested only; custodial; no Strike cancellation, live KYB or payout) |
| PAY-F37 | Shared live multi-tenant deployment with per-merchant connections, callback routing and isolation | P2 | Planned (dedicated per-merchant deployment is the current path; see [TENANCY](TENANCY.md)) |

### Pay API and developer platform

| ID | Feature | Priority | Status |
| --- | --- | --- | --- |
| PAY-F16 | REST API v1 and OpenAPI description | P0 | Reference |
| PAY-F17 | Scoped API keys, hashing, rotation and revocation | P0 | Reference (atomic rotate + expiry) |
| PAY-F18 | Signed webhooks with retry, delivery log, replay protection, event editing and dual-secret rotation | P0 | Reference |
| PAY-F19 | `@bitos/pay-js` and `@bitos/pay-nuxt` SDKs | P0 | Reference (`@bitos/pay-js`; Nuxt planned) |
| PAY-F20 | Developer console: keys, webhook setup, docs, sandbox, guide | P1 | Reference (keys, webhooks, quickstart, live OpenAPI reference; no full guide) |
| PAY-F21 | `@bitos/pay-node` and `@bitos/pay-react` SDKs | P2 | Planned |

### Pay Connect and rails

| ID | Feature | Priority | Status |
| --- | --- | --- | --- |
| PAY-F22 | Optional Nostr login linked to a merchant organization | P1 | Reference (NIP-07; opt-in local nsec; relay-gated NIP-46) |
| PAY-F23 | NIP-47 Nostr Wallet Connect for merchant wallet connectivity | P1 | Planned |
| PAY-F24 | LAK/SAT quote with a stored quote snapshot | P1 | Reference (sandbox) |
| PAY-F25 | Private payment receipt linked to a merchant or customer pubkey | P2 | Planned |
| PAY-F26 | Cashu adapter behind the provider boundary | P2 | Planned |
| PAY-F27 | Bitcoin on-chain adapter | P3 | Planned |
| PAY-F28 | Multi-rail payment routing | P3 | Planned |
| PAY-F29 | Agent payment under an owner-set spending policy | P3 | Planned |
| PAY-F30 | BNOS checkout adapter and order-paid consumer contract | P0 | Planned |

## 3. MVP cut (v0.1)

Three outcomes only:

1. A merchant can create a payment request.
2. A customer can pay it with a Lightning wallet.
3. The system verifies the payment and notifies BNOS correctly.

Included: PAY-F01…F08, F11, F12, F14, F16…F19, F30 and the BNOS checkout
integration. Excluded from v0.1: self-service refunds, staff roles, payment
links, Nostr login, NWC, quotes, Cashu, on-chain, routing, agent payments and
organization plans.
v0.1 prices in SAT; LAK pricing and the public quote endpoint are P1 (PAY-F24),
although [API](API.md) illustrates the future LAK request shape.

Nostr login is optional even when added. A pubkey does not verify the legal
identity of a business; merchant verification is separate and risk-based.

Self-service creation of a sandbox organization, merchant and test API key is a
reference slice (PAY-F32), disabled unless `PAY_ONBOARDING_ENABLED=1` and limited
per client IP. An optional signed NIP-42-style event records `owner_pubkey`; the
key proves possession, not a global BitOS ID or legal business. It does not
create an ID workspace, verify a business or enable live payments. A separate
signed BNOS workspace link (PAY-F33) maps `subject_ref`, provisions once and
refreshes names on later logins; it proves owner-key control only. Organization plans are a sandbox reference slice (PAY-F31) with seeded,
illustrative SAT prices; recurring live billing and refunds are not built. A plan
gates plan features and limits only. It never creates ownership, membership, workspace
roles or live payment authority, and payment for a plan does not replace merchant
verification. The default organization/workspace tier is free; the paid plan is
an optional upgrade. Payer and organization owner may be different subjects.

## 4. Acceptance criteria

- An intent id is unique per merchant; a repeated idempotency key returns the
  original result and a different body under the same key is rejected.
- The response contains a valid invoice and an expiry; the intent is `PENDING`
  only after the invoice exists.
- A browser "paid" signal cannot change state. Only a provider-confirmed event
  or an authenticated provider query can.
- A settled invoice creates exactly one transaction and one balanced ledger
  entry set, including the fee and merchant net amount.
- A duplicate provider event or duplicate webhook does not create a second
  transaction or a second order-paid effect.
- An expired invoice cannot be marked paid manually; a provider success without
  a pre-expiry proof is quarantined for reconciliation.
- `GET /balances` reports ledger-derived values and is labeled as such, never as
  a wallet balance.
- A refund cannot exceed the unrefunded amount; a full refund posts balanced
  reversal entries and leaves ledger-derived balances at zero.
- Risk limits reject an over-limit or over-velocity intent before a provider
  invoice exists; an idempotent replay still returns the original result.
- Sandbox and live keys are distinguishable; a sandbox invoice cannot settle a
  live intent.
- Self-service onboarding returns a `bp_test_` key once and cannot create a
  live key or activate a live merchant.
- A plan is activated only after provider-confirmed subscription payment; a
  browser return cannot activate it.
- An entitlement can enable listed features and limits but cannot change owner,
  membership or roles; a plan payment cannot activate live merchant payments.
- An expired or refunded plan downgrades paid features without deleting records
  or changing authority.

## 5. v0.1 definition of done

Taken from [`chat.md`](../../chat.md), with no added claims:

1. Merchant creates a payment intent.
2. Customer sees a Lightning QR.
3. Customer pays with a Lightning wallet.
4. Provider confirms the transaction.
5. Ledger records the entry correctly.
6. Webhook delivers the result back to BNOS.
7. Duplicate webhooks are prevented from double effect.
8. Payment reconciliation passes.
9. Provider outage and expired invoice are tested.
10. Security review passes before a pilot.

These are gates to plan and evidence, not statements that any have passed.

## 6. Out of scope

- Custodial stored balances, payouts to bank accounts and card acquiring.
- Subscription billing and paid organization plans in v0.1; PAY-F31 is a P2
  sandbox reference slice.
- LAK/BTC exchange, LocoSats, remittance and merchant advances.
- Autonomous agent spending, loyalty and marketplace escrow.
- A second order, catalog, identity or accounting schema.
- A forked application per customer; deploy the same codebase with isolated
  configuration, database and provider account.
- Pooling several live merchants in one custodial provider account or enabling
  shared live tenancy before the [TENANCY](TENANCY.md) gates pass.
- Public publication of transaction detail or a new Nostr event kind.

See [ROADMAP](ROADMAP.md) for sequencing and [TESTING](TESTING.md) for gates.
