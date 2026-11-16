# Instructions for BitOS Pay

Follow the ecosystem `AGENTS.md` first. Before editing, read `README.md`,
`docs/README.md`, `docs/DECISIONS.md`, `docs/SECURITY.md`,
`docs/STRUCTURE.md`, `docs/TESTING.md` and `../shared/PROTOCOL.md`, plus the
documents that own the area you are changing (`docs/API.md`, `docs/DATA-MODEL.md`,
`docs/UX-UI.md`, `docs/TENANCY.md`, `docs/RUNNING.md`). The `docs/README.md`
reading order is authoritative.

Status is **synthetic reference core and reference UI**, not production, pilot,
CI or real-money readiness. Source code and verified tests establish current
behavior; plans and status labels do not.

## Scope and ownership

- Scope: payment intents, Lightning/provider adapters, double-entry ledger,
  settlement, signed webhooks, merchant console/checkout and the server-side SDK.
- BNOS owns orders, stock, receipts and the Nostr kind registry. BitOS ID owns
  identity and business verification. Ecosystem shared contracts own amount,
  envelope, private transport and settlement-proof wire formats. Compose these
  contracts; do not fork them here.
- Never invent, reserve or reinterpret Nostr kind numbers. Reuse an approved
  kind/profile through the registry owner.
- Do not build or imply custody, stored customer balances, fiat/LAK exchange,
  payouts, live KYB, shared live multi-tenancy, a platform risk-admin console or
  a production frontend without updating the relevant decision and gates.
  PAY-D01, PAY-D02, PAY-D05, PAY-D08, PAY-D12 and PAY-D24 remain open, planned
  or blocked.
- Do not rewrite the Node/TypeScript reference as a side effect. PAY-D05 is open;
  a runtime change needs its own decision and migration plan. New enforcing
  services follow the ecosystem backend preference only after that decision.
- Keep the modular monolith. Do not move to `apps/` and `packages/` without a
  split trigger and an evidence-backed migration task.

## Architecture boundaries

Run `pnpm --filter @bitos/pay-core check:structure` when touched code could
change imports or layering. The enforced rules are:

- `src/domain` is pure: no Fastify, PostgreSQL, provider SDK, API or UI imports;
  Node cryptography is allowed.
- `src/application` orchestrates domain, ports and repositories; it does not
  import `src/api` or Fastify.
- `src/application/ports` contains contracts with no implementation imports.
- `src/infrastructure` implements repositories and adapters; adapters do not
  import API routes or application services.
- `src/api` is the HTTP/auth edge; it does not import the browser UI.
- `ui` uses the same-origin API only. It never reads PostgreSQL, provider
  credentials or server secrets, and it never decides payment success.
- `@bitos/pay-js` is server-side. Never put a secret API key in browser code.

The provider connection exposed to the console is read-only routing metadata;
credential material is never returned to a client.

## Money and payment invariants

- Money is integer minor units or millisatoshis with an explicit unit/scale.
  Never use floating point, infer scale, or compare currencies without an
  explicit dated quote.
- Lightning is BTC-denominated. Do not silently relabel a BTC amount as fiat or
  LAK; use the reviewed amount profile and migration.
- One intent has one payment authority. Creation is idempotent; one intent has at
  most one successful attempt; retrying a terminal intent creates a new intent.
- The provider confirms settlement. A browser redirect, relay event, webhook
  body or client claim is never proof of payment.
- Verify provider callback signature, timestamp, event identity, invoice/payment
  hash, payee and amount. Deduplicate events and re-query provider state before
  posting a transaction.
- Enforce the payment state machine. Terminal intents are immutable. Unknown
  provider state stays pending and visible; never invent success or failure.
  Late or at/after-expiry payments are quarantined for human reconciliation.
- Transaction, fee snapshot, balanced ledger entries and outbox event commit in
  one transaction. Debit must equal credit. Posted ledger entries are
  append-only; corrections are reversal entries.
- Webhooks are signed over the raw body, use event ids, retry with backoff,
  record deliveries and dead-letter after the limit. Secret rotation uses a
  bounded dual-signature window.
