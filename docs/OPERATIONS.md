# BitOS Pay — operations

Status: **Spec**. No environment is running. Operational numbers are candidate
targets, not measured results.

## 1. Environments

| Environment | Purpose | Data |
| --- | --- | --- |
| Local | Development and fixtures | Synthetic only |
| Development | Shared integration | Synthetic |
| Sandbox | Developer testing with fake provider outcomes | Synthetic |
| Production | Live merchants after launch approval | Real, restricted |
| Self-hosted | Merchant- or partner-operated deployment | Merchant-controlled |

Each environment has separate keys, provider connections, webhook secrets and
database credentials. A production key is never valid in sandbox.

## 2. Persistence

- PostgreSQL is the source of truth for intents, attempts, invoices,
  transactions, ledger entries, fees and settlements.
- Intent state, transaction, ledger entries and the outbox event commit in one
  transaction. Partial writes are not repaired by a background script.
- Posted ledger entries are append-only. Corrections are reversal entries.
- The queue carries webhook delivery, expiry and reconciliation jobs; it is not
  a source of payment truth.
- Hasura reads projections for dashboards. It cannot write payment tables.
- Object storage holds exports and documents only; no invoice or key material is
  stored there unless encrypted and referenced by the database.
- Secrets live in a secret manager with restricted service identities.

## 3. Backup and restore

| Item | Requirement | Evidence needed |
| --- | --- | --- |
| Full backup | Daily, encrypted, off-host | Restore drill record |
| Point-in-time recovery | WAL or equivalent within the provider's window | Timestamped recovery test |
| Ledger archive | Financial retention period, immutable copy | Checksum and access review |
| Secret recovery | Separate custody from the database backup | Break-glass exercise |
| Restore test | Scheduled, into an isolated environment | Date, scope, result, owner |

A restore is not accepted until ledger totals, transaction counts and settlement
records match the pre-restore export. Encryption keys are never stored with the
backup they protect.

## 3.1 Live provider activation

A live adapter is a seam, not a launch approval. Before enabling one:

1. Use a dedicated live account and API key; never reuse sandbox credentials.
2. Select exactly one adapter with `PAY_LIGHTNING_PROVIDER=lnbits`, `blink` or
   `strike`, set `PAY_LIVE_ENABLED=1` and provide that provider's credentials and
   webhook secret. Use `RUNNING` for the exact values.
3. Register the provider callback URL and restrict it at the proxy. Never log the
   LNbits token, Blink Svix secret or Strike HMAC secret.
4. Verify the service fails closed with any missing value, and that sandbox
   merchants still use the mock provider.
5. Run a capped testnet/mainnet pilot, reconcile every settlement and quarantine,
   and keep live onboarding/KYB disabled until reviewed.

For more than one live merchant, deploy a **dedicated single-tenant instance per
merchant** until the shared-live gates in [TENANCY](TENANCY.md) have dated
evidence. Same codebase, separate database, domain, secrets and provider
account; do not pool merchants in one Blink/Strike account.

Blink and Strike are custodial accounts: one deployment pools their live funds
globally and does not isolate merchant balances. Do not present either as a
merchant-owned node or a multi-merchant service provider. Strike cancellation
is not implemented; the adapter fails closed.

Do not enable live from a shared development `.env`.

## 3.2 Shared live deployment gate

A shared live deployment is not a configuration change. It requires:

- connection-scoped provider credentials and encrypted/versioned secret storage;
- an opaque connection callback URL, provider signature verification and
  connection-scoped event deduplication;
- tenant-scoped repositories plus adversarial cross-tenant tests;
- KYB, risk limits and an explicit live activation/revocation record per
  merchant;
- status polling, reconciliation, quarantine and new-intent-only failover;
- secret rotation, append-only audit and per-tenant export/restore evidence.

Do not enable shared live while any item is missing or while a merchant would
share a custodial provider account. See [TENANCY](TENANCY.md) for the design and
PAY-T37/PAY-T38 for the implementation gates.

## 4. Rollout and rollback

- Releases are tagged for self-hosted installs and staged for the hosted
  service: development → sandbox → production canary → all merchants.
