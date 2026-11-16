# BitOS Pay — decisions

Status: **Spec**. A decision records direction and an owner; it does not prove
implementation. Status uses only `Planned`, `Open` or `Blocked`.

`Planned` = a proposed direction is recorded for the roadmap but remains
reversible. `Open` = no owner decision yet. `Blocked` = an external approval is
required first.

## 1. Register

| ID | Question | Proposed direction | Status | Owner |
| --- | --- | --- | --- | --- |
| PAY-D01 | Which custody model for the first release? | Non-custodial and merchant-controlled only; hosted custody gated | Planned | Product + counsel |
| PAY-D02 | Which Lightning provider or node is first? | Evaluate a hosted provider and a self-hosted node against cost, webhook quality, status query, reliability and self-host fit | Open | Architecture |
| PAY-D03 | Which currency prices the first intents? | Start v0.1 in SAT; fiat pricing, quote source, scale and rounding are P1 and need a reviewed quote profile | Open | Product |
| PAY-D04 | Are refunds in v0.1? | Refund/reversal is P1; v0.1 may record a reversal manually but does not promise a self-service flow | Planned | Product |
| PAY-D05 | Is the backend Node/TypeScript or Rust/Axum? | The blueprint says Node/TypeScript; the ecosystem prefers Rust for new enforcing APIs. Decide before repository setup | Open | Architecture |
| PAY-D06 | Who owns the BNOS order/payment contract? | BNOS owns orders, stock and receipts; Pay owns payment records; the webhook is the boundary | Open | BNOS + Pay leads |
| PAY-D07 | How does a Lightning payment satisfy settlement proof? | Bind invoice reference/hash, provider, payee and amount; escalate the BTC amount-unit exclusion to the shared contract owner | Open | Contracts + Pay |
| PAY-D08 | What merchant verification is required? | Risk-based business verification; Nostr login alone is insufficient; level depends on volume and custody | Open | Risk + product |
| PAY-D09 | How much Nostr is in the first release? | Optional login and NIP-47 connectivity in P1; NIP-57 only for zaps, never checkout | Planned | Product |
| PAY-D10 | How are webhook secrets signed and rotated? | Per-endpoint secret, HMAC over timestamp and raw body, dual-secret rotation window, delivery log | Reference (dual-signature grace window) | API lead |
| PAY-D11 | How is sandbox isolated? | Separate keys, provider connection, database namespace and visible sandbox badge | Planned | API lead |
| PAY-D12 | When can LAK↔SATS or custody launch? | Not before Bank of the Lao PDR and local counsel review, licensing, reserves and a risk model | Blocked | Product + counsel |
| PAY-D13 | How long is operational data retained? | Financial records per counsel; raw provider payloads and webhook bodies shorter, redacted after dispute resolution | Open | Security + counsel |
| PAY-D14 | Who is on call and who can approve a pilot? | A named operational owner and a human pilot approval; no autonomous launch | Open | Operations |
| PAY-D15 | How is an organization plan sold without selling authority? | Free private workspace and sandbox merchant; paid plan upgrades features only; ownership, membership, roles and live payment authority remain separate | Planned | Product + Pay + Workspace |
| PAY-D16 | When does a paid plan activate, expire or downgrade? | Activate only after provider-confirmed subscription payment; expire to free limits after a bounded grace period; never delete records or change roles | Planned | Product + Pay |
| PAY-D17 | What is the entitlement contract and failure mode? | Versioned read-only entitlement keyed by organization, with plan, features, limits, validity and revision; Workspace enforces feature gates, not roles; unknown entitlement activates nothing new | Planned | API lead + Workspace lead |
| PAY-D18 | Which organization identity does a Pay entitlement reference? | Add an explicit mapping between the ID organization/workspace and the Pay organization; never infer it from a display name. BNOS uses `bnos:<workspace_id>` in the sandbox link; ID integration remains open | Open | Pay + ID + Workspace |
| PAY-D20 | How is live provider capability isolated from sandbox? | Keep the mock provider for sandbox and a separate live adapter selected by `livemode`; require explicit live config and fail closed. A webhook is only a trigger, never proof | Planned | Pay + Ops |
| PAY-D21 | When should the reference `service`/`sdk`/`ui` layout split into the idea's `apps/` and `packages/` monorepo? | Keep the modular-monolith reference until a separate worker, second core consumer, independent adapter release, published SDK or deployment target requires a split; preserve boundaries and add migration evidence | Planned | Architecture |
| PAY-D19 | How does a BNOS workspace link establish trust? | The owner signs a one-time kind `22242` challenge bound to `bnos:<workspace_id>`; Pay requires a unique `subject_ref` and the same owner on resync. This proves key control only, not legal business or BNOS server attestation | Planned | Pay + BNOS |
| PAY-D24 | When can one deployment serve multiple live merchants? | Dedicated single-tenant deployment per live merchant now; shared live tenancy only after connection-scoped credentials, callback routing, tenant enforcement, KYB/live activation, reconciliation/failover and audit gates have dated evidence. Never fork the app per customer | Planned | Architecture + Security + Risk |

## 2. Notes on high-impact decisions

### PAY-D01 custody

The MVP must not imply a stored balance. If a merchant connects their own wallet,
the customer pays the merchant directly and Pay records evidence. Any later
custodial model changes licensing, reserves, accounting, security and consumer
disclosure, so it is a separate product decision rather than a configuration
flag.

### PAY-D02 provider

