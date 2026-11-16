import { PayError } from "../../domain/index.ts";
import type {
  CreateInvoiceInput,
  LightningProvider,
  ProviderInvoice,
  ProviderProof
} from "../../application/ports/lightning-provider.ts";

export interface BlinkProviderOptions {
  baseUrl: string;
  apiKey: string;
  walletId: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface BlinkResponse {
  status: number;
  body: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function wholeSatMsat(amountMsat: bigint): number {
  if (amountMsat <= 0n || amountMsat % 1000n !== 0n) {
    throw new PayError(
      "PAY_VALIDATION_AMOUNT",
      "the Blink live provider supports positive whole-sat amounts only"
    );
  }
  const sats = amountMsat / 1000n;
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PayError("PAY_VALIDATION_AMOUNT", "amount exceeds the provider limit");
  }
  return Number(sats);
}

function timestamp(value: unknown): Date | null {
  let parsed: Date;
  if (typeof value === "number" && Number.isFinite(value)) {
    parsed = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  } else if (typeof value === "string") {
    parsed = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value);
  } else {
    return null;
  }
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function providerError(message: string): PayError {
  return new PayError("PAY_PROVIDER_UNAVAILABLE", message);
}

function proofError(message: string): PayError {
  return new PayError("PAY_PROVIDER_PROOF", message);
}

function endpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/graphql") ? trimmed : `${trimmed}/graphql`;
}

export class BlinkLightningProvider implements LightningProvider {
  readonly name = "blink";
  readonly mode = "live" as const;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly walletId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: BlinkProviderOptions) {
    this.endpoint = endpoint(options.baseUrl);
    this.apiKey = options.apiKey;
    this.walletId = options.walletId;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async call(query: string, variables: Record<string, unknown>): Promise<BlinkResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-api-key": this.apiKey
        },
        body: JSON.stringify({ query, variables }),
        signal:
          typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined
      });
    } catch {
      throw providerError("Blink request failed");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  private payload(body: unknown): Record<string, unknown> | null {
    const root = record(body);
    const errors = Array.isArray(root.errors) ? root.errors : [];
    if (errors.length > 0) throw providerError("Blink API returned an error");
    const data = record(root.data);
    return Object.keys(data).length > 0 ? data : null;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const amount = wholeSatMsat(input.amountMsat);
    const response = await this.call(
      `mutation CreateInvoice($input: LnInvoiceCreateInput!) {
        lnInvoiceCreate(input: $input) {
          invoice { paymentRequest paymentHash satoshis }
          errors { message }
        }
      }`,
      {
        input: {
          amount,
          expiresIn: Math.max(1, Math.ceil(input.expirySeconds / 60)),
          memo: input.memo,
          walletId: this.walletId
        }
      }
    );
    if (response.status < 200 || response.status >= 300) {
      throw providerError("Blink could not create an invoice");
    }
    const data = this.payload(response.body);
    const result = record(data?.lnInvoiceCreate);
    const errors = Array.isArray(result.errors) ? result.errors : [];
    if (errors.length > 0) throw providerError("Blink could not create an invoice");
    const invoice = record(result.invoice);
    const paymentHash = text(invoice.paymentHash);
    const bolt11 = text(invoice.paymentRequest);
    const satoshis = integer(invoice.satoshis);
    if (!paymentHash || !bolt11 || satoshis === null || satoshis !== amount) {
      throw providerError("Blink returned an invalid invoice");
    }
    return {
      providerReference: paymentHash,
      paymentHash,
      bolt11,
      amountMsat: input.amountMsat,
      expiresAt: new Date(this.now().getTime() + input.expirySeconds * 1000)
    };
  }

  async verifyProof(input: {
    providerReference: string;
    paymentHash: string;
    amountMsat: bigint;
  }): Promise<ProviderProof> {
    const status = await this.paymentStatus(input.paymentHash);
    if (status === "PENDING") throw proofError("payment is still pending");
    if (status === "EXPIRED") throw proofError("provider invoice is expired");
    if (status !== "PAID") throw proofError("payment is not settled");
    return {
      providerEventId: `blink_${input.paymentHash}`,
      providerReference: input.providerReference,
      paymentHash: input.paymentHash,
      amountMsat: input.amountMsat,
      occurredAt: (await this.paidAt(input.paymentHash)) ?? this.now()
    };
  }

  private async paidAt(paymentHash: string): Promise<Date | null> {
    try {
      const response = await this.call(
        `query PaidAt($walletId: WalletId!, $paymentHash: PaymentHash!) {
          me {
            defaultAccount {
              walletById(walletId: $walletId) {
                ... on BTCWallet {
                  transactionsByPaymentHash(paymentHash: $paymentHash) {
                    createdAt
                    direction
                    status
                  }
                }
              }
            }
          }
        }`,
        { walletId: this.walletId, paymentHash }
      );
      if (response.status < 200 || response.status >= 300) return null;
      const data = this.payload(response.body);
      const account = record(record(data?.me).defaultAccount);
      const wallet = record(account.walletById);
      const transactions = Array.isArray(wallet.transactionsByPaymentHash)
        ? wallet.transactionsByPaymentHash
        : [];
      const received = transactions
        .map(record)
        .find(
          (transaction) =>
            transaction.direction === "RECEIVE" && transaction.status === "SUCCESS"
        );
      return timestamp(received?.createdAt);
    } catch {
      return null;
    }
  }

  async cancelInvoice(input: { providerReference: string }): Promise<boolean> {
    const response = await this.call(
      `mutation CancelInvoice($input: LnInvoiceCancelInput!) {
        lnInvoiceCancel(input: $input) { success errors { message } }
      }`,
      { input: { paymentHash: input.providerReference, walletId: this.walletId } }
    );
    if (response.status < 200 || response.status >= 300) {
      throw providerError("Blink could not cancel the invoice");
    }
    const data = this.payload(response.body);
    const result = record(data?.lnInvoiceCancel);
    return result.success === true;
  }

  async status(input: {
    providerReference: string;
  }): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN"> {
    const status = await this.paymentStatus(input.providerReference);
    if (status === "PAID") return "SETTLED";
    if (status === "EXPIRED") return "CANCELLED";
    if (status === "PENDING") return "PENDING";
    return "UNKNOWN";
  }

  private async paymentStatus(paymentHash: string): Promise<"PENDING" | "PAID" | "EXPIRED" | "UNKNOWN"> {
    const response = await this.call(
      `query PaymentStatus($input: LnInvoicePaymentStatusByHashInput!) {
        lnInvoicePaymentStatusByHash(input: $input) { status paymentHash }
      }`,
      { input: { paymentHash } }
    );
    if (response.status === 404) return "UNKNOWN";
    if (response.status < 200 || response.status >= 300) {
      throw providerError("Blink status check failed");
    }
    const data = this.payload(response.body);
    const result = record(data?.lnInvoicePaymentStatusByHash);
    const reportedHash = text(result.paymentHash);
    if (reportedHash !== paymentHash) {
      throw proofError("provider payment hash does not match the invoice");
    }
    const status = text(result.status);
    if (status === "PAID" || status === "PENDING" || status === "EXPIRED") return status;
    return "UNKNOWN";
  }
}
