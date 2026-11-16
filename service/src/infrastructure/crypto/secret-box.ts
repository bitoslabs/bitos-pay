import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SecretBox } from "../../application/ports/secret-box.ts";

export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("PAY_SECRET_KEY must be 32 bytes encoded as base64");
  }
  return {
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString("base64url")}`;
    },
    decrypt(ciphertext) {
      const [version, ivRaw, bodyRaw, tagRaw] = ciphertext.split(".");
      if (version !== "v1" || !ivRaw || !bodyRaw || !tagRaw) {
        throw new Error("invalid encrypted secret");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
      decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(bodyRaw, "base64url")),
        decipher.final()
      ]).toString("utf8");
    }
  };
}
