import { PayError } from "./errors.ts";
import { SAT_CURRENCY, SAT_SCALE } from "./constants.ts";

export function assertAmount(amount: unknown): bigint {
  if (typeof amount === "bigint") {
    if (amount <= 0n) throw new PayError("PAY_VALIDATION_AMOUNT");
    return amount;
  }
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new PayError("PAY_VALIDATION_AMOUNT");
  }
  return BigInt(amount);
}

export function assertCurrency(currency: unknown, scale: unknown): void {
  if (currency !== SAT_CURRENCY) throw new PayError("PAY_VALIDATION_CURRENCY");
  if (scale !== SAT_SCALE) throw new PayError("PAY_VALIDATION_SCALE");
}

export function satToMsat(sat: bigint): bigint {
  return sat * 1000n;
}

export function msatToSat(msat: bigint): bigint {
  if (msat % 1000n !== 0n) throw new PayError("PAY_VALIDATION_AMOUNT");
  return msat / 1000n;
}

export function msatToSatNumber(msat: bigint): number {
  return Number(msat) / 1000;
}

export function computeFee(
  amountMsat: bigint,
  feeBps: number
): { feeMsat: bigint; netMsat: bigint } {
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    throw new PayError("PAY_VALIDATION_BODY", "fee basis points are invalid");
  }
  if (amountMsat <= 0n) throw new PayError("PAY_VALIDATION_AMOUNT");
  const feeMsat = (amountMsat * BigInt(feeBps)) / 10000n;
  return { feeMsat, netMsat: amountMsat - feeMsat };
}
