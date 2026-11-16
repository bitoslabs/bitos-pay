import { PayError } from "../../domain/index.ts";
import type {
  CreateInvoiceInput,
  LightningProvider,
  ProviderInvoice,
  ProviderProof
} from "../../application/ports/lightning-provider.ts";

export interface StrikeProviderOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface StrikeResponse {
  status: number;
  body: unknown;
}

interface ReceiveItem {
  receiveId: string;
  state: "PENDING" | "COMPLETED";
  amountReceived: string;
  paymentHash: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function wholeSatMsat(amountMsat: bigint): bigint {
  if (amountMsat <= 0n || amountMsat % 1000n !== 0n) {
    throw new PayError(
      "PAY_VALIDATION_AMOUNT",
      "the Strike live provider supports positive whole-sat amounts only"
    );
  }
  return amountMsat / 1000n;
}

function satsToBtc(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const fraction = (sats % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${fraction}`;
}

function btcToMsat(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new PayError("PAY_PROVIDER_PROOF", "provider amount is invalid");
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? "").padEnd(8, "0"));
  return (whole * 100_000_000n + fraction) * 1000n;
}

function providerError(message: string): PayError {
  return new PayError("PAY_PROVIDER_UNAVAILABLE", message);
}

function proofError(message: string): PayError {
  return new PayError("PAY_PROVIDER_PROOF", message);
}

function endpoint(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

export class StrikeLightningProvider implements LightningProvider {
  readonly name = "strike";
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: StrikeProviderOptions) {
    this.baseUrl = endpoint(options.baseUrl);
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async call(path: string, init: RequestInit = {}): Promise<StrikeResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {})
        },
        signal:
          init.signal ??
          (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined)
      });
    } catch {
      throw providerError("Strike request failed");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    const sats = wholeSatMsat(input.amountMsat);
    const response = await this.call("/receive-requests", {
      method: "POST",
      body: JSON.stringify({
        bolt11: {
          amount: { amount: satsToBtc(sats), currency: "BTC" },
          description: input.memo,
          expiryInSeconds: Math.max(60, input.expirySeconds)
        },
        targetCurrency: "BTC"
      })
    });
    if (response.status < 200 || response.status >= 300) {
      throw providerError("Strike could not create a receive request");
    }
    const body = record(response.body);
    const providerReference = text(body.receiveRequestId);
    const bolt11 = record(body.bolt11);
    const paymentHash = text(bolt11.paymentHash);
    const invoice = text(bolt11.invoice);
    if (!providerReference || !paymentHash || !invoice) {
      throw providerError("Strike returned an invalid receive request");
    }
    const expires = text(bolt11.expires);
    const expiresAt = expires ? new Date(expires) : new Date(this.now().getTime() + input.expirySeconds * 1000);
    return {
      providerReference,
      paymentHash,
      bolt11: invoice,
      amountMsat: input.amountMsat,
      expiresAt: Number.isNaN(expiresAt.getTime())
        ? new Date(this.now().getTime() + input.expirySeconds * 1000)
        : expiresAt
    };
  }

  async verifyProof(input: {
    providerReference: string;
    paymentHash: string;
    amountMsat: bigint;
  }): Promise<ProviderProof> {
    const items = await this.listReceives(input.providerReference, input.paymentHash);
    const completed = items.find((item) => item.state === "COMPLETED");
    if (!completed) {
      if (items.some((item) => item.state === "PENDING")) {
        throw proofError("payment is still pending");
      }
      throw proofError("payment is not settled");
    }
    if (completed.paymentHash !== input.paymentHash) {
      throw proofError("provider payment hash does not match the invoice");
    }
    const amountMsat = btcToMsat(completed.amountReceived);
    if (amountMsat !== input.amountMsat) {
      throw proofError("settled amount does not match the invoice");
    }
    return {
      providerEventId: `strike_${completed.receiveId}`,
      providerReference: input.providerReference,
      paymentHash: input.paymentHash,
      amountMsat,
      occurredAt: this.now()
    };
  }

  async cancelInvoice(): Promise<boolean> {
    return false;
  }

  async resolvePaymentHash(input: { providerReference: string }): Promise<string> {
    const response = await this.call(
      `/receive-requests/${encodeURIComponent(input.providerReference)}`
    );
    if (response.status === 404) throw proofError("provider receive request is unknown");
    if (response.status < 200 || response.status >= 300) {
      throw providerError("Strike receive request lookup failed");
    }
    const body = record(response.body);
    const paymentHash = text(record(body.bolt11).paymentHash);
    if (!paymentHash) throw proofError("provider payment hash is missing");
    return paymentHash;
  }

  async status(input: {
    providerReference: string;
  }): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN"> {
    const response = await this.call(
      `/receive-requests/${encodeURIComponent(input.providerReference)}`
    );
    if (response.status === 404) return "UNKNOWN";
    if (response.status < 200 || response.status >= 300) {
      throw providerError("Strike status check failed");
    }
    const body = record(response.body);
    const items = await this.listReceives(input.providerReference, null);
    if (items.some((item) => item.state === "COMPLETED")) return "SETTLED";
    if (items.some((item) => item.state === "PENDING")) return "PENDING";
    const expires = text(record(body.bolt11).expires);
    if (expires && Date.parse(expires) <= this.now().getTime()) return "CANCELLED";
    return "PENDING";
  }

  private async listReceives(
    providerReference: string,
    paymentHash: string | null
  ): Promise<ReceiveItem[]> {
    const params = new URLSearchParams();
    params.set("$top", "100");
    if (paymentHash) params.set("$paymentHash", paymentHash);
    const response = await this.call(
      `/receive-requests/${encodeURIComponent(providerReference)}/receives?${params.toString()}`
    );
    if (response.status === 404) throw proofError("provider receive request is unknown");
    if (response.status < 200 || response.status >= 300) {
      throw providerError("Strike receive status check failed");
    }
    const body = record(response.body);
    const items = Array.isArray(body.items) ? body.items : [];
    return items.map((value) => {
      const item = record(value);
      const lightning = record(item.lightning);
      const amount = record(item.amountReceived);
      const state = text(item.state);
      const receiveId = text(item.receiveId);
      const itemHash = text(lightning.paymentHash) ?? text(item.paymentHash);
      if (!receiveId || (state !== "PENDING" && state !== "COMPLETED")) {
        throw proofError("provider receive is invalid");
      }
      return {
        receiveId,
        state,
        amountReceived: text(amount.amount) ?? "0",
        paymentHash: itemHash
      };
    });
  }
}
