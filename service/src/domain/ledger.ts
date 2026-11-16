import { PayError } from "./errors.ts";
import type { LedgerAccountType, LedgerDirection } from "./types.ts";

export interface LedgerLineInput {
  accountCode: string;
  accountType: LedgerAccountType;
  direction: LedgerDirection;
  amountMsat: bigint;
}

export function assertBalanced(lines: LedgerLineInput[]): void {
  let debit = 0n;
  let credit = 0n;
  for (const line of lines) {
    if (line.amountMsat <= 0n) {
      throw new PayError("PAY_VALIDATION_AMOUNT", "ledger entry amount must be positive");
    }
    if (line.direction === "debit") debit += line.amountMsat;
    else credit += line.amountMsat;
  }
  if (debit !== credit) {
    throw new PayError("PAY_STATE_ILLEGAL", "ledger entry set is not balanced");
  }
}

export function paymentLedgerLines(amountMsat: bigint, feeMsat: bigint): LedgerLineInput[] {
  if (feeMsat < 0n || feeMsat > amountMsat) throw new PayError("PAY_VALIDATION_AMOUNT");
  const netMsat = amountMsat - feeMsat;
  const lines: LedgerLineInput[] = [
    { accountCode: "provider_clearing", accountType: "ASSET", direction: "debit", amountMsat },
    {
      accountCode: "merchant_payable",
      accountType: "LIABILITY",
      direction: "credit",
      amountMsat: netMsat
    }
  ];
  if (feeMsat > 0n) {
    lines.push({
      accountCode: "platform_fee_revenue",
      accountType: "REVENUE",
      direction: "credit",
      amountMsat: feeMsat
    });
  }
  assertBalanced(lines);
  return lines;
}

export interface RefundLedgerResult {
  feeMsat: bigint;
  netMsat: bigint;
  lines: LedgerLineInput[];
}

export function refundLedgerLines(input: {
  originalAmountMsat: bigint;
  originalFeeMsat: bigint;
  refundedBeforeMsat: bigint;
  refundAmountMsat: bigint;
}): RefundLedgerResult {
  const {
    originalAmountMsat,
    originalFeeMsat,
    refundedBeforeMsat,
    refundAmountMsat
  } = input;
  if (
    originalAmountMsat <= 0n ||
    originalFeeMsat < 0n ||
    originalFeeMsat > originalAmountMsat ||
    refundedBeforeMsat < 0n ||
    refundedBeforeMsat >= originalAmountMsat ||
    refundAmountMsat <= 0n ||
    refundAmountMsat > originalAmountMsat - refundedBeforeMsat
  ) {
    throw new PayError("PAY_VALIDATION_AMOUNT");
  }

  const feeBefore = (refundedBeforeMsat * originalFeeMsat) / originalAmountMsat;
  const refundedAfter = refundedBeforeMsat + refundAmountMsat;
  const feeAfter =
    refundedAfter === originalAmountMsat
      ? originalFeeMsat
      : (refundedAfter * originalFeeMsat) / originalAmountMsat;
  const feeMsat = feeAfter - feeBefore;
  const netMsat = refundAmountMsat - feeMsat;

  const lines: LedgerLineInput[] = [
    {
      accountCode: "provider_clearing",
      accountType: "ASSET",
      direction: "credit",
      amountMsat: refundAmountMsat
    }
  ];
  if (netMsat > 0n) {
    lines.push({
      accountCode: "merchant_payable",
      accountType: "LIABILITY",
      direction: "debit",
      amountMsat: netMsat
    });
  }
  if (feeMsat > 0n) {
    lines.push({
      accountCode: "platform_fee_revenue",
      accountType: "REVENUE",
      direction: "debit",
      amountMsat: feeMsat
    });
  }
  assertBalanced(lines);
  return { feeMsat, netMsat, lines };
}
