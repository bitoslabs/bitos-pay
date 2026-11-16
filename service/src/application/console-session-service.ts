import { timingSafeEqual } from "node:crypto";
import { PayError, newId, randomToken, sha256Hex } from "../domain/index.ts";
import type { AuthContext, MerchantStatus } from "../domain/types.ts";
import type { ConsoleMode } from "../config.ts";
import type {
  AuditRepository,
  ConsoleNostrIdentity,
  ConsoleNostrIdentityRepository,
  ConsoleSessionRepository,
  MerchantRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export interface ConsoleLogin {
  session: {
    id: string;
    api_key_id: string;
    merchant: {
      id: string;
      organization_id: string;
      name: string;
      status: MerchantStatus;
      default_currency: string;
    };
    scopes: string[];
    livemode: boolean;
    auth_method: "api_key" | "nostr";
    nostr_pubkey: string | null;
    linked_nostr_pubkey: string | null;
    expires_at: string;
  };
  token: string;
  csrfToken: string;
  sessionTtlMs: number;
}

export interface ConsoleContext {
  sessionId: string;
  auth: AuthContext;
  merchant: {
    id: string;
    organization_id: string;
    name: string;
    status: MerchantStatus;
    default_currency: string;
  };
  scopes: string[];
  authMethod: "api_key" | "nostr";
  nostrPubkey: string | null;
  expiresAt: string;
  csrfHash: string;
  csrfToken: string;
}

export class ConsoleSessionService {
  private readonly sessions: ConsoleSessionRepository;
  private readonly identities: ConsoleNostrIdentityRepository;
  private readonly merchants: MerchantRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly modes: ReadonlySet<ConsoleMode>;

  constructor(
    sessions: ConsoleSessionRepository,
    identities: ConsoleNostrIdentityRepository,
    merchants: MerchantRepository,
    audit: AuditRepository,
    auth: AuthService,
    ttlSeconds: number,
    modes: readonly ConsoleMode[] = ["sandbox"],
    now: () => Date = () => new Date()
  ) {
    this.sessions = sessions;
    this.identities = identities;
    this.merchants = merchants;
    this.audit = audit;
    this.auth = auth;
    this.now = now;
    this.ttlMs = ttlSeconds * 1000;
    this.modes = new Set(modes);
  }

  async login(apiKey: string, requestedMode?: ConsoleMode): Promise<ConsoleLogin> {
    const auth = await this.auth.authenticate(`Bearer ${apiKey.trim()}`);
    this.assertMode(auth.livemode, requestedMode);
    if (!auth.scopes.includes("*") && !auth.scopes.includes("payments:read")) {
      throw new PayError("PAY_AUTH_SCOPE", "console sign-in requires payments:read");
    }
    const merchant = await this.merchants.getMerchant(auth.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    if (merchant.status !== "ACTIVE") {
      throw new PayError("PAY_AUTH_SCOPE", "merchant is not active");
    }
    return this.issueSession(auth, merchant, "api_key", null);
  }

  async loginNostrPubkey(pubkey: string, requestedMode?: ConsoleMode): Promise<ConsoleLogin> {
    const identity = await this.identities.findActiveByPubkey(pubkey);
    if (!identity) throw new PayError("PAY_AUTH_INVALID", "Nostr key is not linked");
    return this.loginNostr(identity, requestedMode);
  }

  async loginNostr(
    identity: ConsoleNostrIdentity,
    requestedMode?: ConsoleMode
  ): Promise<ConsoleLogin> {
    if (identity.status !== "ACTIVE" || identity.revokedAt) {
      throw new PayError("PAY_AUTH_INVALID");
    }
    const key = await this.merchants.findApiKeyById(identity.apiKeyId);
    if (!key || key.key_status !== "ACTIVE") {
      throw new PayError("PAY_AUTH_REVOKED", "linked API key is no longer active");
    }
    this.assertMode(key.livemode, requestedMode);
    if (key.expires_at && new Date(key.expires_at).getTime() <= this.now().getTime()) {
      throw new PayError("PAY_AUTH_EXPIRED", "linked API key has expired");
    }
    if (key.merchant_id !== identity.merchantId || key.organization_id !== identity.organizationId) {
      throw new PayError("PAY_AUTH_SCOPE", "linked identity scope does not match its API key");
    }
    const merchant = await this.merchants.getMerchant(identity.merchantId);
    if (!merchant || merchant.status !== "ACTIVE") {
      throw new PayError("PAY_AUTH_SCOPE", "merchant is not active");
    }
    const auth = this.merchants.toAuthContext(key);
    await this.identities.touch(identity.id, this.now());
    return this.issueSession(auth, merchant, "nostr", identity.pubkey);
  }

  private assertMode(livemode: boolean, requestedMode?: ConsoleMode): void {
    const actual: ConsoleMode = livemode ? "live" : "sandbox";
    if (!this.modes.has(actual) || (requestedMode && requestedMode !== actual)) {
      if (requestedMode && requestedMode !== actual) {
        throw new PayError(
          "PAY_AUTH_SCOPE",
          requestedMode === "live"
            ? "this key or identity is not live; sign in with a bp_live_ key first"
            : "this key or identity is live; switch to Live mode or use a sandbox key"
        );
      }
      throw new PayError(
        "PAY_AUTH_SCOPE",
        this.modes.size === 1
          ? `console sign-in requires a ${[...this.modes][0]} API key`
          : "console sign-in key does not match the configured console modes"
      );
    }
  }

  private supports(livemode: boolean): boolean {
    return this.modes.has(livemode ? "live" : "sandbox");
  }

  private async issueSession(
    auth: AuthContext,
    merchant: NonNullable<Awaited<ReturnType<MerchantRepository["getMerchant"]>>>,
    authMethod: "api_key" | "nostr",
    nostrPubkey: string | null
  ): Promise<ConsoleLogin> {
    const linked = authMethod === "api_key"
      ? await this.identities.findActiveByApiKey(auth.apiKeyId)
      : null;
    const now = this.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const token = randomToken("pcs_", 32);
    const csrfToken = randomToken("csrf_", 24);
    const session = await this.sessions.create({
      id: newId("cs"),
      merchantId: auth.merchantId,
      organizationId: auth.organizationId,
      apiKeyId: auth.apiKeyId,
      tokenHash: sha256Hex(token),
      csrfHash: sha256Hex(csrfToken),
      scopes: auth.scopes,
      livemode: auth.livemode,
      authMethod,
      nostrPubkey,
      now,
      expiresAt
    });
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: authMethod === "nostr" ? `nostr:${nostrPubkey}` : `api_key:${auth.apiKeyId}`,
      action: "console.session.create",
      targetRef: session.id,
      result: "ACCEPTED",
      now
    });

    return {
      session: {
        id: session.id,
        api_key_id: session.apiKeyId,
        merchant: {
          id: merchant.id,
          organization_id: merchant.organization_id,
          name: merchant.name,
          status: merchant.status,
          default_currency: merchant.default_currency
        },
        scopes: session.scopes,
        livemode: session.livemode,
        auth_method: session.authMethod,
        nostr_pubkey: session.nostrPubkey,
        linked_nostr_pubkey: linked?.pubkey ?? session.nostrPubkey,
        expires_at: session.expiresAt
      },
      token,
      csrfToken,
      sessionTtlMs: this.ttlMs
    };
  }

  async authenticate(token: string | null, rotateCsrf = false): Promise<ConsoleContext> {
    if (!token) throw new PayError("PAY_AUTH_MISSING");
    const session = await this.sessions.findByTokenHash(sha256Hex(token));
    if (!session) throw new PayError("PAY_AUTH_INVALID");
    if (session.revokedAt) throw new PayError("PAY_AUTH_REVOKED");
    const now = this.now();
    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      await this.sessions.revoke(session.id, now);
      throw new PayError("PAY_AUTH_REVOKED", "console session expired");
    }
    if (session.authMethod === "nostr") {
      const identity = session.nostrPubkey
        ? await this.identities.findActiveByPubkey(session.nostrPubkey)
        : null;
      if (
        !identity ||
        identity.merchantId !== session.merchantId ||
        identity.apiKeyId !== session.apiKeyId
      ) {
        await this.sessions.revoke(session.id, now);
        throw new PayError("PAY_AUTH_REVOKED", "linked Nostr identity is no longer active");
      }
    }
    const apiKey = await this.merchants.findApiKeyById(session.apiKeyId);
    if (
      !apiKey ||
      apiKey.key_status !== "ACTIVE" ||
      apiKey.livemode !== session.livemode ||
      !this.supports(session.livemode)
    ) {
      await this.sessions.revoke(session.id, now);
      throw new PayError("PAY_AUTH_REVOKED", "session API key is no longer active for this console mode");
    }
    if (apiKey.expires_at && new Date(apiKey.expires_at).getTime() <= now.getTime()) {
      await this.sessions.revoke(session.id, now);
      throw new PayError("PAY_AUTH_EXPIRED", "session API key has expired");
    }
    const merchant = await this.merchants.getMerchant(session.merchantId);
    if (!merchant) throw new PayError("PAY_NOT_FOUND_MERCHANT");
    if (merchant.status !== "ACTIVE") {
      await this.sessions.revoke(session.id, now);
      throw new PayError("PAY_AUTH_SCOPE", "merchant is not active");
    }

    let csrfToken = "";
    if (rotateCsrf) {
      csrfToken = randomToken("csrf_", 24);
      await this.sessions.rotateCsrf(session.id, sha256Hex(csrfToken));
    }

    return {
      sessionId: session.id,
      auth: {
        apiKeyId: session.apiKeyId,
        organizationId: session.organizationId,
        merchantId: session.merchantId,
        merchantStatus: merchant.status,
        scopes: session.scopes,
        livemode: session.livemode
      },
      merchant: {
        id: merchant.id,
        organization_id: merchant.organization_id,
        name: merchant.name,
        status: merchant.status,
        default_currency: merchant.default_currency
      },
      scopes: session.scopes,
      authMethod: session.authMethod,
      nostrPubkey: session.nostrPubkey,
      expiresAt: session.expiresAt,
      csrfHash: session.csrfHash,
      csrfToken
    };
  }

  assertCsrf(context: ConsoleContext, provided: string | undefined): void {
    if (!provided) throw new PayError("PAY_AUTH_SCOPE", "missing console CSRF token");
    const expected = Buffer.from(context.csrfHash, "hex");
    const actual = Buffer.from(sha256Hex(provided), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new PayError("PAY_AUTH_SCOPE", "invalid console CSRF token");
    }
  }

  async linkedPubkey(apiKeyId: string): Promise<string | null> {
    const identity = await this.identities.findActiveByApiKey(apiKeyId);
    return identity?.pubkey ?? null;
  }

  async logout(sessionId: string): Promise<void> {
    const now = this.now();
    await this.sessions.revoke(sessionId, now);
  }
}
