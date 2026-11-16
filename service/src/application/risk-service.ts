import { PayError } from "../domain/index.ts";
import type { DbClient } from "../infrastructure/db/database.ts";
import type {
  MerchantRepository,
  PaymentRepository
} from "../infrastructure/repositories/index.ts";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

export class RiskService {
  private readonly merchants: MerchantRepository;
  private readonly payments: PaymentRepository;
  private readonly now: () => Date;

  constructor(
    merchants: MerchantRepository,
    payments: PaymentRepository,
    now: () => Date = () => new Date()
  ) {
    this.merchants = merchants;
    this.payments = payments;
    this.now = now;
  }

  async assertCanCreate(
    merchantId: string,
    amountMsat: bigint,
    client: DbClient
  ): Promise<void> {
    const merchant = await this.merchants.getMerchantForUpdate(merchantId, client);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    if (merchant.status !== "ACTIVE") throw new PayError("PAY_RISK_MERCHANT_STATUS");
    if (amountMsat > BigInt(merchant.max_payment_msat)) {
      throw new PayError("PAY_RISK_LIMIT", "amount exceeds the merchant payment limit");
    }

    const now = this.now();
    const usage = await this.payments.riskUsage(
      merchantId,
      new Date(now.getTime() - MINUTE_MS),
      new Date(now.getTime() - DAY_MS),
      client
    );
    if (usage.minuteCount >= Number(merchant.max_payments_per_minute)) {
      throw new PayError("PAY_RISK_VELOCITY");
    }
    if (usage.dayVolumeMsat + amountMsat > BigInt(merchant.daily_volume_msat)) {
      throw new PayError("PAY_RISK_LIMIT", "daily volume limit exceeded");
    }
  }
}