Selection criteria: invoice creation latency, authenticated status query,
callback signature and replay behavior, delivery guarantees, fee transparency,
sandbox quality, regional availability and the ability to self-host. A provider
that offers only a browser redirect is insufficient. Reference adapters now exist
for LNbits, Blink and Strike, but that is implementation evidence, not a provider
selection decision or custody approval.

### PAY-D05 runtime

This is a real conflict between the product blueprint and the ecosystem's later
backend preference. Keeping it open prevents two implementations being started
by accident. The decision should consider SQLx/PostgreSQL ergonomics, the
team's maintenance capacity, the provider SDK ecosystem and the enforcement
boundary. It does not change the API or data contracts.

### PAY-D06 BNOS boundary

The contract must fix: external reference uniqueness, event idempotency, what
"paid" means, which receipt BNOS issues, refund mapping, timeout behavior and
how a quarantined late payment is presented. Neither side may write the other's
tables.

### PAY-D15 plan versus authority

The buyer of a plan is a billing subject, not automatically the organization
owner. A plan changes which features an organization may use, not who may use
them. A paid organization can still have its owner removed by the proper ID or
Workspace process; a non-paying owner does not lose ownership because a card or
invoice failed. Conversely, paying an invoice never grants live merchant status.

### PAY-D16 activation and downgrade

Subscription activation follows the same proof rule as a payment intent: only a
provider-confirmed event or authenticated provider query changes state. A
browser redirect is not proof. On expiry, refund or chargeback, paid features
downgrade after a bounded grace period. Core workspace access, records and
exports remain available; deletion is a separate retention decision.

### PAY-D17 entitlement enforcement

An entitlement is a read-only claim from Pay to a consumer such as Workspace. It
must be versioned, tenant-scoped and safe to cache with a short validity window.
It does not carry a role, owner flag or payment capability. If it is missing,
expired or unverifiable, the consumer must not activate a new paid feature; it
may retain existing core access and show billing unknown. The free tier must
remain usable without Pay.

### PAY-D18 organization mapping

The Pay `organizations` table now has a nullable `subject_ref`, but no ID
integration populates it; sandbox onboarding leaves it null. Until the mapping is
implemented, a plan cannot safely be attributed across products by name. The mapping must be explicit,
tenant-scoped and immutable for the life of the subscription. It does not grant
ID or Workspace authority.

### PAY-D19 BNOS workspace trust

BNOS is local-first, so Pay cannot fetch an organization record from a relay and
treat it as authority. The integration therefore binds the active BNOS
organization id into a one-time signed challenge. The owner key must match on
every resync, the mapping is immutable to another owner and the link is labelled
`owner_key_only`. It does not verify a legal business, populate ID membership or
give staff access. A server-signed BNOS attestation can replace the owner-only
label later without changing the mapping rule.

### PAY-D21 repository shape

The idea's `apps/` and `packages/` layout is a target, not a reason to churn paths.
The reference keeps one service package because ledger, state machine and webhook
outbox share one transactional boundary. The mapping and split triggers are in
[STRUCTURE](STRUCTURE.md). A later split must update workspace manifests, imports,
commands and evidence; it must not change API or money contracts by itself.

### PAY-D23 reusable payment-link authority

A payment link is a stored fixed-amount merchant object plus a stateless HMAC
token. It grants public read access to the merchant name, amount, reference and
label, and permits creation of a new payment intent while active. It never uses
an API key, changes amounts, refunds or reads another tenant. Creation requires
`payments:write`; public invoice creation is rate-limited per client IP and
still passes merchant risk and provider gates. Disabling blocks new checkouts,
not invoices already created.

### PAY-D22 checkout link authority

A hosted checkout link is an HMAC-signed, stateless reference to one payment
intent. Possession grants read-only access to a deliberately small public
projection; it never authorizes payment creation, cancellation, refund or API-key
use. The token contains no secret, and rotating `PAY_SECRET_KEY` invalidates all
outstanding links. Cancelling the intent changes the visible state but does not
mint a new link. A stored, revocable link is a later option if link-level
revocation becomes a requirement.

### PAY-D24 shared live tenancy

The reference has one live provider slot per deployment and one global live
account. A second live merchant is not just another database row: it needs its
own provider account or node, credential isolation, callback identity, live
activation decision and reconciliation boundary. Until those exist, use a
dedicated single-tenant instance per merchant rather than pooling funds or
forking the application. Blink and Strike are custodial accounts, so separate
credential labels pointing at one account do not create fund isolation. The
full concept and gates are in [TENANCY](TENANCY.md); hosted custody remains
blocked by PAY-D01.

### PAY-D07 settlement proof

The shared contract binds a provider proof to an invoice, payee and amount and
rejects preimage, payee, amount, expiry and reuse mismatches. Lightning is
BTC-denominated while the current amount contract excludes BTC pending review.
Pay must not silently relabel a Lightning amount as a fiat or BTC amount; the
unit and conversion question needs an explicit reviewed profile.

## 3. How to close a decision

1. Name the decision owner and the consumers affected.
2. Record the chosen option, rejected options and the compatibility impact.
3. Update the affected documents here and in the consumer's pack.
4. Add a gate to [TESTING](TESTING.md) if the decision changes money, privacy or
   authority behavior.
5. Do not change a canonical contract without the contract owner's review and
   consumer fixtures.

Decisions that affect custody, licensing or real-money agent spending also need
the human approvals named in [SECURITY](SECURITY.md) before any pilot.
