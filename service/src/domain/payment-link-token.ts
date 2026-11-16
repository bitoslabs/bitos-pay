import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "plk_";
const SEPARATOR = ".";

function signature(linkId: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`payment-link:${linkId}`, "utf8").digest();
}

export function paymentLinkToken(linkId: string, secret: string): string {
  const payload = Buffer.from(linkId, "utf8").toString("base64url");
  const sig = signature(linkId, secret).toString("base64url");
  return `${PREFIX}${payload}${SEPARATOR}${sig}`;
}

export function verifyPaymentLinkToken(token: string, secret: string): string | null {
  if (!token.startsWith(PREFIX)) return null;
  const [payload, encodedSignature, extra] = token.slice(PREFIX.length).split(SEPARATOR);
  if (!payload || !encodedSignature || extra !== undefined) return null;
  let linkId: string;
  try {
    linkId = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!linkId.startsWith("pl_") || linkId.length > 80) return null;
  const provided = Buffer.from(encodedSignature, "base64url");
  const expected = signature(linkId, secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return linkId;
}
