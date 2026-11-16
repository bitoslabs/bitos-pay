import { API_KEY_SCOPES, PayError, newId, randomToken, sha256Hex } from "../domain/index.ts";
import type {
  AuthContext,
  MerchantMember,
  MerchantMemberRole
} from "../domain/types.ts";
import type {
  AuditRepository,
  ConsoleNostrIdentity,
  ConsoleNostrIdentityRepository,
  MerchantRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export type InviteMemberRole = Exclude<MerchantMemberRole, "OWNER">;

export interface InviteMemberInput {
  pubkey: string;
  role: InviteMemberRole;
  label?: string | null;
}

const ROLE_SCOPES: Record<InviteMemberRole, string[]> = {
  ADMIN: [...API_KEY_SCOPES],
  MANAGER: [
    "payments:read",
    "payments:write",
    "payments:refund",
    "webhooks:read",
    "webhooks:write",
    "merchants:write",
    "quotes:read"
  ],
  CASHIER: ["payments:read", "payments:write"],
  VIEWER: ["payments:read"]
};

const ROLES = new Set<string>(Object.keys(ROLE_SCOPES));

function presentIdentity(identity: ConsoleNostrIdentity): MerchantMember {
  return {
    id: identity.id,
    pubkey: identity.pubkey,
    role: identity.role,
    label: identity.label,
    status: identity.status,
    lastSeenAt: identity.lastSeenAt,
    createdAt: identity.createdAt
  };
}

export class MemberService {
  private readonly identities: ConsoleNostrIdentityRepository;
  private readonly merchants: MerchantRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly now: () => Date;

  constructor(
    identities: ConsoleNostrIdentityRepository,
    merchants: MerchantRepository,
    audit: AuditRepository,
    auth: AuthService,
    now: () => Date = () => new Date()
  ) {
    this.identities = identities;
    this.merchants = merchants;
    this.audit = audit;
    this.auth = auth;
    this.now = now;
  }

  async list(auth: AuthContext): Promise<MerchantMember[]> {
    this.auth.requireScope(auth, "keys:read");
    const identities = await this.identities.listByMerchant(auth.merchantId);
    return identities.map(presentIdentity);
  }

  async invite(auth: AuthContext, input: InviteMemberInput): Promise<MerchantMember> {
    this.auth.requireScope(auth, "keys:write");
    const pubkey = input.pubkey.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey)) {
      throw new PayError("PAY_VALIDATION_BODY", "pubkey must be 64 lowercase hex characters");
    }
    if (!ROLES.has(input.role)) {
      throw new PayError("PAY_VALIDATION_BODY", "unsupported member role");
    }
    const label = input.label?.trim() || null;
    if (label && label.length > 80) {
      throw new PayError("PAY_VALIDATION_BODY", "member label is too long");
    }
    if (await this.identities.findByPubkey(pubkey)) {
      throw new PayError("PAY_STATE_ILLEGAL", "this Nostr key is already a member");
    }

    const now = this.now();
    const keyId = newId("key");
    const identityId = newId("nid");
    const secret = randomToken("bp_test_", 32);
    const scopes = ROLE_SCOPES[input.role];
    let identity: ConsoleNostrIdentity | null = null;

    await this.merchants.db.transaction(async (client) => {
      await this.merchants.createApiKey(
        {
          id: keyId,
          merchantId: auth.merchantId,
          keyPrefix: secret.slice(0, 20),
          keyHash: sha256Hex(secret),
          scopes,
          livemode: false,
          kind: "member",
          now
        },
        client
      );
      identity = await this.identities.create(
        {
          id: identityId,
          merchantId: auth.merchantId,
          organizationId: auth.organizationId,
          apiKeyId: keyId,
          pubkey,
          role: input.role,
          label,
          now
        },
        client
      );
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "member.invite",
          targetRef: identityId,
          result: "ACCEPTED",
          now
        },
        client
      );
    });

    if (!identity) throw new PayError("PAY_STATE_ILLEGAL", "member was not created");
    return presentIdentity(identity);
  }

  async revoke(auth: AuthContext, identityId: string): Promise<MerchantMember> {
    this.auth.requireScope(auth, "keys:write");
    const identity = await this.identities.getForMerchant(auth.merchantId, identityId);
    if (!identity) throw new PayError("PAY_NOT_FOUND_MEMBER");
    if (identity.role === "OWNER") {
      throw new PayError("PAY_STATE_ILLEGAL", "the owner identity cannot be revoked");
    }
    const now = this.now();
    await this.merchants.db.transaction(async (client) => {
      await this.merchants.revokeApiKey(auth.merchantId, identity.apiKeyId, client);
      await this.identities.revoke(identity.id, auth.merchantId, now);
      await this.audit.insert(
        {
          id: newId("aud"),
          organizationId: auth.organizationId,
          actorRef: `api_key:${auth.apiKeyId}`,
          action: "member.revoke",
          targetRef: identity.id,
          result: "ACCEPTED",
          now
        },
        client
      );
    });
    const revoked = await this.identities.getForMerchant(auth.merchantId, identityId);
    return presentIdentity(revoked ?? { ...identity, status: "REVOKED" });
  }
}
