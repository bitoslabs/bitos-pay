import { PayError, newId } from "../domain/index.ts";
import type { AuthContext } from "../domain/types.ts";
import type {
  AuditRepository,
  MerchantRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export interface UpdateMerchantProfileInput {
  name: string;
  support_email?: string | null;
  website?: string | null;
}

export class MerchantProfileService {
  private readonly merchants: MerchantRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly now: () => Date;

  constructor(
    merchants: MerchantRepository,
    audit: AuditRepository,
    auth: AuthService,
    now: () => Date = () => new Date()
  ) {
    this.merchants = merchants;
    this.audit = audit;
    this.auth = auth;
    this.now = now;
  }

  async update(auth: AuthContext, input: UpdateMerchantProfileInput) {
    this.auth.requireScope(auth, "merchants:write");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > 120) {
      throw new PayError(
        "PAY_VALIDATION_BODY",
        "name must be between 1 and 120 characters"
      );
    }
    const supportEmail = this.email(input.support_email);
    const website = this.website(input.website);
    const now = this.now();
    return this.merchants.db.transaction(async (client) => {
      const merchant = await this.merchants.updateProfile(
        auth.merchantId,
        { name, supportEmail, website },
        now,
        client
      );
      if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "merchant.profile.update",
          targetRef: auth.merchantId,
          result: "ACCEPTED",
          now
        },
        client
      );
      return {
        id: merchant.id,
        organization_id: merchant.organization_id,
        name: merchant.name,
        status: merchant.status,
        default_currency: merchant.default_currency,
        support_email: merchant.support_email,
        website: merchant.website
      };
    });
  }

  private email(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 254) {
      throw new PayError("PAY_VALIDATION_BODY", "support_email is invalid");
    }
    const email = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new PayError("PAY_VALIDATION_BODY", "support_email is invalid");
    }
    return email;
  }

  private website(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || value.length > 2048) {
      throw new PayError("PAY_VALIDATION_BODY", "website is invalid");
    }
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new PayError("PAY_VALIDATION_BODY", "website is invalid");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      throw new PayError("PAY_VALIDATION_BODY", "website is invalid");
    }
    return url.toString();
  }
}
