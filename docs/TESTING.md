# BitOS Pay — testing

Status: **Spec + synthetic reference evidence.** The reference core has 99 passing
local tests and the `@bitos/pay-js` SDK has 11 tests, dated 2026-11-13; see [EVIDENCE-2026-11-13](EVIDENCE-2026-11-13.md).
No production, provider, reconciliation, security-review, pilot or CI test run is claimed. This page defines what must be tested and what evidence a release needs.

## 1. Test layers

| Layer | Scope | Examples |
| --- | --- | --- |
| Contract | API schema, DB constraints, shared contract composition | Required idempotency key, integer amount, scale, webhook shape |
| Domain unit | State machine, fees, ledger rules | Illegal transition, balanced entry, fee snapshot |
| Adapter | Provider normalization | Duplicate event, unknown state, signature failure |
| Integration | API + database + fake provider | Intent to ledger to outbox with no network |
| End-to-end | Merchant UI, checkout, provider sandbox, webhook consumer | BNOS order paid once |
| Security negative | Authorization, tenant, replay, key scope | Cross-tenant read, revoked key, forged callback |
| Fault and chaos | Provider, worker, database and queue failures | Timeout, crash, failover, retry storm |
| Reconciliation | Local vs provider history | Missing callback, late payment, mismatch |
| Accessibility and locale | Checkout and dashboard | Keyboard, live region, Lao/English strings |
| Load | Bounded synthetic volume | Expiry backlog, webhook throughput |

Automated tests use synthetic merchants, invoices, keys and customer references.
Lightning tests use regtest or signet, never mainnet funds.

## 2. Fault matrix

| Fault | Expected behavior |
| --- | --- |
| Provider timeout before invoice | Intent not left `PENDING` with a missing invoice; retry is idempotent |
| Invoice created, response lost | Same idempotency key returns the same invoice; no second invoice |
| Callback lost | Authenticated status poll or reconciliation finds settlement; no false failure |
| Duplicate callback | One transaction; duplicate recorded and ignored |
| Callback out of order | Older event cannot regress a terminal state |
| Provider says failed after local pending | Intent `FAILED`, no ledger posting; retry is a new intent |
| Provider says paid after expiry | Quarantine; no automatic success and no order-paid event |
| Amount, currency or scale mismatch | Proof rejected with a stable error; alert raised |
| Payee or payment hash mismatch | Proof rejected; no ledger posting |
| Blink Svix signature or timestamp invalid | 401; no state change; secret rotation documented |
| Strike HMAC signature invalid | 401; no state change; provider event is not recorded |
| Strike receive-request id resolves to a different hash | Proof rejected; no ledger posting |
| Live cancellation is requested from Strike | Fail closed with `PAY_STATE_ILLEGAL`; no local false cancellation |
| Webhook endpoint returns 500 or times out | Retry with backoff; delivery log updated; dead letter after limit |
| Webhook secret rotated | New secret signs the primary header; old secret signs only the previous header until expiry |
| Rotated secret reaches its grace expiry | Previous header is no longer sent; only the current secret verifies |
| Webhook delivered twice | BNOS consumer deduplicates by event id |
| Worker crash before commit | Nothing posted; safe retry from provider state |
| Worker crash after commit before delivery | Outbox retries delivery; no duplicate ledger entry |
| Database failover during intent creation | Request fails or retries safely; no partial intent |
| Ledger imbalance injected | Transaction aborts and alert fires |
| API key revoked during a flow | Next request denied; in-flight verified payment still reconciles |
| Tenant id swapped in a request | Not-found; no data leak; security alert |
| Stale quote on fiat intent | Rejected; no invoice issued |
| NWC session revoked | Wallet action denied and connection marked degraded |
| Browser return after plan checkout | Subscription stays `PENDING_PAYMENT`; no entitlement |
| Duplicate subscription provider event | One active subscription and one entitlement revision |
| Entitlement expired or tenant swapped | New paid feature denied; no role or ownership change |
| Checkout token tampered, unknown or for another intent | Not-found; no merchant-wide fallback and no internal ids |
| Payment link token tampered or link disabled | Not-found; no invoice is created |
| Payment link invoice spam from one client | Per-IP limit returns `PAY_RATE_LIMITED`; merchant risk still applies |
| Payment link customer retries the create button | Same idempotency key returns the same intent; a new customer gets a new intent |
| Merchant profile update without `merchants:write` | Denied with `PAY_AUTH_SCOPE` |
| Merchant profile website uses `javascript:` or malformed email | Rejected with `PAY_VALIDATION_BODY`; stored profile unchanged |
| Console profile update without CSRF | Rejected; no audit or profile change |
| Console reconciliation without CSRF | Rejected; no settlement record or audit |
| Reconciliation end date before start date | Rejected with `PAY_VALIDATION_BODY` |
| Reconciliation history after a run | New stored record appears first with period, net, transaction count and ledger status |
| API reference loads `/openapi.json` | Endpoint count, groups and method/path/summary rows render; search narrows to matching settlement endpoints |
| API reference search has no matches | Zero-row empty state is announced; clearing the query restores the catalog |
| Create API key with 30-day expiry | Response and list include `expires_at`; auth succeeds before expiry |
| Use an expired API key | 401 `PAY_AUTH_EXPIRED`; rotating it returns 409 while revocation remains possible |
| Invite a cashier by Nostr pubkey | Member list shows `CASHIER`; member key is absent from `/api-keys`; signer session receives only payments read/write |
| Cashier calls a keys endpoint | 403 `PAY_AUTH_SCOPE` |
| Revoke an invited member | Identity and hidden key are revoked; the existing session and next sign-in fail |
| Create a location and attach it to an intent | Location returns an uppercase code; intent create/detail return the same `location_id` |
| Reuse a location code | 409; original location remains unchanged |
| Create an intent with a disabled location | 404 `PAY_NOT_FOUND_LOCATION` |
| Update webhook endpoint events | Endpoint returns the new event set; URL and secret are unchanged |
| Update a disabled webhook endpoint | 400 `PAY_WEBHOOK_INVALID` |
| Export payments CSV | `text/csv`, attachment filename, header row and tenant rows; a `=SUM(1,1)` reference is neutralized |
| Export an empty payment range | CSV contains only the header row |
| Export reconciliation CSV | Stored `stl_` record and ledger fields appear |
| Cancel from the console | POST with CSRF cancels an unpaid intent; a second cancel returns `PAY_STATE_TERMINAL` |
| Page console payments | 21 intents expose a 20-row first page and cursor; the next page returns one; `status=SUCCEEDED` isolates the settled intent |
| Rename and re-enable a location | PATCH updates the name and returns ACTIVE; a disabled location rejects an intent, then accepts one after re-enable; an empty body returns 400 |
| Customer leaves checkout pending | Page keeps showing pending and never marks paid from browser state |
| Provider settles while checkout is open | Poll changes the public view to paid and shows the receipt |
| Public checkout projection requested | Only merchant name, amount, reference, invoice and confirmed status; no metadata, provider or tenant ids |
| Paid plan without merchant verification | Plan may activate; live payments remain denied |

