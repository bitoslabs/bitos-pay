# BitOS Pay

Status: **Specification + synthetic reference core and reference UI.** The
reference service in [`service/`](service) implements the core API against
PostgreSQL with a mock Lightning adapter. [`ui/`](ui) contains a live sandbox
console, API-backed hosted checkout pages, reusable payment links and a static
synthetic dashboard/demo checkout. Sandbox is the default; live LNbits, Blink and
Strike adapters are opt-in but unverified. None is a production payment service,
and there is no real custody, payout, KYB, pilot or CI claim. See
[RUNNING](docs/RUNNING.md) and [evidence](docs/EVIDENCE-2026-11-14.md).

BitOS Pay is an open payment infrastructure that connects businesses, people,
applications and AI agents through Bitcoin Lightning and open protocols: one
payment layer, many applications, one open economy. The first customer is BNOS,
the first market is Laos and Southeast Asia, the first rail is Bitcoin Lightning
and the first integration is BNOS checkout.

## Surfaces

| Surface | Role |
| --- | --- |
| Pay Core | Payment engine, ledger, settlement, fees, risk and limits |
| Pay Merchant | Merchant onboarding and dashboard |
| Pay API | REST API, SDKs, webhooks, payment links and QR |
| Pay Connect | Nostr and wallet connectivity, identity linking |

## Canonical ownership

- Canonical owner (payment domain spec): this folder; start at
  [docs/README.md](docs/README.md).
- BNOS order, stock, receipt and the Nostr kind registry: BNOS owners.
- Shared amount, settlement-proof and envelope contracts: the ecosystem
  [shared contracts](../shared/contracts/README.md); BitOS Pay composes them
  and does not fork them.
- Brand and commercial organization: `bitdigo.com`.

Source of truth for scope is the payment section of [`chat.md`](../chat.md),
structured by [`DOC-STANDARD.md`](../docs/DOC-STANDARD.md).

## Nearest blockers

1. Custody model and Lao legal review before any hosted money handling
   (PAY-D01, PAY-D12).
2. Lightning provider or node selection and sandbox access (PAY-D02).
3. BNOS checkout order/payment contract sign-off (PAY-D06).
4. Settlement-proof adoption for the Lightning rail (PAY-D07).
5. Reconciliation and security evidence before a pilot (PAY-R02, PAY-R04).

Read [docs/README.md](docs/README.md) for the document map and reading order.
The original blueprint is [docs/idea.md](docs/idea.md); its canonical
interpretation and current-to-target package map are in
[docs/STRUCTURE.md](docs/STRUCTURE.md).

## Reference core

[`service/`](service) is a Node.js 24 + TypeScript + Fastify reference API with
PostgreSQL storage, a sandbox Lightning adapter boundary, a double-entry ledger,
idempotent intent creation, signed webhooks with dual-secret rotation, scoped API
keys, quote snapshots, refunds, risk limits and settlement summaries. [`sdk/`](sdk) is the typed
server-side `@bitos/pay-js` client and webhook verifier. [`ui/`](ui) contains a
live reference console with sandbox-key or linked NIP-07 Nostr login, payment
monitoring, API-key management with optional expiry, webhook setup, settlement views, merchant profile and locations
editing, invited Nostr team roles, settlement reconciliation history, signed hosted checkout links,
reusable payment links, CSV exports and a live OpenAPI reference, plus a static
synthetic dashboard/checkout demo. NIP-07 keeps the signer key in the extension;
local `nsec` signing is a disabled-by-default worker opt-in and NIP-46 requires a
configured relay.
It uses shared design tokens and English/Lao copy with no build step. This is
explicitly not the selected production stack or a real-money implementation.

```sh
pnpm install
pnpm --filter @bitos/pay-core migrate
pnpm --filter @bitos/pay-core seed
pnpm --filter @bitos/pay-core check:structure
pnpm --filter @bitos/pay-core start
# open http://127.0.0.1:8788/console/ with a seeded bp_test_ key
pnpm --filter @bitos/pay-js test
```

Full setup, API examples, reference UI/console, tests and limits:
[docs/RUNNING.md](docs/RUNNING.md).
Test evidence: [docs/EVIDENCE-2026-11-14.md](docs/EVIDENCE-2026-11-14.md).

## Ecosystem direction

BitOS Pay is the first recommended build. See
[`docs/RECOMMENDATION.md`](../docs/RECOMMENDATION.md) for the rationale,
build order and the scoped spend-mandate direction.