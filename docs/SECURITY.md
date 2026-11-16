# BitOS Pay — security, privacy and legal

Status: **Spec**. No security review has been performed. This page defines
required controls and the evidence a future review needs.

## 1. Trust boundaries

Customer device, merchant staff device, Pay API, Pay worker, payment provider or
node, merchant wallet (NWC), PostgreSQL, secret store, object storage and Nostr
relays are separate boundaries. A relay and a browser are never payment
authorities. A provider callback is untrusted until its signature, event
identity, invoice binding and amount are verified.

## 2. Authority

| Action | Who may authorize | Enforcement point |
| --- | --- | --- |
| Create intent | Key with `payments:write` or merchant role `cashier`+ | Pay Core, tenant scope |
| Cancel intent | Key with `payments:write` and manager role; non-terminal only | Pay Core state machine |
| Refund or reverse | Key with `payments:refund` and manager role | Pay Core + ledger reversal |
| Register webhook | Merchant admin with MFA | Pay Merchant, endpoint scope |
| Create/rotate/revoke API key | Organization owner/admin with MFA; optional expiry up to 365 days | Pay Merchant + audit |
| Edit merchant profile | Key with `merchants:write` or merchant admin | Pay Merchant + audit |
| Invite or revoke a team member | Key with `keys:write`; owner role cannot be revoked | Pay Merchant + audit |
| Create or disable a location | Key with `merchants:write`; tenant-scoped code uniqueness | Pay Merchant + audit |
| Create a sandbox organization | Anyone when `PAY_ONBOARDING_ENABLED=1`; per-IP limit; sandbox only | Onboarding service + audit log |
| Buy or upgrade an organization plan | Organization owner or billing admin; provider confirms payment | Pay subscription + plan invoice |
| Read a plan entitlement | Authenticated consumer service for its organization | Pay entitlement API, tenant-scoped |
| Activate live merchant payments | Verified merchant owner/admin; plan payment is irrelevant | Pay risk + provider onboarding |
| View transaction detail | Merchant staff with finance or cashier role | Tenant-scoped query |
| Change fee or limits | Platform risk admin with MFA | Platform admin, dual review |
| Verify or suspend merchant | Platform risk admin with MFA | Platform admin + audit |
| Change provider connection | Organization owner + platform review | Pay Core + audit |
| Enable shared live tenancy | Platform architecture, security and risk sign-off; never a merchant toggle | Deployment gate + audit |
| Replay a dead webhook | Support role, logged | Developer console |
| Hold customer funds | Not authorized in MVP | Custody gate PAY-D01 |

A UI toggle, Nostr pubkey, ID membership, Workspace role or paid plan is never
permission.
A payee cannot change after an invoice is issued for that intent.

The reference enforces API-key scopes and merchant status. Staff manager roles,
MFA and the platform risk-admin console are planned; they are not implemented by
the local reference. The `/console/` reference page accepts an API key matching the configured
`PAY_CONSOLE_MODE` or a linked NIP-07 Nostr signer, stores only a hashed session
token in an HttpOnly, SameSite=Strict cookie, checks CSRF on writes, rechecks the
key and linked identity on every request and rejects a key for a disallowed or
unselected mode. A Nostr key must first be linked
from an API-key session with `keys:write`; the signature proves possession, not a
merchant role. It is a reference adapter, not the production human-login
contract. Live refunds fail closed because no provider refund exists.

## 3. Custody model

1. **Non-custodial** — the customer pays from their own wallet; Pay never holds
   funds. Default for v0.1.
2. **Merchant-controlled** — the merchant connects their own node or provider.
   Pay orchestrates and reconciles only.
3. **Hosted custodial** — BitOS holds or controls funds. Blocked until
   licensing, reserves, customer-asset custody, accounting and risk review with
   the Bank of the Lao PDR and local counsel are complete (PAY-D01, PAY-D12).

Do not build a stored customer balance in the MVP. A ledger-derived merchant
balance is an accounting view, not a deposit.

## 4. Threats and controls

