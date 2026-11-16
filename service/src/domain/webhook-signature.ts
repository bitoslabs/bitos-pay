import { createHmac, timingSafeEqual } from "node:crypto";

export function webhookSignature(secret: string, timestamp: number, rawBody: string): string {
  return `v1=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")}`;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  rawBody: string,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
  const expected = Buffer.from(webhookSignature(secret, timestamp, rawBody), "utf8");
  const supplied = Buffer.from(signature, "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
