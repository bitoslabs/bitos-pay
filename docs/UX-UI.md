# BitOS Pay — UX and UI

Status: **Spec + reference UI.** The demo dashboard and checkout are static
synthetic pages under [`../ui`](../ui); the separate merchant console calls the
local API with a sandbox-key session. The demo pages do not hold a key or prove
a payment. Lao and English are first-class; Thai is an expansion. All money
labels use explicit currency and preserve fractional `msat` values internally.

## 1. Primary journeys

| ID | Journey | Actor | Success |
| --- | --- | --- | --- |
| J1 | Register a merchant and connect a payment method | Merchant owner | Merchant active or pending verification |
| J2 | Create a payment request at the counter | Cashier | QR and invoice shown |
| J3 | Pay a BNOS checkout | Customer | Provider-confirmed success, BNOS order paid |
| J4 | Integrate the API in a sandbox | Developer | First sandbox payment and webhook received |
| J5 | Review and refund a payment | Merchant manager | Reversal recorded, audit visible |
| J6 | Investigate an unmatched payment | Finance staff | Reconciled or quarantined with a note |

## 2. Merchant dashboard

| Screen | Contents | Important states |
| --- | --- | --- |
| Onboarding | Organization profile, business verification, provider connection | Pending, rejected, needs document, active |
| Overview | Today's payments, pending intents, failed deliveries, reconciliation warning | Empty, partial, stale provider, error |
| Create request | Amount, currency, reference, memo, expiry, branch | Invalid amount, stale quote, provider down |
| QR / invoice | QR, copy invoice, amount, countdown, status | Awaiting, detected, verifying, paid, expired |
| Payment history | Cursor list with status, amount, reference, time | Empty, filtered-empty, loading, error |
| Transaction detail | Attempts, provider reference, fee, net, ledger lines, webhook deliveries | Settled, quarantined, reversed |
| Settlement | Period totals, fees, net, reconciliation state | Pending, completed, failed, mismatch |

A merchant never sees a "wallet balance" unless a provider balance was explicitly
read and is labeled with its source and observation time.

## 3. Checkout page

1. Invoice amount, merchant name, reference (if allowed) and currency.
2. QR code plus a copyable Lightning invoice and, when available, a LNURL or
   Lightning address fallback.
3. Countdown to expiry, announced accessibly but not on every tick.
4. Status: `Awaiting payment` → `Checking payment` → `Paid` or `Expired`.
5. Success screen shows amount, merchant, reference and a receipt action.
6. Expired screen offers a new invoice only if the merchant allows it; it never
   silently reuses the old invoice.

The page never shows "Paid" from a client-side assumption. Until the provider
confirms, it says "Checking payment — do not close this page" and keeps a manual
refresh. A customer who closes the page can reopen the status link.

### Reference checkout behavior

The demo page demonstrates `Awaiting payment` → `Paid` or `Expired` with a
visible sandbox control. The control is clearly labeled as a simulation; it is
not a production path. The paid state hides the QR panel and shows a receipt with
amount, merchant, reference, payment id and local time. The expired state offers a
new synthetic invoice. The hosted page at `/checkout/:token` replaces the
simulation with unauthenticated, signed-token status polling against
`/v1/checkout/:token`; provider confirmation remains final.

## 3.1 Reference UI

Files:

```text
ui/
  index.html                 static synthetic merchant demo
  checkout.html              static customer checkout and receipt
  console.html               same-origin merchant console (sandbox/live mode, login, keys, monitoring)
  console.css                console login, key and session styles
  styles/                    tokens, base, components, dashboard, checkout, responsive, print
  scripts/
    payment-link.html        reusable fixed-amount public link page
    theme-init.js            early theme/language application for hosted pages
    storage.js               safe local/session storage helpers
    i18n.js                  English/Lao messages and DOM translation
    ui.js                    formatting, copy, toast, theme, navigation
    qr.js                    generated real QR renderer
    demo-data.js             synthetic merchant/payment fixtures
    dashboard.js             demo dashboard controller
    checkout.js              demo checkout controller
    console.js               live API/session console controller
```

Run it without a build step from the repository root:

