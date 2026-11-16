# BitOS Pay — structure and blueprint alignment

Status: **Spec + reference core and UI.** This document maps the structure proposed
in [`idea.md`](idea.md) to the current reference implementation and defines the
boundaries that must survive a later monorepo split. It is not a claim that the
target layout exists.

## 1. Source of truth

[`idea.md`](idea.md) is the product input: a raw, long-form blueprint covering the
market thesis, architecture, data model, API, Nostr, MVP, roadmap, pricing,
security and the merchant-owned-node / external-provider decision. It is not a
canonical contract by itself.

The canonical interpretation is the document set linked from
[`README.md`](README.md), especially [BLUEPRINT](BLUEPRINT.md),
[ARCHITECTURE](ARCHITECTURE.md), [PRODUCT](PRODUCT.md),
[DATA-MODEL](DATA-MODEL.md), [API](API.md) and [DECISIONS](DECISIONS.md).
When `idea.md` and a canonical document disagree, the canonical document and
[DECISIONS](DECISIONS.md) win; the raw idea stays as history.

## 2. Current reference shape

The reference lives in the ecosystem pnpm workspace as three packages:

```text
bitos-pay/
├── service/                 @bitos/pay-core
│   ├── src/
│   │   ├── domain/          money, state machine, ledger, signatures
│   │   ├── application/     services and ports
│   │   ├── infrastructure/  PostgreSQL, repositories, providers, crypto
│   │   ├── api/             Fastify routes, presenters, OpenAPI
│   │   └── main/            migrate, seed, server
│   ├── migrations/          0001-0009 reference schema
│   ├── test/                domain, service, HTTP, provider and console tests
│   └── scripts/             structure boundary check
├── sdk/                     @bitos/pay-js server-side client and verifier
├── ui/                      zero-build merchant console, checkout and demo pages
└── docs/                    this specification and evidence pack
```

This is a **modular monolith with an outbox worker in the same process**. It is
deliberately smaller than the long-term monorepo so that ledger, state machine and
webhook commits stay in one transactional boundary before there is operational
volume to justify separate deployments.

## 3. Target shape from the idea

The idea proposes a fuller monorepo:

```text
bitos-pay/
├── apps/
│   ├── api/
│   ├── merchant/
│   ├── checkout/
│   ├── developer/
│   └── worker/
├── packages/
│   ├── core/
│   ├── ledger/
│   ├── adapters/{lightning,nwc,cashu}/
│   ├── nostr/
│   ├── sdk-js/
│   ├── sdk-nuxt/
│   ├── types/
│   └── config/
├── database/{migrations,seeds}/
├── infrastructure/{docker,nginx,monitoring}/
├── docs/{architecture,api,integration}/
└── package.json
```

The target is a direction, not an instruction to move files now. The ecosystem
document standard deliberately keeps each product as a small package family while
the implementation is a synthetic reference.

## 4. Mapping

| Idea target | Current reference | Status | Split trigger |
| --- | --- | --- | --- |
| `apps/api` | `service/src/api` | Reference | A second API deployment or independent API release cadence |
| `apps/worker` | in-process expiration and webhook worker | Reference | Webhook volume, independent scaling or provider retries need their own process |
| `apps/merchant` | `ui/console.html` + `console.js` | Reference | Nuxt/merchant app is selected and replaces the zero-build console |
| `apps/checkout` | `ui/checkout.html`, `payment-link.html` + scripts | Reference (signed links + live status; demo remains) | Checkout becomes a production Nuxt/hosted app |
| `apps/developer` | `ui` Developers view + this docs pack | Reference | Public developer portal and generated API reference are approved |
| `packages/core` | `service/src/application` + `domain` | Reference | Core is consumed by another runtime or package |
| `packages/ledger` | `service/src/domain/ledger.ts` + ledger repository | Reference | A second ledger consumer exists; do not split merely for names |
| `packages/adapters/*` | `service/src/infrastructure/providers` + `application/ports` | Reference | Two or more independent adapter releases, or a provider SDK with incompatible runtime needs |
| `packages/nostr` | console signer, onboarding and identity tables | Reference | ID or another product needs the same signer/authority component |
| `packages/sdk-js` | `sdk/` | Reference | Public package release and versioning begin |
| `packages/types` | API/domain types and shared contracts | Spec | Two consumers need generated wire types; shared contracts stay canonical |
| `database/` | `service/migrations` + `main/migrate.ts` | Reference | A dedicated database release process is approved |
| `infrastructure/` | absent; local commands only | Planned | A real deployment target exists |

## 5. Dependency rules

