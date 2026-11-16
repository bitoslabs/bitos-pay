import { PayError, sha256Hex } from "../domain/index.ts";
import type { AuthContext } from "../domain/types.ts";
import type { MerchantRepository } from "../infrastructure/repositories/index.ts";

export class AuthService {
  private readonly merchants: MerchantRepository;
  private readonly now: () => Date;

  constructor(merchants: MerchantRepository, now: () => Date = () => new Date()) {
    this.merchants = merchants;
    this.now = now;
  }

  async authenticate(authorization: string | undefined): Promise<AuthContext> {
    if (!authorization) throw new PayError("PAY_AUTH_MISSING");
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (!match) throw new PayError("PAY_AUTH_MISSING");
    const secret = match[1];
    if (!secret.startsWith("bp_test_") && !secret.startsWith("bp_live_")) {
      throw new PayError("PAY_AUTH_INVALID");
    }
    const row = await this.merchants.findApiKeyByHash(sha256Hex(secret));
    if (!row) throw new PayError("PAY_AUTH_INVALID");
    if (row.key_status !== "ACTIVE") throw new PayError("PAY_AUTH_REVOKED");
    const now = this.now();
    if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
      throw new PayError("PAY_AUTH_EXPIRED");
    }
    await this.merchants.touchApiKey(row.api_key_id, now);
    const context = this.merchants.toAuthContext(row);
    if (context.merchantStatus !== "ACTIVE") {
      throw new PayError("PAY_AUTH_SCOPE", "merchant is not active");
    }
    return context;
  }

  requireScope(auth: AuthContext, scope: string): void {
    if (!auth.scopes.includes(scope) && !auth.scopes.includes("*")) {
      throw new PayError("PAY_AUTH_SCOPE", `missing scope ${scope}`);
    }
  }
}