```sh
python3 -m http.server 8899 --bind 127.0.0.1 --directory bitos-pay/ui
```

Open `http://127.0.0.1:8899/`. The UI uses the ecosystem mockup palette and
supports theme and English/Lao toggles. The static dashboard header, primary
actions and footer link to the functional console at `console.html`; the console
brand returns to Overview without leaving the single-page app. In-page dashboard
navigation reflects the visible section, and anchors clear the sticky header.
Static assets and script syntax are checked with `node bitos-pay/ui/check.mjs`.
Screenshots and interaction checks are local UI evidence only; they are not
payment evidence.

## 4. Developer console

The reference `/console/` page now uses a signer-first entry. One signed
five-minute kind `22242` challenge signs in an existing key or creates a sandbox
workspace, merchant, API key and linked signer identity. NIP-07, NIP-46
(`bunker://` or QR) and opt-in local `nsec` are supported; an API key remains a
secondary fallback. Create mode can also generate a fresh nsec entirely in the
browser: the console shows the npub, masks the nsec until revealed, offers copy
and download backup, requires a saved-key confirmation, then signs the challenge
locally. The nsec is never sent to the server and is cleared after the session
opens. The one-time welcome panel shows both the sandbox API key and the npub so
the operator can verify which signer owns the workspace.

After sign-in the console uses a full-page workspace, not a centered cover
card: a floating, borderless icon rail with theme control, a sticky top bar with
the brand pill, centered navigation, search/help and the workspace account.
Content is split into four hash-addressable pages: **Overview**, **Payments**,
**Developers** and **Settings**. Overview keeps the dated greeting, balance and
settlement stack, four metrics, seven-day pulse and five recent activities.
Payments owns create-request, reusable payment links, the full searchable table and
payment detail, including sandbox refunds and refund history.
Developers owns API keys, webhook health, one-time secret rotation, a quickstart and a searchable API reference generated from `/openapi.json`. Settings owns plan,
editable merchant profile, read-only verification state, workspace identifiers, provider routing, signer and session, plus a filterable security and activity log. Audit rows show a localized action label, the raw action id, target, actor, result and local time; unsupported actions fall back to the raw id. Settings uses a sticky grouped section menu (a horizontal chip row below 930px) for Plan, Business profile, Locations, Workspace details, Team, Payment routing, Session, Nostr sign-in and Activity log. Choosing a section shows only that card, so every widget remains reachable without a long two-column scroll; the active section is exposed with `aria-current` and announced through a polite status region. Each settings card keeps its own save or confirmation action instead of batching unrelated domains behind one global save. The
routing card names the selected adapter and its mode/status without exposing a
credential; it is read-only in the reference. The layout is inspired by a
modern finance workspace but keeps the existing BitOS dark palette,
yellow/orange accent and monospace operational detail. It shows real sandbox API data, balances and
settlement summaries, scoped keys, webhook rotation and the current entitlement. It does
not provide documentation search, staff roles, MFA, live payments or a
production login. The table below is the target product surface.

### Form conventions

- Labels use sentence case at 12px, not all-caps monospace. Technical values keep
  the monospace face; labels are for scanning.
- Optional fields carry a visible **Optional** badge instead of relying on a
  missing asterisk. Required controls use the native `required` attribute.
- A form uses two columns on desktop and one column below 720px. Related fields
  share a row (amount + location, reference + memo); no half-empty rows.
- Money inputs show the unit once, as a suffixed `SAT`, while the label stays
  short. Placeholders are examples, not hidden defaults; live forms start empty
  so a stale amount or reference cannot be submitted by accident.
- Validation is inline, sets `aria-invalid`, focuses the first invalid control
  and keeps the API error in the live status region. Format hints stay visible
  after a correction.
- Scope and event checkboxes use selectable cards with a selected count and
  **Recommended / All / Clear** presets. New keys start from least privilege;
  administrative scopes are opt-in.
- Primary actions sit at the end of the form on desktop and become full-width on
  small screens. Destructive or cancel actions remain visually secondary.

