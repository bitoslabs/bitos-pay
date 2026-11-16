export interface CreateInvoiceInput {
  amountMsat: bigint;
  memo: string;
  expirySeconds: number;
}

export interface ProviderInvoice {
  providerReference: string;
  paymentHash: string;
  bolt11: string;
  amountMsat: bigint;
  expiresAt: Date;
}

export interface ProviderProof {
  providerEventId: string;
  providerReference: string;
  paymentHash: string;
  amountMsat: bigint;
  occurredAt: Date;
}

export interface LightningProvider {
  readonly name: string;
  readonly mode: "sandbox" | "live";
  createInvoice(input: CreateInvoiceInput): Promise<ProviderInvoice>;
  verifyProof(input: {
    providerReference: string;
    paymentHash: string;
    amountMsat: bigint;
  }): Promise<ProviderProof>;
  cancelInvoice(input: { providerReference: string }): Promise<boolean>;
  status(input: {
    providerReference: string;
  }): Promise<"PENDING" | "SETTLED" | "CANCELLED" | "UNKNOWN">;
  resolvePaymentHash?(input: { providerReference: string }): Promise<string>;
}
