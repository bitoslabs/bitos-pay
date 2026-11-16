import { PayError } from "../../domain/index.ts";
import type {
  CreateInvoiceInput,
  LightningProvider,
  ProviderInvoice,
  ProviderProof
} from "../../application/ports/lightning-provider.ts";

export interface LnbitsProviderOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

interface LnbitsResponse {
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

function wholeSatMsat(amountMsat: bigint): number {
  if (amountMsat <= 0n || amountMsat % 1000n !== 0n) {
    throw new PayError(
      "PAY_VALIDATION_AMOUNT",
      "the live provider supports positive whole-sat amounts only"
    );
  }
  const sats = amountMsat / 1000n;
  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PayError("PAY_VALIDATION_AMOUNT", "amount exceeds the provider limit");
  }
  return Number(sats);
}

function proofError(message: string): PayError {
  return new PayError("PAY_PROVIDER_PROOF", message);
}

export class LnbitsLightningProvider implements LightningProvider {
  readonly name = "lnbits";
  readonly mode = "live" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: LnbitsProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async call(path: string, init: RequestInit = {}): Promise<LnbitsResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "X-Api-Key": this.apiKey,
          ...(init.headers ?? {})
        },
        signal:
          init.signal ??
          (typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(10_000) : undefined)
      });
    } catch {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "LNbits request failed");
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
    const amount = wholeSatMsat(input.amountMsat);
    const response = await this.call("/api/v1/payments", {
      method: "POST",
      body: JSON.stringify({
        out: false,
        amount,
        unit: "sat",
        memo: input.memo,
        expiry: input.expirySeconds
      })
    });
    if (response.status < 200 || response.status >= 300) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "LNbits could not create an invoice");
    }
    const body = record(response.body);
    const paymentHash = text(body.payment_hash);
    const bolt11 = text(body.payment_request) ?? text(body.bolt11);
    if (!paymentHash || !bolt11) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "LNbits returned an invalid invoice");
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
    const response = await this.call(
      `/api/v1/payments/${encodeURIComponent(input.paymentHash)}`,
      { method: "GET" }
    );
    if (response.status === 404) throw proofError("provider invoice is unknown");
    if (response.status < 200 || response.status >= 300) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "LNbits status check failed");
    }
    const body = record(response.body);
    const details = record(body.details);
    if (body.paid !== true) {
      throw proofError(
        details.pending === true ? "payment is still pending" : "payment is not settled"
      );
    }
    const reportedHash = text(details.payment_hash);
    if (reportedHash && reportedHash !== input.paymentHash) {
      throw proofError("provider payment hash does not match the invoice");
    }
    const rawAmount = details.amount;
    if (typeof rawAmount === "number" || typeof rawAmount === "string") {
      let reported: bigint;
      try {
        reported = BigInt(rawAmount);
      } catch {
        throw proofError("provider amount is invalid");
      }
      const matchesMsat = reported === input.amountMsat;
      const matchesSats = reported * 1000n === input.amountMsat;
      if (!matchesMsat && !matchesSats) {
        throw proofError("settled amount does not match the invoice");
      }
    } else {
      throw proofError("provider amount is missing");
    }
    return {
      providerEventId: `lnbits_${input.paymentHash}`,
      providerReference: input.providerReference,
      paymentHash: input.paymentHash,
      amountMsat: input.amountMsat,
      occurredAt: this.now()
    };
  }

  async cancelInvoice(input: { providerReference: string }): Promise<boolean> {
    const response = await this.call(
      `/api/v1/payments/${encodeURIComponent(input.providerReference)}`,
      { method: "DELETE" }
    );
    if (response.status === 404 || response.status === 405) return false;
    if (response.status < 200 || response.status >= 300) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "LNbits could not cancel the invoice");
    }
    return true;
  }

  async status(input: {
    providerReference: string;
  }): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN"> {
    const response = await this.call(
      `/api/v1/payments/${encodeURIComponent(input.providerReference)}`,
      { method: "GET" }
    );
    if (response.status === 404) return "UNKNOWN";
    if (response.status < 200 || response.status >= 300) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "LNbits status check failed");
    }
    const body = record(response.body);
    if (body.paid === true) return "SETTLED";
    return "PENDING";
  }
}