| Area | Contents | States |
| --- | --- | --- |
| API keys | Create, scope, show once, atomic rotate-and-revoke, last used | Active, rotated, revoked, insufficient scope |
| Webhooks | Endpoint URL, event filter, delivery log, replay, rotate secret, disable | Healthy, rotating, failing, dead, disabled |
| Refunds | Partial/full refund from a settled payment detail, reason, remaining balance, history | Refundable, partially refunded, fully refunded, over-refund rejected |
| Payment links | Fixed amount, label/reference, copy/open URL, disable, public link page | Active, disabled, invalid, rate-limited |
| Business profile | Merchant name, support email, website, save, read-only verification status | Saved, validation error, read-only without scope |
| Reconciliation | Period picker, run action, stored snapshots with period/net/transaction count/ledger status | Stored, invalid range, read-only without `payments:write` |
| API reference | OpenAPI-derived endpoint catalog grouped by area, method/path/summary search, copy JSON URL | Loaded, empty search, OpenAPI fetch failure |
| Team | Invite by Nostr pubkey, role preset, optional label; member list with role/status and revoke | Invited, invalid pubkey, revoked history, read-only without `keys:write` |
| Locations | Name/code creation, active/disabled list, disable action; payment form location selector | Created, duplicate code, disabled, read-only without `merchants:write` |
| Webhook events | Edit active endpoint events with the URL locked, save or cancel | Saved, unsupported event, inactive endpoint, read-only without `webhooks:write` |
| CSV exports | Payment and reconciliation download links, visible on their owning cards | Downloaded, empty range, session/scope failure |
| Cancel payment | Unpaid detail shows Cancel payment with an irreversible-action confirmation | Cancelled, already terminal, provider refusal, read-only without `payments:write` |
| Payment paging | Payments load 20 at a time; status tabs query the server and Load more appends the next cursor | More available, all loaded, empty status, stale tab response, search within loaded rows |
| Location management | Rename a branch or re-enable a disabled branch from its list row | Renamed, re-enabled, invalid name, read-only without `merchants:write` |
| Documentation | API reference, webhook events, error groups, integration guide | Versioned |
| Sandbox | Test keys, fake provider outcomes, test invoices | Sandbox-only banner |
| Integration guide | BNOS, Nuxt and Node quickstarts with synthetic keys | Copyable |

Sandbox and live environments are visually distinct and never share keys or
provider connections. A sandbox badge remains visible on every sandbox screen.

## 5. Empty, error and offline states

| State | Message intent | Recovery |
| --- | --- | --- |
| Empty history | Explain that no payment exists yet | Create request |
| Invalid amount | State the accepted integer format and scale | Correct amount |
| Quote missing/expired | Quote cannot price this request | Refresh quote |
| Provider unavailable | Payment cannot be started or verified now | Retry, keep intent pending |
| Unknown provider state | Do not claim failure or success | Reconciliation notice |
| Webhook failing | Show last response code and attempt count | Fix endpoint or replay |
| Offline (merchant UI) | Cached history is read-only; creating a payment is disabled | Reconnect |
| Offline (checkout) | Show saved invoice and copy action; status may be stale | Reopen status link |

## 6. Accessibility

- WCAG 2.2 AA target; all flows keyboard operable with visible focus.
- Status changes use a polite live region; the countdown is not announced every
  second. Color is never the only status signal.
- QR has a text alternative, a copyable invoice and a wallet deep link. A QR-only
  flow fails accessibility and offline review.
- Minimum 44×44 px touch targets, 4.5:1 text contrast and reduced-motion support.
- Session or countdown expiry warns before it ends; a paid state remains readable
  without time pressure.
- Lao and English labels, fonts with Lao glyph coverage, and a persistent language
  switch. Layout tolerates longer Lao and English strings.
- Amounts use grouped digits, the ISO currency code and the configured scale;
  the stored integer is never rounded for display. Times show the local zone with
  UTC available on detail views.

## 7. Bilingual label examples

| English | Lao |
| --- | --- |
| Create payment request | ສ້າງຄຳຂໍຊຳລະເງິນ |
| Show QR | ສະແດງ QR |
| Waiting for payment | ລໍຖ້າການຊຳລະ |
| Checking payment | ກຳລັງກວດສອບການຊຳລະ |
| Payment successful | ຊຳລະສຳເລັດ |
| Expired | ໝົດອາຍຸ |
| Cancelled | ຍົກເລີກ |
| Try again | ລອງໃໝ່ |
| Payment history | ປະຫວັດການຊຳລະ |

