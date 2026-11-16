import { randomBytes, randomUUID } from "node:crypto";
import { PayError, sha256Hex } from "../../domain/index.ts";
import type {
  CreateInvoiceInput,
  LightningProvider,
  ProviderInvoice,
  ProviderProof
} from "../../application/ports/lightning-provider.ts";

interface MockInvoice {
  providerReference: string;
  paymentHash: string;
  bolt11: string;
  amountMsat: bigint;
  expiresAt: Date;
  cancelled: boolean;
  settled: boolean;
}

export class MockLightningProvider implements LightningProvider {
  readonly name = "mock-lightning";
  readonly mode = "sandbox" as const;
  private invoices = new Map<string, MockInvoice>();
  private byHash = new Map<string, MockInvoice>();

  async createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice> {
    if (input.amountMsat <= 0n) throw new PayError("PAY_VALIDATION_AMOUNT");
    const paymentHash = sha256Hex(`${randomUUID()}:${randomBytes(32).toString("hex")}`);
    const providerReference = `mock_inv_${paymentHash.slice(0, 48)}`;
    const sat = input.amountMsat / 1000n;
    const invoice: MockInvoice = {
      providerReference,
      paymentHash,
      bolt11: `lnbcrt${sat.toString()}1mock${paymentHash.slice(0, 40)}`,
      amountMsat: input.amountMsat,
      expiresAt: new Date(Date.now() + input.expirySeconds * 1000),
      cancelled: false,
      settled: false
    };
    this.invoices.set(providerReference, invoice);
    this.byHash.set(paymentHash, invoice);
    return { ...invoice };
  }

  async verifyProof(input: {
    providerReference: string;
    paymentHash: string;
    amountMsat: bigint;
  }): Promise<ProviderProof> {
    const invoice = this.invoices.get(input.providerReference) ?? this.byHash.get(input.paymentHash);
    if (!invoice) throw new PayError("PAY_PROVIDER_PROOF", "provider invoice is unknown");
    if (invoice.cancelled) throw new PayError("PAY_PROVIDER_PROOF", "provider invoice was cancelled");
    if (invoice.providerReference !== input.providerReference) {
      throw new PayError("PAY_PROVIDER_PROOF", "provider reference does not match the payment hash");
    }
    if (invoice.paymentHash !== input.paymentHash) {
      throw new PayError("PAY_PROVIDER_PROOF", "payment hash does not match the provider invoice");
    }
    if (invoice.amountMsat !== input.amountMsat) {
      throw new PayError("PAY_PROVIDER_PROOF", "settled amount does not match the invoice");
    }
    invoice.settled = true;
    return {
      providerEventId: `mock_evt_${invoice.paymentHash}`,
      providerReference: invoice.providerReference,
      paymentHash: invoice.paymentHash,
      amountMsat: invoice.amountMsat,
      occurredAt: new Date()
    };
  }

  async cancelInvoice(input: { providerReference: string }): Promise<boolean> {
    const invoice = this.invoices.get(input.providerReference);
    if (!invoice || invoice.settled) return false;
    invoice.cancelled = true;
    return true;
  }

  async status(input: {
    providerReference: string;
  }): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN"> {
    const invoice = this.invoices.get(input.providerReference);
    if (!invoice) return "UNKNOWN";
    if (invoice.settled) return "SETTLED";
    if (invoice.cancelled) return "CANCELLED";
    return "PENDING";
  }
}