## 3. Acceptance gates

These mirror the v0.1 definition of done in [PRODUCT](PRODUCT.md):

| Gate | Evidence |
| --- | --- |
| G1 Merchant creates an intent | API record and response with valid state |
| G2 Customer sees a Lightning QR | Hosted checkout render with the real invoice and expiry |
| G3 Customer pays with a Lightning wallet | Provider sandbox settlement |
| G4 Provider confirms the transaction | Verified callback or authenticated poll |
| G5 Ledger is balanced and correct | Debit = credit, fee and net snapshot |
| G6 Webhook reaches BNOS | Signed delivery recorded at the consumer |
| G7 Duplicate webhook is harmless | One order-paid effect after repeated delivery |
| G8 Reconciliation passes | Provider history matches local transactions |
| G9 Provider outage and invoice expiry handled | Documented fault run with quarantine |
| G10 Security review passes before pilot | Independent review record and closed findings |

Tenant isolation, key rotation and restore are release-blocking even though they
are not separate lines in the source definition of done.

### Plan and entitlement checks (planned)

These are P2 contract checks, not v0.1 release gates.

- Free workspace and sandbox merchant creation do not require a plan.
- A provider-confirmed plan payment activates exactly one subscription for the
  mapped organization.
- A refund, chargeback or expiry downgrades features after the configured grace
  period but leaves records and roles intact.
- An entitlement cannot grant owner, membership, role, API key or live-payment
  state; attempts are ignored or rejected.
- Payer and owner may differ; a payer does not acquire ownership.

## 4. Reconciliation checks

- Every provider invoice is either bound to one attempt or listed as unmatched.
- Every settled invoice has one transaction and one balanced entry set.
- Every transaction has a fee snapshot and a net amount.
- No terminal intent changed after its terminal timestamp.
- No webhook event was delivered for a state that the database does not hold.
- Sum of ledger accounts equals the reconciliation export for the period.
- Unknown provider results remain visible until a human resolves them.

## 5. Evidence policy

A status may move to a completed claim only when a dated evidence record exists
in the repository with: date, environment, commit or artifact reference, command
or manual step, observed result, and reviewer. Security and reconciliation gates
need a reviewer who did not write the change.

There is no CI claim in this pack. When implementation exists, the verified local
commands and their results are recorded here or in a linked dated evidence file.
Screenshots alone are not evidence for money movement; logs and records with
synthetic data are.

Reference-core result (2026-11-14):
`pnpm --filter @bitos/pay-core run check:structure` passed the five package
boundaries, `typecheck` passed and `pnpm --filter @bitos/pay-core test` passed 114
local tests across domain, service, HTTP, core API features, refunds/risk,
console sessions/webhook setup, NIP-07 link/login, signer method config,
provider routing, Blink/Strike adapters, signed provider callbacks, hosted
checkout and a PGlite integration.
`pnpm --filter @bitos/pay-js typecheck` and `pnpm --filter @bitos/pay-js test`
passed 11 SDK tests. A separate compatibility smoke ran the SDK against the
live reference service (invoice, settlement, refund, list and summary). Headless
Chrome then exercised `/console/`: key login, overview, payment creation and key
creation, with no JavaScript exceptions. The real
PostgreSQL 16.14 integration test passed for migrations `0001`-`0006`, and live
smoke runs covered direct invoices, pagination, quotes, scoped keys, settlement
reporting, webhook delivery/replay/disable/fan-out, refunds and a risk amount
limit. The static reference UI is checked with browser rendering and interaction scripts but has no
automated test suite; those checks are UI evidence only. The exact commands,
scope and missing gates are in
[EVIDENCE-2026-11-13](EVIDENCE-2026-11-13.md) and
[EVIDENCE-2026-11-14](EVIDENCE-2026-11-14.md). This is not a release-gate pass.

## 6. Release exit criteria

- All P0 features have verified acceptance gates and recorded evidence.
- No open SEV1 or SEV2 defect; known P1 gaps are listed and accepted by the
  product owner.
- Rollback and restore drills have a dated result.
- Legal review confirms the selected custody model; hosted custody remains
  blocked until licensing review completes.
- Merchant-facing Lao and English copy has human review.
- The pilot scope names the merchants, amount limits, support channel and stop
  conditions. A pilot is not authorized by this document.

See [SECURITY](SECURITY.md) for threats and [OPERATIONS](OPERATIONS.md) for
runbooks used during fault tests.