| ID | Threat | Control | Failure mode |
| --- | --- | --- | --- |
| T01 | Forged webhook or provider callback | HMAC/provider signature, timestamp, event id, invoice binding | Reject and alert; never mark paid |
| T02 | Replayed callback or delivery | Event dedup, five-minute signature window, unique proof | Reject duplicate; delivery log records it |
| T03 | Double payment or double settlement | Idempotency key, one-successful-attempt rule, unique settlement proof | Quarantine and manual reconciliation |
| T04 | Amount, currency or scale tampering | Server-side recompute, integer validation, quote and fee snapshot | Reject request or proof |
| T05 | Cross-tenant read or write | `organization_id` on every tenant row, scoped queries before retrieval | Not-found response, security alert |
| T06 | API key leak in client or log | Server-only secret keys, hashed storage, scopes, rotation, redaction | Revoke key and review usage |
| T07 | Provider outage or partial callback loss | Timeout, authenticated status poll, provider payment-time proof, reconciliation job | Recover a proven pre-expiry payment; quarantine a payment at/after expiry; never invent failure |
| T08 | Invoice or payee substitution | Bind payment hash, payee, amount and expiry to the attempt | Reject proof as `STL-*` mismatch |
| T09 | Insider misuse of admin tools | Least privilege, MFA, append-only audit, dual control for high risk | Deny action, preserve audit |
| T10 | Backup theft or unreadable restore | Encryption at rest, separate key custody, periodic restore test | Refuse restore without key; incident review |
| T11 | Merchant key, nsec or NWC secret theft | Never store nsec/seed; encrypted NWC session; revoke and re-pair | Disable connection and fail closed |
| T12 | Private payment data on a relay | Private-only defaults, ciphertext, explicit public allowlist | Block publication |
| T13 | Refund or reversal abuse | `payments:refund` scope, original-transaction lock, amount ceiling; live refunds fail closed | Require manual approval |
| T14 | Dependency or image compromise | Pinned versions, reviewed images, SBOM, secret scanning | Roll back and rotate secrets |
| T15 | Console session theft or stale privilege | HttpOnly + SameSite=Strict cookie, CSRF on writes, eight-hour TTL, key/identity revalidation and logout | Revoke the session and API key; deny the write |
| T16 | Signer challenge replay, phishing or substitution | One-time five-minute challenge, kind `22242`, origin-bound `relay` tag, server-side Schnorr verification, session-bound linking and allowlisted remote relay | Reject the proof; consume the challenge; deny the session |
| T17 | Raw `nsec` exposure through page memory or XSS | Disabled by default; same-origin worker, no network/storage, immediate clear; NIP-07/NIP-46 preferred | Disable the opt-in, clear inputs and rotate the key |
| T18 | Sandbox-onboarding abuse, challenge replay or resource exhaustion | Disabled by default, per-IP hourly cap, one-time 300-second challenge, Schnorr verification, sandbox-only key and no live capability | Reject creation and alert; rotate/disable the feature |
| T19 | Forged, replayed or stale plan entitlement | Versioned, tenant-scoped, short-lived read model; provider-confirmed activation; consumer rechecks before a new paid action | Deny the new paid feature; keep core access; alert and reconcile |
| T20 | Workspace-link takeover or false business authority | Signed one-time challenge binds `bnos:<workspace_id>`; unique `subject_ref`; owner-key match required on resync; owner proof is labelled unverified | Reject with `PAY_SUBJECT_CONFLICT`; keep existing link; require reviewed verification |
| T21 | A new Nostr key auto-provisions a merchant and receives a sandbox key | One-time challenge, onboarding env gate, per-IP limit, one linked signer identity per key; response returned once; no live key or business verification; replay rejected | Deny creation or sign-in; disable onboarding; rate-limit the source |
| T22 | Accidental live payment from sandbox traffic or a config typo | Separate sandbox mock and live provider, explicit `PAY_LIVE_ENABLED` plus provider credentials, per-mode routing and fail-closed startup | Refuse startup or route to mock; disable live and rotate provider keys |
| T23 | Forged or replayed provider webhook | LNbits constant-time token; Blink Svix HMAC with timestamp; Strike HMAC over raw body; server-side status check, amount check where exposed, provider-event dedupe and invoice/hash/connection binding | Reject the callback; quarantine or reconcile; rotate the provider webhook secret |
| T24 | Checkout-link enumeration, token tampering or data overexposure | HMAC-signed stateless token, random intent id, constant-time signature check, public allowlist projection, `no-store`/`no-referrer`/`noindex`, no write authority | Return 404 or the limited projection; rotate the service secret if links leak broadly |
| T25 | Compromised or stale webhook signing secret | Scoped rotation, new secret shown once, old secret only through a bounded dual-signature window, delivery log and audit event | Rotate again or disable the endpoint; consumers must reject after expiry |
| T26 | Reusable payment-link abuse, invoice spam or token tampering | HMAC-signed link token, active-status lookup, `payments:write` creation, per-IP invoice limit, merchant risk/provider gates, no browser authority | Reject disabled/tampered links, return 429 at the limit, disable the link and review usage |
| T31 | Spreadsheet formula execution or cross-tenant data in CSV exports | Session + `payments:read`, tenant-scoped query, RFC 4180 quoting and `'` prefix for `= + - @`, bounded row count | Export a reference beginning with `=` and confirm it is neutralized; export from another merchant and confirm isolation |
| T32 | Custodial Blink/Strike balance concentration or provider account takeover | Explicit custody disclosure, dedicated live account, API key and webhook secret rotation, provider-side limits, reconciliation; no multi-merchant isolation claim | Disable live, revoke provider credentials, reconcile the account and review exposure |
| T33 | Cross-tenant provider connection or credential reuse | Connection belongs to one organization/merchant, explicit routing, no global credential fallback, encrypted connection-bound secret and audit | Reject the operation, disable the connection, investigate exposure and rotate the secret |
| T34 | Shared live deployment commingles merchant funds or attribution | One provider account/node per live merchant, no pooled custodial account without PAY-D01 approval, per-connection reconciliation and limits | Stop shared live, quarantine unmatched payments, reconcile and notify affected merchants |
| T35 | Webhook routing confusion settles the wrong merchant | Opaque connection token hashed at rest, resolve tenant before payload trust, provider signature over raw body, connection-scoped event dedup and status re-query | Reject and alert; freeze affected connections; replay only after evidence review |
| T36 | Accidental live action or key exposure through the browser console | Explicit `PAY_CONSOLE_MODE=sandbox/live/both`, server-side key/mode match, red live banner, sign-out on mode switch, no live refund/plan/onboarding, HttpOnly session and no browser storage of the key | Reject the request, revoke the session/key, disable the mode and reconcile any live action |
| T30 | Cross-tenant or disabled location selected for a payment | Tenant-scoped active-location lookup before intent creation, unique code per merchant, audit | Create a location for merchant A, attempt it from merchant B, then disable it and retry |
| T29 | Over-broad staff access or a revoked member retaining access | Preset role scopes on a hidden member key, `keys:write` invite/revoke, identity and key revocation, per-request session recheck | Invite a cashier, confirm limited scopes, revoke and confirm 401 on the next request |
| T28 | Long-lived API keys remain valid after staff or integration turnover | Optional 1–365 day expiry, expiry enforcement before use, expiry preserved on rotation, expired keys shown and revocable | Create a short-lived key, wait for/past expiry, confirm 401 `PAY_AUTH_EXPIRED` and rotate rejection |
| T27 | Unauthorized or unsafe merchant-profile change | Dedicated `merchants:write` scope, CSRF for console writes, name/email/website validation, audit; verification state remains read-only | Reject with scope/validation error and review audit |

