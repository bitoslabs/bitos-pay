# @bitos/pay-js

Typed server-side client and webhook verifier for the BitOS Pay reference API.
Zero runtime dependencies; Node.js 24+.

Status: **Reference SDK, sandbox only.** It does not select a production provider,
hold custody or make Bitcoin move. Keep API keys on the server; never ship a
`bp_live_…` or `bp_test_…` secret to a browser.

## Install and use

The package lives in this workspace and is not published. From the repository
root:

```sh
pnpm --filter @bitos/pay-js test
pnpm --filter @bitos/pay-js typecheck
```

```ts
import { BitOSPay } from "@bitos/pay-js";

const pay = new BitOSPay({ apiKey: process.env.BITOS_PAY_SECRET_KEY! });

const intent = await pay.paymentIntents.create({
  amount: 100000,
  currency: "SAT",
  scale: 0,
  payment_method: "lightning",
  external_reference: "BNOS-ORDER-001"
});

console.log(intent.payment.invoice);
console.log(intent.checkout_url); // customer-facing hosted checkout

const link = await pay.paymentLinks.create({
  amount: 25000,
  currency: "SAT",
  scale: 0,
  label: "Coffee"
});
console.log(link.url); // reusable public payment link
```

The client defaults to `https://api.pay.bitos.space`. For the local reference:

```ts
const pay = new BitOSPay({
  apiKey: "bp_test_...",
  baseUrl: "http://127.0.0.1:8788"
});
```

## Idempotency

Create methods generate an idempotency key when none is supplied and retry it
with the same request. Pass an explicit key when the caller owns the retry
boundary:

```ts
await pay.paymentIntents.create(input, { idempotencyKey: "order-001-attempt-1" });
```

Reusing a key with a different body returns `BitOSPayError` with
`code: "PAY_IDEMPOTENCY_CONFLICT"`.

## Resources

| Resource | Methods |
| --- | --- |
| `paymentIntents` | `create`, `retrieve`, `cancel`, `list` |
| `invoices` | `create`, `retrieve` |
| `payments` | `list` |
| `transactions` | `list` |
| `balances` | `retrieve` |
| `merchants` | `me`, `update` |
| `locations` | `list`, `create`, `update`, `disable` |
| `refunds` | `create`, `retrieve`, `list` |
| `settlements` | `list`, `summary`, `reconcile`, `retrieve` |
| `paymentLinks` | `create`, `list`, `disable` |
| `webhookEndpoints` | `create`, `list`, `update`, `rotate`, `disable` |
| `webhookDeliveries` | `list`, `replay` |
| `apiKeys` | `list`, `create` (`expiresInDays`), `rotate`, `revoke` |
| `quotes` | `create`, `retrieve` |
| `request` | Escape hatch for an endpoint the typed surface does not yet cover |

Errors are `BitOSPayError` with `status`, `code`, `type`, `requestId` and the
server message.

## Webhooks

Verify the exact raw request body before parsing or trusting it:

```ts
import { constructWebhookEvent } from "@bitos/pay-js";

const event = constructWebhookEvent({
  rawBody: body,          // exact bytes as a UTF-8 string
  headers: request.headers,
  secret: process.env.BITOS_PAY_WEBHOOK_SECRET!,
  previousSecret: process.env.BITOS_PAY_WEBHOOK_PREVIOUS_SECRET
});
```

Verification uses `BitOS-Pay-Signature` (`v1=` HMAC-SHA256 over
`timestamp.raw_body`), rejects timestamps outside 300 seconds by default, and
requires an event id matching `BitOS-Pay-Event-Id` when that header is present.
During rotation, pass both secrets: the verifier accepts
`BitOS-Pay-Signature` or `BitOS-Pay-Signature-Previous` when it matches either
configured secret. Remove the old secret before its grace expiry.
Deduplicate by `event.id` and process idempotently.

The current package is `@bitos/pay-js`. The Nuxt/React/node-specific wrappers
are planned; they must compose this client rather than fork the wire contract.
