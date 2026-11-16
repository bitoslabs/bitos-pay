import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "pcl_";
const SEPARATOR = ".";

function signature(intentId: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`checkout:${intentId}`, "utf8").digest();
}

export function checkoutToken(intentId: string, secret: string): string {
  const payload = Buffer.from(intentId, "utf8").toString("base64url");
  const sig = signature(intentId, secret).toString("base64url");
  return `${PREFIX}${payload}${SEPARATOR}${sig}`;
}

export function verifyCheckoutToken(token: string, secret: string): string | null {
  if (!token.startsWith(PREFIX)) return null;
  const [payload, encodedSignature, extra] = token.slice(PREFIX.length).split(SEPARATOR);
  if (!payload || !encodedSignature || extra !== undefined) return null;
  let intentId: string;
  try {
    intentId = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!intentId.startsWith("pi_") || intentId.length > 80) return null;
  const provided = Buffer.from(encodedSignature, "base64url");
  const expected = signature(intentId, secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return intentId;
}