Provider-side fraud, merchant dispute behavior and customer chargeback-like
claims are not solved by cryptography. Lightning payments are final; refunds are
a merchant policy and a Pay record, not a reversal of the network payment.

## 5. Fail-closed rules

- Authority or revocation state unavailable → deny the privileged action.
- Signature invalid, expired or missing → reject; no state change.
- Provider state unknown → keep pending and quarantine; never emit success.
- Ledger entry set unbalanced → abort the transaction and alert.
- Quote missing, stale or with unknown scale → reject fiat intent creation.
- Tenant scope absent from a query → deny; do not fall back to a global query.
- Secret store unavailable → refuse to create a payment or charge a key.
- Console API key revoked, expired or unauthorised → revoke the session and deny.
- Nostr challenge expired, replayed, origin-mismatched or signature-invalid → deny.
- Linked Nostr identity revoked or its API key inactive → revoke the session and deny.
- Reconciliation mismatch → do not complete settlement.
- Sandbox onboarding disabled, over its IP limit or presented with an invalid,
  replayed or expired Nostr proof → reject creation; no org, merchant or key is
  created.
- Entitlement missing, expired, forged or for another organization → do not
  activate a new paid feature; keep core access and show billing unknown.
- Entitlement attempts to change owner, membership, role or live-payment state →
  reject; those changes have separate authority paths.
- Plan payment succeeds but merchant verification is absent → plan may activate;
  live payments remain denied.
- Checkout token invalid, tampered or for an unknown intent → return not-found;
  never fall back to a merchant-wide query or expose internal metadata.
- Shared-live request lacks an explicit organization, merchant or connection
  scope → deny; do not fall back to a global provider or credential.
- Shared-live provider callback token is unknown, disabled or resolves to another
  tenant → reject; do not process the payload.
- Console API key mode does not match `PAY_CONSOLE_MODE` or the requested mode →
  reject sign-in and revoke the stale session.