These rules follow the idea's separation of Payment Core, adapters and
applications, and are enforced for the reference service:

1. **Domain is pure.** `src/domain` does not import Fastify, PostgreSQL, a provider
   SDK, the HTTP API, the UI or infrastructure. It may use Node cryptography.
2. **Ports are contracts.** `src/application/ports` contains provider and secret
   interfaces with no implementation imports.
3. **Application owns orchestration.** `src/application` coordinates domain,
   repositories and ports. It does not import `src/api` or Fastify.
4. **Infrastructure implements.** Repositories and provider adapters implement
   ports. Provider adapters do not import API routes or application services; they
   may import `application/ports`.
5. **API is an edge.** `src/api` adapts HTTP and authentication to application
   services. It does not import the browser UI.
6. **UI is a consumer.** `ui` uses the same-origin API only. It never reads
   PostgreSQL, provider credentials or a server secret, and it never decides
   payment success.
7. **SDK is server-side.** `@bitos/pay-js` is for server integrations and webhook
   verification; no secret key belongs in browser code.
8. **No second source of truth.** Amount, settlement-proof and envelope wire
   formats come from ecosystem shared contracts. Nostr kinds come from the BNOS
   registry owner.

The provider connection selected for a console session is read-only and derived
from the same active-connection rule used by payment creation. Credential
material is never returned to the console.

## 6. Enforced check

```sh
pnpm --filter @bitos/pay-core run check:structure
```

The check scans the reference TypeScript tree and fails on:

- domain imports outside `src/domain` and Node cryptography;
- port imports of Fastify, PostgreSQL, provider SDKs or infrastructure;
- application imports of HTTP adapters;
- API imports of the UI;
- provider adapters importing API code or application services.

It is a local guard, not CI. A passing result means the current files respect the
declared boundaries; it does not prove runtime correctness.

## 7. Migration gates

Do not move to `apps/` and `packages/` until at least one of these is true:

- the worker must run and scale separately from the API;
- a second application consumes the core outside this package;
- a provider adapter needs an independent release or runtime;
- the public SDK is published and versioned;
- a deployment target requires separate artifacts;
- the reference is replaced by the selected production stack (PAY-D05).

A move must preserve package names or provide a compatibility window, update the
workspace manifest, all imports, test commands and docs, and add dated evidence.
It is a task, not a side effect of a feature.

## 8. Alignment matrix

| Idea section | Canonical document | Reference status |
| --- | --- | --- |
| Product vision, surfaces, users, principles | [BLUEPRINT](BLUEPRINT.md) | Spec + reference surface |
| Modular monolith, adapter layer, stack | [ARCHITECTURE](ARCHITECTURE.md) | Reference core; target apps planned |
| Payment flow and state machine | [ARCHITECTURE](ARCHITECTURE.md), [PRODUCT](PRODUCT.md) | Reference sandbox flow |
| Database modules and invariants | [DATA-MODEL](DATA-MODEL.md) | Reference migrations `0001`-`0014` |
| API and webhooks | [API](API.md) | Reference `/v1` + console |
| Nostr integration | [INTEGRATION](INTEGRATION.md), [SECURITY](SECURITY.md) | Reference NIP-07/NIP-46/opt-in nsec; NIP-47/NIP-57 not built |
| MVP surfaces | [PRODUCT](PRODUCT.md), [UX-UI](UX-UI.md) | Console and synthetic checkout |
| Roadmap and environments | [ROADMAP](ROADMAP.md), [OPERATIONS](OPERATIONS.md) | Planned |
| Business model | [BLUEPRINT](BLUEPRINT.md) | Hypothesis only |
| Security and legal | [SECURITY](SECURITY.md) | Reference controls; no pilot |
| Evolution to NWC/Cashu/LocoSats/agents | [ROADMAP](ROADMAP.md) | Planned gates |
| Repository structure | this document | Reference shape; split deferred |

## 9. Open structure gaps

- Merchant-managed LND/Core Lightning and per-merchant external provider
  connections are not configurable. The reference provisions one sandbox
  connection, selects one global live adapter (LNbits, Blink or Strike) and reads
  the selected route only.
- No separate worker, Redis/BullMQ or Hasura deployment exists.
- No Nuxt merchant/checkout/developer applications exist; the zero-build UI is a
  reference, not the selected production frontend.
- No NWC, Cashu or on-chain adapter exists.
- No generated SDK types or public package release exist.
- The ecosystem workspace manifest still points at `service/`, `sdk/` and `ui/`.

These are recorded so that "follows the idea" does not become a claim that the
full blueprint is built.
