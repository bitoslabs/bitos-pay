import { API_KEY_SCOPES, PayError, newId, randomToken, sha256Hex } from "../domain/index.ts";
import type { ApiKeySummary, AuthContext } from "../domain/types.ts";
import type {
  AuditRepository,
  MerchantRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export interface CreateApiKeyInput {
  label?: string | null;
  scopes?: string[];
  expires_in_days?: number | null;
}

function normalizeLabel(label: string | null | undefined): string | null {
  if (label === undefined || label === null) return null;
  const trimmed = label.trim();
  if (!trimmed) return null;
  if (trimmed.length > 80) {
    throw new PayError("PAY_VALIDATION_BODY", "label must be at most 80 characters");
  }
  return trimmed;
}

export type CreatedApiKey = ApiKeySummary & { key: string };

const ALLOWED_SCOPES = new Set<string>(API_KEY_SCOPES);

export class ApiKeyService {
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

  async listKeys(auth: AuthContext): Promise<ApiKeySummary[]> {
    this.auth.requireScope(auth, "keys:read");
    return this.merchants.listApiKeys(auth.merchantId);
  }

  async createKey(auth: AuthContext, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    this.auth.requireScope(auth, "keys:write");
    const scopes = input.scopes ?? [...API_KEY_SCOPES];
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new PayError("PAY_VALIDATION_BODY", "scopes must be a non-empty array");
    }
    for (const scope of scopes) {
      if (!ALLOWED_SCOPES.has(scope)) {
        throw new PayError("PAY_VALIDATION_BODY", `unsupported scope ${scope}`);
      }
    }

    const days = input.expires_in_days ?? null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) {
      throw new PayError("PAY_VALIDATION_BODY", "expires_in_days must be an integer between 1 and 365");
    }

    const label = normalizeLabel(input.label);
    const now = this.now();
    const expiresAt = days === null ? null : new Date(now.getTime() + days * 24 * 60 * 60_000);
    const id = newId("key");
    const secret = randomToken(auth.livemode ? "bp_live_" : "bp_test_", 32);
    const summary: ApiKeySummary = {
      id,
      keyPrefix: secret.slice(0, 20),
      label,
      scopes,
      livemode: auth.livemode,
      status: "ACTIVE",
      lastUsedAt: null,
      createdAt: now.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null
    };

    await this.merchants.db.transaction(async (client) => {
      await this.merchants.createApiKey(
        {
          id,
          merchantId: auth.merchantId,
          keyPrefix: summary.keyPrefix,
          keyHash: sha256Hex(secret),
          label,
          scopes,
          livemode: auth.livemode,
          now,
          expiresAt
        },
        client
      );
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "api_key.create",
          targetRef: id,
          result: "ACCEPTED",
          now
        },
        client
      );
    });

    return { ...summary, key: secret };
  }

  async rotateKey(auth: AuthContext, keyId: string): Promise<CreatedApiKey> {
    this.auth.requireScope(auth, "keys:write");
    if (keyId === auth.apiKeyId) {
      throw new PayError("PAY_STATE_ILLEGAL", "cannot rotate the key used for this request");
    }
    const existing = (await this.merchants.listApiKeys(auth.merchantId)).find(
      (key) => key.id === keyId
    );
    if (!existing) throw new PayError("PAY_NOT_FOUND_API_KEY");
    if (existing.status !== "ACTIVE") {
      throw new PayError("PAY_STATE_ILLEGAL", "only an active API key can be rotated");
    }
    if (existing.livemode !== auth.livemode) {
      throw new PayError("PAY_AUTH_SCOPE", "cannot rotate a key from another mode");
    }
    if (existing.expiresAt && new Date(existing.expiresAt).getTime() <= this.now().getTime()) {
      throw new PayError("PAY_STATE_ILLEGAL", "cannot rotate an expired API key");
    }

    const now = this.now();
    const id = newId("key");
    const secret = randomToken(existing.livemode ? "bp_live_" : "bp_test_", 32);
    const summary: ApiKeySummary = {
      id,
      keyPrefix: secret.slice(0, 20),
      label: existing.label,
      scopes: existing.scopes,
      livemode: existing.livemode,
      status: "ACTIVE",
      lastUsedAt: null,
      createdAt: now.toISOString(),
      expiresAt: existing.expiresAt
    };

    await this.merchants.db.transaction(async (client) => {
      const revoked = await this.merchants.revokeApiKey(auth.merchantId, keyId, client);
      if (!revoked) throw new PayError("PAY_STATE_ILLEGAL", "API key is no longer active");
      await this.merchants.createApiKey(
        {
          id,
          merchantId: auth.merchantId,
          keyPrefix: summary.keyPrefix,
          keyHash: sha256Hex(secret),
          label: existing.label,
          scopes: existing.scopes,
          livemode: existing.livemode,
          now,
          expiresAt: existing.expiresAt ? new Date(existing.expiresAt) : null
        },
        client
      );
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "api_key.rotate",
          targetRef: id,
          result: "ACCEPTED",
          now
        },
        client
      );
    });

    return { ...summary, key: secret };
  }

  async revokeKey(auth: AuthContext, keyId: string): Promise<ApiKeySummary> {
    this.auth.requireScope(auth, "keys:write");
    if (keyId === auth.apiKeyId) {
      throw new PayError("PAY_STATE_ILLEGAL", "cannot revoke the key used for this request");
    }
    const now = this.now();
    const summary = await this.merchants.revokeApiKey(auth.merchantId, keyId);
    if (!summary) throw new PayError("PAY_NOT_FOUND_API_KEY");
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "api_key.revoke",
      targetRef: keyId,
      result: "ACCEPTED",
      now
    });
    return summary;
  }

  async updateLabel(
    auth: AuthContext,
    keyId: string,
    rawLabel: string | null | undefined
  ): Promise<ApiKeySummary> {
    this.auth.requireScope(auth, "keys:write");
    const label = normalizeLabel(rawLabel);
    const now = this.now();
    const updated = await this.merchants.updateApiKeyLabel(auth.merchantId, keyId, label);
    if (!updated) throw new PayError("PAY_NOT_FOUND_API_KEY");
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "api_key.label_update",
      targetRef: keyId,
      result: "ACCEPTED",
      now
    });
    return updated;
  }
}