- Reconciliation and quarantine are explicit. Do not assume provider history is
  complete or repair partial financial state with a background script.

## Security, privacy and fail-closed behavior

- Every tenant-owned query is scoped by organization/merchant before retrieval.
  Missing tenant scope is a denial, not a global fallback. Cross-tenant access
  returns not-found, not another tenant's data.
- Check API-key scopes, key status/expiry, merchant status, console mode and
  `livemode` on every privileged request. A plan, Nostr pubkey, ID membership,
  Workspace role or UI toggle is never payment authority.
- Fail closed when authorization, revocation, entitlement, connection-health,
  KMS or secret-store state is unavailable. Offline drafts may remain useful;
  they cannot authorize a stale privileged write.
- Never log, store, commit or expose API keys, Nostr `nsec`, wallet seeds,
  preimages, provider secrets, webhook secrets, private payment metadata or
  personal data. Use synthetic fixtures.
- API keys are high-entropy, shown once, hashed at rest, scoped and revocable.
  Console sessions use HttpOnly, SameSite=Strict cookies, CSRF on writes and
  server-side revalidation. Leave local `nsec` signing disabled unless the
  controlled-sandbox tradeoff is explicit.
- Live adapters are opt-in and fail closed. Sandbox must remain isolated from
  live credentials. One deployment has one global live provider account today;
  do not pool multiple live merchants or claim fund isolation. Blink and Strike
  are custodial provider accounts, not BitOS custody.
- Platform risk-admin actions and shared live tenancy require the separate MFA,
  audit, dual-control and isolation gates. Do not approximate them by giving a
  merchant key a wildcard scope or bypassing tenant-scoped routes.

## Tests and evidence

Add meaningful tests for every changed behavior. Depending on the change, cover:
tenant/auth negatives, key revocation/expiry, replay/duplicate callbacks,
amount/scale tampering, payee/hash mismatch, illegal state transitions, ledger
imbalance, webhook signature/rotation/retry, quarantine/reconciliation,
provider timeout/unknown state, migration compatibility and UI states.

Run the relevant verified commands from the ecosystem root:

```sh
pnpm --filter @bitos/pay-core check:structure
pnpm --filter @bitos/pay-core typecheck
pnpm --filter @bitos/pay-core test
pnpm --filter @bitos/pay-js typecheck
pnpm --filter @bitos/pay-js test
node bitos-pay/ui/check.mjs
```

For PostgreSQL integration:

```sh
PAY_RUN_INTEGRATION=1 pnpm --filter @bitos/pay-core test:integration
```

Do not claim CI, production, pilot or security-review results. Report exact
commands and observed results. A completed claim needs a dated evidence record
with environment, commit/artifact, command or manual step, result and reviewer.
Update the affected evidence file when behavior or test coverage changes.

## UI and content

- Keep the zero-build UI and shared design tokens. Preserve same-origin API use,
  keyboard access, visible labels, focus states, live regions and responsive
  layouts.
- English and Lao come first; Thai is an expansion. Use locale-independent
  amounts and UTC timestamps internally, with explicit display formatting.
- Checkout and console must show provider-confirmed truth only. Do not mark a
  payment paid from polling, browser state or a success-page redirect.
- Respect `PAY_CONSOLE_MODE` and live-action gating. Live refunds, plan changes
  and live onboarding fail closed while unimplemented.

## Workflow

- Start from one `PAY-TNN` or `ECO-TNN` item. Record scope, dependencies,
  acceptance evidence and unresolved risks; do not mark a task done for writing
  a plan.
- Update the canonical docs, consumers and decision register when a contract,
  behavior or limitation changes. Preserve unknown fields where the approved
  compatibility policy allows them.
- Keep changes within this project's ownership. A shared contract change needs
  the canonical owner, fixtures and a migration note.
- `bitos-pay/` is its own git repository inside the ecosystem. Do not commit
  parent-repository changes, `.env`, `service/data/`, generated runtime state or
  secrets. Do not commit unless explicitly asked.
- If a request conflicts with a decision, security invariant or ownership
  boundary, stop and record the conflict instead of implementing around it.