- Migrations use expand/contract. A release adds a compatible column or table,
  backfills, then removes the old path in a later release. Destructive migration
  never ships with the code that depends on it.
- Rollback of application code is allowed for one minor version while the schema
  remains compatible.
- Financial corrections use ledger reversals and new records, never direct row
  edits or deleted history.
- A provider or contract change is gated by a feature flag and a rollback plan.
- Pausing payment creation is preferable to accepting payments that cannot be
  verified or reconciled.

## 5. Monitoring

| Signal | Candidate trigger | Response |
| --- | --- | --- |
| Ledger imbalance | Any nonzero difference | SEV1, stop settlement |
| Duplicate settlement | Any second proof for one invoice | SEV1, quarantine |
| Provider callback failures | Error rate or latency over a short window | SEV2, poll provider status |
| Provider connection health | Connection `DEGRADED`, verification expiry or repeated auth failure | SEV2, route new intents only, poll existing ones |
| Cross-tenant denial or unknown callback token | Any repeated attempt | SEV1, security review and tenant-scope audit |
| Stuck intents | Pending beyond expected expiry | SEV2, run expiry/reconcile job |
| Webhook failures | Rising failures or dead deliveries | SEV2, notify merchant |
| Reconciliation delta | Any unmatched provider payment | SEV2, manual review |
| API error rate / latency | Budget breach | SEV2/3, scale or degrade |
| Key or secret anomaly | Use outside scope or region | SEV1, revoke and rotate |
| Tenant-scope denial spike | Repeated cross-tenant attempts | SEV1, security review |

Thresholds are set during implementation from measured baselines; no current
baseline exists. Alerts route to an on-call owner named before launch (PAY-D14).

## 6. Incident response

- **SEV1** — ledger imbalance, double settlement, cross-tenant exposure, key
  compromise. Freeze affected flows, preserve evidence, notify owners, involve
  counsel and affected merchants as required.
- **SEV2** — provider outage, webhook backlog, reconciliation mismatch, expired
  invoice backlog. Keep payments pending, communicate status, reconcile before
  resuming settlement.
- **SEV3** — dashboard degradation, single-endpoint failure, non-critical delay.

Every incident records timeline, affected tenants, money impact, containment,
root cause, corrective actions and whether a manual ledger correction was
posted. Incident write-ups do not include customer personal data or secrets.

## 7. Runbooks

1. **Provider outage** — stop new intents or route to a healthy connection, keep
   existing intents pending, poll, reconcile, communicate.
2. **Stuck pending intents** — verify provider state, expire unpaid invoices,
   quarantine unknown results, never bulk-fail.
3. **Duplicate settlement** — freeze the intent, compare proofs, reverse the
   extra ledger entry, notify BNOS, root-cause the dedup gap.
4. **Ledger mismatch** — stop settlement, export affected entries, find the
   unbalanced write, correct by reversal, audit the fix.
5. **Webhook storm or dead endpoint** — apply backoff, disable a failing
   endpoint, notify the merchant, replay after repair.
6. **Key or connection compromise** — revoke the key, disable the affected
   provider connection and callback token, rotate connection credentials and
   webhook secrets, review usage, reconcile the provider account and assess
   disclosure. A deployment-wide secret still requires rotating every affected
   connection.
7. **Late payment after expiry** — quarantine, do not reactivate the old intent,
   choose refund or a new intent with the merchant.
8. **Restore drill** — restore into isolation, verify totals, record duration
   and gaps.
9. **Tenant isolation incident** — freeze the affected APIs and workers, preserve
   audit and query logs, identify every cross-tenant read/write, notify the
   affected merchants and security owner, correct by new records rather than row
   edits, and add a regression test before resuming.

## 8. Access and support

- Production access is least privilege, MFA-protected and audited. Break-glass
  access is time-bound and reviewed afterwards.
- Support staff see redacted payment data until a case requires more, and every
  elevation is logged.
- Merchant-facing status is communicated in Lao and English. A status page is
  planned; no uptime number is claimed.
- Logs, provider payloads and webhook bodies follow the retention decision
  (PAY-D13); financial records are preserved as required by counsel.

See [SECURITY](SECURITY.md) for fail-closed rules and [TESTING](TESTING.md) for
the evidence required before a pilot.