Product text is reviewed by a Lao speaker before a pilot. Machine translation is
not accepted as final UI copy.

## 8. Trust and safety in the interface

- Show the merchant name and amount before payment; never hide fees in checkout.
- Do not auto-redirect on an unverified signal or use urgency copy that implies a
  payment succeeded.
- Display provider and sandbox/live context on transaction detail.
- Warn that Lightning payments are final and that refunds follow merchant policy.
- A quarantine notice explains that a human is checking the payment; it does not
  promise a refund.

## 9. Nostr-native console direction (2026-11-14)

The redesign direction is **quiet, expert and Nostr-native**, not a generic
crypto dashboard.

| Principle | Implementation |
| --- | --- |
| One identity, no passwords | The first screen says "One key. No passwords." and leads with Nostr methods; email/password are absent |
| Two clear intents | **Sign in** and **Create account** are explicit modes; new or generated keys create a sandbox workspace, merchant and API key in one signature |
| Recoverable key creation | Create mode generates nsec/npub locally, reveals the nsec only on request, offers copy/download, blocks creation until the backup is acknowledged, and clears the secret after sign-in |
| Honest signed-out chrome | The login page hides the workspace account block, keeps sandbox/trust chips visible and shows session-expiry errors above the methods instead of inside a collapsed disclosure |
| No dead ends | A key that already exists signs in instead of creating a duplicate and says so; API-key login stays available under a disclosure |
| Show the trust boundary | Sandbox is visible in the header, ticker, auth card and session card; live keys are rejected |
| Progressive disclosure | Workspace names and API-key login are collapsed; signer panels open only when chosen |
| Expert density | Monospace keys, exact merchant/organization ids, signer identity and expiry are visible; no fake balances or ambiguous "live" labels |
| Calm visual language | Large typographic statement, one warm accent, restrained glow, no gradients that imply a live payment state |
| Page model | Hash routes `#/overview`, `#/payments`, `#/developers` and `#/settings`; back/forward and refresh preserve the page; create opens Payments and focuses the amount |
| Workspace dashboard | Full-page borderless icon rail, brand pill, centered top navigation, greeting/date, left balance/settlement stack and right metrics/pulse/recent area echo a modern finance workspace without inventing live balances |
| BitOS theme | The console keeps the existing dark surface, yellow/orange accent and dedicated light theme; the reference layout does not import a second brand palette |
| Mobile first | The brand statement and auth card stack; the dashboard becomes one column with a horizontally scrollable nav; tables scroll inside their card; 390px and 1440px avoid page overflow |

Flow and acceptance:

1. Open the console and understand in one screen that Nostr is the login.
2. Either sign in or create an account without email, password or card.
3. New account lands in the console with a one-time `bp_test_` key, its npub and copy actions.
4. A generated nsec can be revealed, copied or downloaded, but account creation stays disabled until the operator confirms the backup.
5. After sign-out, the same generated nsec signs back into the same merchant.
6. Existing key signs in; create mode explains that it used the existing account.
7. The session card shows `Nostr · <short key>` or `API key`, expiry and scopes.
8. Keyboard order, focus states, live-region errors and Lao/English layout hold at
   390px and 1440px widths.
9. The dashboard renders 10 synthetic payments, a seven-bar pulse, a searchable
   activity table and a functional drawer; theme and language toggles do not break
   the shell.
10. The web console uses the full viewport rather than an inset cover card, with
    the floating icon rail and top bar spanning edge to edge; no horizontal page
    overflow at 390px or 1440px.
9. Overview, Payments, Developers and Settings are separate views with correct
   active navigation. Payments carries create-request and the full table;
   Developers carries keys, webhooks with secret rotation and a three-step quickstart; Settings
   carries plan, workspace identifiers and signer/session.

Future, not implemented: a workspace switcher for one signer with several
workspaces, npub display in bech32 form, device/session management, and a
guided BNOS connection inside the console.

See [PRODUCT](PRODUCT.md) for scope and [API](API.md) for the events these
screens display.
