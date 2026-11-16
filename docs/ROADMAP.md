# BitOS Pay — roadmap

Status: **Spec**. The 12-week plan is an estimate for one developer using AI
assistance, not a commitment or a claim of progress.

## 1. Phase 0 — decisions before building

| Decision | Needed before | Owner |
| --- | --- | --- |
| PAY-D01 custody model | Any hosted money handling | Product + counsel |
| PAY-D02 Lightning provider or node | Block 1 adapter work | Architecture |
| PAY-D03 first pricing currency and LAK quote source | Fiat intent work | Product |
| PAY-D05 backend runtime | Repository setup | Architecture |
| PAY-D06 BNOS order/webhook contract | Block 5 | BNOS + Pay leads |
| PAY-D07 settlement-proof profile for Lightning | Reconciliation design | Contracts + Pay |
| PAY-D08 merchant verification level | Merchant onboarding | Risk + product |
| PAY-D10 webhook secret rotation | Developer platform | API lead |
| PAY-D24 shared live tenancy | A second live merchant in one deployment | Architecture + Security + Risk |

Phase 0 does not block writing specs, schemas or synthetic fixtures. It blocks
live money, hosted custody and any BNOS production dependency.

## 2. Twelve-week estimate

| Block | Weeks | Work | Exit gate |
| --- | --- | --- | --- |
| B1 Foundation | 1–2 | Repository shape, database schema, auth and RBAC, state machine, adapter interface, API specification | ERD, state machine and adapter contract reviewed; synthetic fixtures defined |
| B2 Payment Core | 3–4 | Payment intent, invoice creation, Lightning provider integration, verification, event processing, idempotency | Sandbox payment settles once; duplicate callback has no second effect |
| B3 Merchant | 5–6 | Registration, payment request, QR, checkout, history, detail, ledger and fee view | Merchant creates a request and sees a correct transaction |
| B4 Developer platform | 7–8 | REST API, key management, webhooks, SDK, sandbox, documentation | An independent test integration receives a signed webhook |
| B5 BNOS integration | 9–10 | BNOS checkout, order payment, confirmation, refund/reversal, reconciliation | BNOS order is paid once; reconciliation report matches |
| B6 Test and launch readiness | 11–12 | Integration tests, security review, load test, provider-failure test, monitoring, pilot preparation | Gates G1–G10 have dated evidence; pilot scope approved |

"Launch" here means readiness review. A limited merchant pilot needs separate
human approval and must not be reported as completed by this plan.

## 3. v0.1 definition of done

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

## 4. Evolution phases

| Phase | Scope | Exit gate |
| --- | --- | --- |
| 1. Payment Gateway | Lightning merchant payment for BNOS and direct merchants | v0.1 definition of done; legal model for non-custodial operation |
| 1.5 Shared Live Tenancy | One deployment serves multiple live merchants with connection-scoped credentials, callbacks, KYB and reconciliation | [TENANCY](TENANCY.md) gates G1–G9 with dated evidence; dedicated per-merchant deployment remains the fallback |
| 2. Open Wallet Connectivity | NIP-47 NWC and Cashu adapter | Wallet threat review; Cashu mint-risk disclosure and limits; no custody implied |
| 3. Local Economy (LocoSats) | LAK/THB/USD ↔ SATS quotes, merchant settlement | Bank of the Lao PDR and counsel review; exchange accounting; reserve model if custody exists |
| 4. Open Commerce | Marketplace, subscription, loyalty, POS and cross-platform checkout | Commerce contract adoption; escrow and refund policy; no second order schema |
| 5. Agent Economy | Agents pay within budget, spending policy, limits and approval | Agent grant and approval integration; real-money policy review; agent never holds a key |

Organization plans (PAY-F31) are a P2 SaaS slice that can ship independently of
Commerce. They gate plan features only and never activate a live merchant or
change organization ownership.

Each phase is independent. A later phase does not retroactively authorize an
earlier skipped gate.

## 5. Dependencies

| Dependency | Needed for | Status |
| --- | --- | --- |
| Lightning provider or node sandbox | Blocks 1–2 | LNbits adapter reference; production provider choice, KYB and payouts open |
| BNOS order and webhook owner availability | Block 5 | Open |
| BitOS ID verification interface | Merchant onboarding beyond synthetic data | Open |
| Shared contract owner on amount/proof | Reconciliation and wire composition | Open (PAY-D07) |
| Lao legal opinion | Any hosted custody or exchange | Blocked |
| Independent security reviewer | Gate G10 | Open |
| Secret manager/KMS and per-merchant provider test accounts | Shared live tenancy (PAY-D24) | Open |
| Lao/English copy reviewer | Pilot UI | Open |

## 6. Revenue experiments

These test demand; they are not forecasts.

1. Interview 5–10 Laos merchants about current collection pain and willingness to
   pay for a dashboard or API.
2. Test the illustrated $9 and $29 monthly tiers against a free self-hosted core.
3. Compare hosted versus self-hosted interest with BNOS-adjacent merchants.
4. Measure whether transaction-fee-only pricing is acceptable or whether a
   subscription is required for predictable revenue.
5. Test developer adoption through the sandbox and integration guide.

No percentage, conversion or revenue figure in this pack is validated.

## 7. Schedule risks

- Provider onboarding and KYB can take longer than the development blocks.
- Legal review can invalidate a custody or exchange assumption late.
- BNOS changes can move the Block 5 contract.
- One developer plus AI is fragile to illness, context loss and scope creep.
- Refunds, staff roles and linked NIP-07 login are easy to pull forward; they are P1 and
  should be cut first if a gate slips.

Mitigation: keep the P0 list fixed, record decisions before building, and treat
each block exit gate as a stop-or-continue review rather than a calendar promise.

See [DECISIONS](DECISIONS.md) for owners and [TESTING](TESTING.md) for gate
evidence.
