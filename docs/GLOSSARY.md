# BitOS Pay — glossary

Status: **Spec**. Terms used across this pack. A term has one meaning here even if
another product uses it differently.

| Term | Definition |
| --- | --- |
| **Payment intent** | The merchant's request to collect a stated amount under a stated currency and reference. It owns the six-state lifecycle and one or more attempts. |
| **Payment attempt** | One interaction with one provider connection for an intent. A retry is a new attempt; a terminal intent is never edited to retry. |
| **Invoice** | A Lightning payment request (BOLT11) bound to an attempt, with a payment hash, amount and expiry. |
| **BOLT11** | The Lightning invoice encoding. It is a payment request, not proof of payment. |
| **Payment hash** | The hash committed in a Lightning invoice. A valid preimage must hash to it. |
| **Preimage** | The secret that proves payment of a Lightning invoice. Pay stores it only in restricted, encrypted evidence, never in logs. |
| **msat / sat** | Integer Lightning units. 1 sat = 1,000 msat. Internal rail amounts use msat. |
| **Minor units** | The smallest integer unit of a fiat currency (for example cents). Always paired with a currency and scale. |
| **Scale** | The number of decimal places a currency's minor unit represents. It is explicit, never inferred at read time. |
| **Quote snapshot** | A stored exchange rate with source and timestamps, used to price one intent. An expired quote cannot price a new intent. |
| **Fee snapshot** | The stored fee rule and computed fee for a transaction, so history never depends on current pricing. |
| **Double-entry ledger** | An accounting model where every movement has equal debits and credits. Pay uses it for payment, fee and settlement records. |
| **Ledger account** | A named account in the organization's chart (for example provider clearing, merchant payable, platform fee). |
| **Ledger entry** | One debit or credit line linked to a transaction. Posted entries are immutable. |
| **Reversal** | A new entry that cancels an earlier one. It is not a deletion or an edit. |
| **Settlement** | The reconciliation and payout record that confirms what the merchant is owed for a period. It is not the same as a paid invoice. |
| **Reconciliation** | Comparing local transactions and ledger entries with provider history; unmatched items are investigated. |
| **Provider adapter** | The boundary that turns a provider's API and callbacks into Pay's normalized invoice and settlement events. |
| **Provider connection** | A merchant or platform binding to a specific provider, node or wallet, with its own credentials and status. |
| **Connection token** | An opaque, high-entropy routing token in a provider callback URL. It identifies one connection, not a merchant authority. |
| **Dedicated single-tenant deployment** | One live merchant per deployment with its own database, domain, secrets and provider account, even when the internal schema is multi-tenant. |
| **Shared live deployment** | One deployment serving several live merchants. It requires connection-scoped credentials, callbacks, tenant enforcement, live activation and reconciliation; it is not the current reference. |
| **Live activation** | A reviewed decision that permits live keys and invoices for one merchant. It is not granted by a plan, Nostr proof or UI toggle. |
| **Merchant** | The business that collects payment. It belongs to an organization and has a verification status. |
| **Organization / tenant** | The isolation boundary for merchants, users, keys, transactions and ledger accounts. |
| **Workspace** | A private collaboration tenant owned by BitOS Workspace. A workspace is not automatically a verified merchant or a payment authority. |
| **Plan** | A sellable package of organization features and limits. A plan is not a role or a permission. |
| **Subscription** | The organization's paid plan period and payment state, owned by BitOS Pay. |
| **Entitlement** | A versioned, read-only statement of the features and limits an organization may use. It is not authority, membership or a balance. |
| **Billing contact / payer** | The subject allowed to buy or manage a plan. It may differ from the organization owner and never becomes owner by paying. |
| **External reference** | The caller's identifier, usually a BNOS order id. It is not a payment id and is not trusted as proof. |
| **Idempotency key** | A caller-supplied key that makes a retried unsafe request return the original result instead of repeating the effect. |
| **Webhook** | A signed HTTP event delivered to a merchant endpoint. Delivery is at-least-once. |
| **Delivery** | One webhook attempt with its own delivery id, response code and status. |
| **Quarantine** | A hold for an unknown, late or conflicting provider result. It is neither success nor failure and requires review. |
| **Fail closed** | Deny the privileged action when authority, freshness or required state cannot be verified. |
| **Non-custodial** | The customer pays from their own wallet; Pay never holds the funds. |
| **Merchant-controlled** | The merchant connects their own node, provider or wallet; Pay orchestrates and reconciles only. |
| **Hosted custodial** | BitOS holds or controls funds for a merchant or customer. Blocked pending licensing and review. |
| **NWC / NIP-47** | Nostr Wallet Connect: an encrypted request channel to a wallet. It is connectivity, not payment proof. |
| **NIP-57 zap** | A Lightning zap tied to a Nostr note or profile. It is not a general merchant checkout. |
| **LNURL** | A Lightning payment-request or Lightning-address convention usable as a checkout fallback. |
| **Cashu mint** | An ecash issuer. Cashu is bearer ecash, so mint solvency and redemption risk must be disclosed. |
| **Nostr** | Identity and transport layer using signed events and relays. It is not a ledger, bank or payment authority. |
| **Registry owner** | The BNOS owner of deployed Nostr kind values. No kind is invented or reserved in this pack. |
| **Public projection** | An explicit, allowlisted, rebuildable public view. The MVP allowlist for payment data is empty. |
| **LocoSats** | The later LAK/THB/USD ↔ SATS local-economy phase. It is blocked on legal and exchange review. |
| **Spending policy** | An owner-set limit, recipient allowlist and approval rule for an agent payment. It is not a private key. |
| **Status labels** | `Spec`, `Planned`, `Open`, `Blocked`. No status implies code, tests, CI, deployment or a pilot. |

See [DATA-MODEL](DATA-MODEL.md) for invariants and [API](API.md) for how these
terms appear in operations and events.
