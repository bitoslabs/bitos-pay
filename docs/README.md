# BitOS Pay — documentation space

Status: **Specification + synthetic reference core and reference UI.** This is the
canonical payment documentation for the BitOS ecosystem. The Fastify reference
service in [`../service`](../service) implements the core sandbox API plus an
opt-in live adapter seam; the zero-build [`../ui`](../ui) implements a
mode-configurable console (sandbox default), API-backed hosted checkout pages
and a synthetic dashboard/demo checkout. Neither claims
production, pilot, CI or real-money readiness.

## 1. What it is

BitOS Pay is a payment layer between applications and payment rails. An
application creates a payment intent with an integer amount; Pay obtains a
Lightning invoice through a provider adapter, has the provider — never the
browser — confirm settlement, records a double-entry ledger transaction, and
delivers a signed webhook. Bitcoin Lightning is first. Cashu, on-chain and other
rails sit behind the same adapter boundary later.

## 2. Status labels

| Label | Meaning |
| --- | --- |
| **Spec** | Documented contract; no implementation claim |
| **Reference core** | Synthetic local implementation with dated evidence; not production, pilot or CI |
| **Planned** | Agreed direction, not built; may change through a decision |
| **Open** | Needs a decision or missing input |
| **Blocked** | Cannot proceed until an external dependency clears |

No document may use `Implemented`, `Done`, `Production` or `Passing` without a
dated evidence record in this repository.

## 3. Reading order

1. [BLUEPRINT](BLUEPRINT.md) — why, for whom, surfaces, revenue hypothesis.
2. [PRODUCT](PRODUCT.md) — features, MVP cut, acceptance, non-goals.
3. [ARCHITECTURE](ARCHITECTURE.md) — layers, flow, state machine, stack.
4. [STRUCTURE](STRUCTURE.md) — idea-to-reference mapping, module boundaries and split gates.
5. [DATA-MODEL](DATA-MODEL.md) — entities, invariants, statuses, privacy.
6. [API](API.md) — operations, webhooks, errors, SDK surface.
7. [INTEGRATION](INTEGRATION.md) — BNOS, ID, Agent, Commerce, Workspace, shared contracts.
8. [SECURITY](SECURITY.md) — authority, threats, custody, legal, risk register.
9. [UX-UI](UX-UI.md) — journeys, screens, states, accessibility, Lao/English.
10. [OPERATIONS](OPERATIONS.md) — persistence, backup, rollout, incidents.
11. [TENANCY](TENANCY.md) — dedicated versus shared live deployment, connection isolation and shared-live gates.
12. [TESTING](TESTING.md) — layers, fault matrix, release gates, evidence.
13. [ROADMAP](ROADMAP.md) — phases, 12-week estimate, gates, experiments.
14. [DECISIONS](DECISIONS.md) — PAY-D register with owners.
15. [GLOSSARY](GLOSSARY.md) — shared vocabulary.
16. [RUNNING](RUNNING.md) — run the synthetic reference core.
17. [EVIDENCE-2026-11-13](EVIDENCE-2026-11-13.md) — dated local test evidence and limits.
18. [EVIDENCE-2026-11-14](EVIDENCE-2026-11-14.md) — Blink/Strike adapter and webhook test evidence.

## 4. Document map

| File | Answers |
| --- | --- |
| [BLUEPRINT](BLUEPRINT.md) | Recommendation, users, four surfaces, business model, non-goals |
| [PRODUCT](PRODUCT.md) | PAY-F features, P0/P1/P2/P3 cut, v0.1 definition of done |
| [ARCHITECTURE](ARCHITECTURE.md) | Components, payment flow, state machine, deployment modes |
| [STRUCTURE](STRUCTURE.md) | Idea-to-reference layout, dependency rules, structure check and monorepo split gates |
| [DATA-MODEL](DATA-MODEL.md) | Entities, relationships, money and ledger invariants |
| [API](API.md) | Core v1 operations, webhook events, error groups, SDKs |
| [INTEGRATION](INTEGRATION.md) | Canonical owners and contract composition |
| [SECURITY](SECURITY.md) | Authority matrix, threats PAY-R, fail-closed rules, legal |
| [UX-UI](UX-UI.md) | Merchant, checkout and developer journeys, states and the synthetic reference UI |
| [OPERATIONS](OPERATIONS.md) | Backups, restore, rollout, monitoring, incident response |
| [TENANCY](TENANCY.md) | Dedicated versus shared live deployment, per-merchant connections, webhook routing and isolation gates |
| [TESTING](TESTING.md) | Test layers, fault cases, acceptance gates, evidence |
| [ROADMAP](ROADMAP.md) | Phase 0, six two-week blocks, evolution phases, revenue tests |
| [DECISIONS](DECISIONS.md) | PAY-D01…D24 decisions and owners |
| [GLOSSARY](GLOSSARY.md) | Terms defined once for the pack |
| [RUNNING](RUNNING.md) | Run the synthetic reference core, API examples and limits |
| [EVIDENCE-2026-11-13](EVIDENCE-2026-11-13.md) | Dated local commands, results and the live PostgreSQL blocker |
| [EVIDENCE-2026-11-14](EVIDENCE-2026-11-14.md) | Blink/Strike adapter, raw-body webhook and test evidence |

## 5. Cross-project boundaries

| Domain | Canonical owner | BitOS Pay role |
| --- | --- | --- |
| Order, stock, receipt, fulfillment | BNOS | Consumer of orders; emits payment outcome |
| Identity, membership, business verification | [BitOS ID](../../bitos-id-trust/docs/README.md) | Verifies merchant identity; never treats it as payment authority |
| Agent capability, budget, approval | [BitOS Agent](../../bitos-agent-runtime/docs/README.md) | Payment adapter under a scoped grant; never a key |
| Catalog, cart, escrow terms | [BitOS Commerce](../../bitos-commerce/docs/README.md) | Settlement rail; no second order schema |
| Teams, roles, private channels | [BitOS Workspace](../../bitos-workspace/docs/README.md) | Staff SSO and audit context only |
| Amount, settlement-proof, envelope wire | Ecosystem shared contracts | Composes; no local fork |
| Nostr kind numbers | BNOS registry owner | No kind is invented or reserved here |

## 6. Nearest blockers

- **Custody and licensing** — hosted custody and LAK/BTC exchange require review
  with the Bank of the Lao PDR and local counsel (PAY-D01, PAY-D12).
- **Provider selection** — opt-in LNbits, Blink and Strike live adapters exist,
  but no production provider/node choice, KYB, custody model or payout path is
  approved (PAY-D02).
- **Shared live tenancy** — one deployment currently has one global live provider
  account. Use one dedicated instance per live merchant until per-merchant
  connections, encrypted credentials, callback routing, tenant isolation, live
  activation, reconciliation/failover and audit gates pass (PAY-D24,
  [TENANCY](TENANCY.md)).
- **BNOS contract** — order reference, webhook semantics and receipt ownership
  need BNOS sign-off (PAY-D06).
- **Settlement proof** — the Lightning rail needs an agreed proof binding before
  reconciliation can be specified as final (PAY-D07).
- **Independent security and reconciliation evidence** — required before any
  limited pilot; none exists yet (PAY-R02, PAY-R04).

See [ROADMAP](ROADMAP.md) for exit gates and [DECISIONS](DECISIONS.md) for owners.
