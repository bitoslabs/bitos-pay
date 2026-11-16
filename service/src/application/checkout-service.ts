import type { PayConfig } from "../config.ts";
import { PayError } from "../domain/errors.ts";
import { msatToSatNumber } from "../domain/money.ts";
import { checkoutToken, verifyCheckoutToken } from "../domain/checkout-token.ts";
import type { IntentStatus, InvoiceStatus, TransactionStatus } from "../domain/types.ts";
import type { MerchantRepository } from "../infrastructure/repositories/merchant-repository.ts";
import type { PaymentRepository } from "../infrastructure/repositories/payment-repository.ts";

export interface PublicCheckout {
  paymentId: string;
  merchantName: string;
  status: IntentStatus;
  amountSat: number;
  currency: string;
  scale: number;
  reference: string | null;
  livemode: boolean;
  expiresAt: string;
  invoice: {
    bolt11: string;
    paymentHash: string;
    status: InvoiceStatus;
    expiresAt: string;
    settledAt: string | null;
  } | null;
  transaction: {
    id: string;
    status: TransactionStatus;
    settledAt: string | null;
  } | null;
  paidAt: string | null;
}

export class CheckoutService {
  private readonly payments: PaymentRepository;
  private readonly merchants: MerchantRepository;
  private readonly config: PayConfig;
  private readonly now: () => Date;
  private readonly expireDueIntents: () => Promise<number>;

  constructor(
    payments: PaymentRepository,
    merchants: MerchantRepository,
    config: PayConfig,
    now: () => Date = () => new Date(),
    expireDueIntents: () => Promise<number> = async () => 0
  ) {
    this.payments = payments;
    this.merchants = merchants;
    this.config = config;
    this.now = now;
    this.expireDueIntents = expireDueIntents;
  }

  urlForIntent(intentId: string): string {
    const base = this.config.publicBaseUrl.replace(/\/$/, "");
    return `${base}/checkout/${checkoutToken(intentId, this.config.secretKey)}`;
  }

  async publicView(token: string): Promise<PublicCheckout> {
    const intentId = verifyCheckoutToken(token, this.config.secretKey);
    if (!intentId) throw new PayError("PAY_NOT_FOUND_INTENT");
    let view = await this.payments.getIntentViewById(intentId);
    if (!view) throw new PayError("PAY_NOT_FOUND_INTENT");
    if (
      (view.intent.status === "CREATED" || view.intent.status === "PENDING") &&
      Date.parse(view.intent.expiresAt) <= this.now().getTime()
    ) {
      await this.expireDueIntents();
      view = await this.payments.getIntentViewById(intentId);
      if (!view) throw new PayError("PAY_NOT_FOUND_INTENT");
    }
    const merchant = await this.merchants.getMerchant(view.intent.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    const paidAt = view.transaction?.settledAt ?? view.invoice?.settledAt ?? null;
    return {
      paymentId: view.intent.id,
      merchantName: merchant.name,
      status: view.intent.status,
      amountSat: msatToSatNumber(view.intent.amountMsat),
      currency: view.intent.currency,
      scale: view.intent.scale,
      reference: view.intent.externalReference,
      livemode: view.intent.livemode,
      expiresAt: view.intent.expiresAt,
      invoice: view.invoice
        ? {
            bolt11: view.invoice.bolt11,
            paymentHash: view.invoice.paymentHash,
            status: view.invoice.status,
            expiresAt: view.invoice.expiresAt,
            settledAt: view.invoice.settledAt
          }
        : null,
      transaction: view.transaction
        ? {
            id: view.transaction.id,
            status: view.transaction.status,
            settledAt: view.transaction.settledAt
          }
        : null,
      paidAt
    };
  }
}