- Live console attempts an unsupported refund, plan change or live onboarding →
  deny; do not fall back to sandbox behavior or a global credential.
- Secret manager or KMS unavailable → deny live payment creation and connection
  verification; sandbox may continue only without live secrets.
- Connection health, verification or live-activation state is unavailable →
  deny new live payment creation and keep existing intents pending.

Cached reads and offline drafts may continue; they cannot authorize a stale
privileged write.

## 6. Key and secret handling

- Never store, log or transmit a Nostr `nsec`, wallet seed, BIP-39 phrase or raw
  private key. NIP-07 keeps the signer key in the extension.
- The reference's local `nsec` worker is opt-in (`PAY_CONSOLE_ALLOW_NSEC=1`),
  including the browser-generated create-account key, and is not recommended. It
  receives the key only in the same-origin worker, makes no network request and
  clears the input after signing. This covers console login and signed
  onboarding. The optional backup download is user-initiated, is not retained by
  BitOS and must be treated as a secret. It does not remove the XSS/key-theft
  risk; disable it outside a controlled sandbox.
- NIP-46 messages carry encrypted requests through the configured relay; choose
  a trusted relay and approve the request in the remote signer. A relay is not an
  authorization authority. The QR flow uses an ephemeral client key and scopes
  the request to `sign_event:22242`.
- API keys are high-entropy, shown once, stored as a slow hash with a searchable
  prefix, scoped, rotatable and revocable; `last_used_at` is recorded.
- Webhook endpoints have per-endpoint secrets; rotation supports a dual-secret
  verification window.
- Provider and NWC credentials live in a secret manager and are referenced, not
  copied into tables or logs.
- Admin actions require MFA and append an audit record.
- Console session tokens are random, stored only as SHA-256 hashes, expire after
  eight hours by default, are revoked on logout and fail closed after key or
  linked-identity revocation. Set `PAY_CONSOLE_COOKIE_SECURE=1` behind HTTPS.
- Signer challenges are random, stored only as SHA-256 hashes, expire after five
  minutes and are consumed once. Link challenges are bound to the console session.
- `PAY_CONSOLE_NOSTR_RELAY` allowlists the NIP-46 relay; the browser CSP only
  permits that relay origin for remote signing.
- Backups are encrypted; restore is tested on a schedule.
- Logs redact authorization headers, invoice preimages, keys and personal data.

## 7. Risk register

| ID | Risk | Status | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| PAY-R01 | Custody or exchange activity breaches Lao financial rules | Blocked | Non-custodial first; legal review before launch | Product + counsel |
| PAY-R02 | Reconciliation fails or a payment is counted twice | Open | Invariants DM-01…DM-13, fault tests, daily reconciliation | Payment lead |
| PAY-R03 | One Lightning provider dominates or fails | Open | Adapter boundary, status polling, second-provider plan | Architecture |
| PAY-R04 | Webhook forgery or replay harms BNOS orders | Open | HMAC, dedup, replay window, idempotent BNOS consumer | API lead |
| PAY-R05 | API key or secret compromise | Open | Scoped keys, hashing, rotation, monitoring | Security |
| PAY-R06 | Tenant data leak | Open | Org scoping, negative tests before pilot | Security |
| PAY-R07 | Amount, scale or quote error | Open | Integer money, explicit scale, snapshot, contract tests | Payment lead |
| PAY-R08 | Merchant fraud or disputed delivery | Open | Verification, limits, clear refund policy, manual review | Risk |
| PAY-R09 | 12-week estimate slips with one developer | Open | Phase gates, cut P1 first, no scope expansion | Product |
| PAY-R10 | Private transaction data reaches a relay | Open | Private-only defaults, allowlist, review | Privacy |
| PAY-R11 | Cashu mint insolvency or redemption failure | Blocked | Later phase; mint risk disclosure and limits | Product |
| PAY-R12 | Agent spending exceeds owner policy | Blocked | P3; gateway and Pay both enforce budget and approval | Agent + Pay leads |

## 8. Legal notes

Running a payment service, exchanging LAK/BTC or holding funds for others in Laos
requires review with the Bank of the Lao PDR and Lao legal counsel before launch.
Using Bitcoin or Lightning does not exempt a business from financial rules.
Required before hosted custody or exchange: entity and license analysis, reserve
and custody model, KYC/AML policy, sanctions screening, consumer disclosure,
dispute handling, tax treatment, record retention and an independent security
review. No phase in this pack assumes those approvals exist.

Operational controls are in [OPERATIONS](OPERATIONS.md); test evidence policy is
in [TESTING](TESTING.md).
