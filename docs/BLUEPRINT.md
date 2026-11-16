# BitOS Pay — blueprint

Status: **Spec + synthetic reference core and UI.** Product direction derived from the payment
section of [`chat.md`](../../chat.md). The reference service implements a sandbox
slice; pricing and market statements remain hypotheses, not validation.

## 1. Recommendation

Build BitOS Pay next, before expanding BNOS into new application categories.
BNOS already owns orders, stock and receipts; a payment layer turns those
operations into revenue and gives every later BitOS product a shared way to
receive and send value.

The recommendation is infrastructure, not a wallet app:

> One payment layer. Many applications. One open economy.

The strategic reason is reuse. Every application otherwise rebuilds invoice
creation, payment verification, reconciliation, refunds and webhooks. BitOS Pay
owns that once, exposes it through an open API, and keeps the door open for
rails other than Lightning.

## 2. Why Lightning first

- Instant, low-value settlement fits merchant checkout and QR payment.
- Open standards exist for invoices (BOLT11), wallet connectivity (NIP-47,
  LNURL) and public identity (Nostr).
- The first customer, BNOS, can integrate without a card-acquirer contract.
- A provider adapter boundary means Lightning is a first adapter, not a
  permanent architectural commitment.

Custody is deliberately narrow. The first two models are non-custodial customer
wallets and merchant-controlled nodes or providers. Hosted custody is a later,
licensed decision (see [SECURITY](SECURITY.md) and PAY-D01).

## 3. Users

| User | Job to be done | First value |
| --- | --- | --- |
| Merchant | Request and reconcile payment without building a gateway | Dashboard, QR, invoice, history |
| Customer | Pay a known amount from any Lightning wallet | Checkout with QR and status |
| Developer | Add payments to an app with predictable contracts | API, webhook, SDK, sandbox |
| Platform (BNOS, marketplace) | Collect payment for orders and settle merchants | Order-linked intent and signed outcome |
| AI agent (future) | Pay within an owner-set budget and policy | Scoped payment capability, never a key |

## 4. Four surfaces

| Surface | Responsibility | Explicitly not |
| --- | --- | --- |
| **Pay Core** | Payment engine, invoice manager, ledger, settlement, fees, risk and limits | A general ledger for the whole business |
| **Pay Merchant** | Merchant onboarding, payment requests, QR, history, reconciliation views | A full ERP, POS or accounting suite |
| **Pay API** | REST, webhooks, payment links, QR, SDKs, sandbox | A general public payment endpoint with arbitrary amount or merchant |
| **Pay Connect** | Nostr identity linking, NIP-47 wallet connectivity, private receipts | A public transaction feed or a new Nostr protocol |

## 5. Design principles

1. **Provider independent** — the core never calls a provider-specific API
   outside an adapter.
2. **Verified, not asserted** — payment success comes from the provider's
   confirmed state, never from a browser callback.
3. **Ledger before notification** — a webhook is sent only after the ledger entry
   is durable.
4. **Money is integer** — msat/sat or fiat minor units, explicit currency and
   scale, snapshot quote and fee. No floating point.
5. **Open API** — a developer can integrate without a private agreement.
6. **Modular** — new rails and providers are adapters, not rewrites.
7. **Auditable** — every state change, key action and settlement is traceable.
8. **Private by default** — transaction detail never goes to a public relay.
9. **Non-custodial first** — do not imply a stored balance that does not exist.

## 6. Business model hypothesis

Four channels, tested separately:

| Channel | Description | Illustrative hypothesis |
| --- | --- | --- |
| Transaction fee | A fee per successful payment, snapshotted on the transaction | Small percentage; market test |
| Merchant SaaS | Monthly subscription for dashboard, branches, reports | $9 / $29 tiers, illustrative |
| Developer API | Usage-based pricing above a free quota | Price per API call, illustrative |
| Enterprise / self-host | Self-hosted core, dedicated deployment, support and SLA | Custom contract |

The amounts are a market test, not proven willingness to pay. Self-hosted core
is open source; the hosted service and support are the primary revenue path. A
paid plan never grants merchant verification, ownership or payment authority.
BNOS is the first-party customer and reference integration; it is not a proof of
external demand.

## 7. First release scope

| Dimension | Choice |
| --- | --- |
| Product | Lightning payment gateway |
| First customer | BNOS |
| First market | Laos / Southeast Asia |
| First rail | Bitcoin Lightning |
| First integration | BNOS checkout |
| First identity | Nostr identity linked to a merchant organization |
| Business model | Open-source core plus hosted SaaS |

## 8. Non-goals

- No customer deposit balance, stored-value wallet or interest in the MVP.
- No LAK↔SATS exchange, remittance or merchant advance before legal review.
- No autonomous agent spending in the MVP.
- No new Nostr kind, payment protocol or invoice format.
- No card acquiring, bank payout rails or multi-currency settlement in v0.1.
- No claim that Lightning removes financial regulation.

## 9. Evolution

Payment Gateway → Open Wallet Connectivity (NWC/Cashu) → Local Economy
(LocoSats) → Open Commerce → Agent Economy. Each phase has a gate in
[ROADMAP](ROADMAP.md); none is authorized by this blueprint.

Features and the MVP cut are in [PRODUCT](PRODUCT.md). The open decisions are in
[DECISIONS](DECISIONS.md).
