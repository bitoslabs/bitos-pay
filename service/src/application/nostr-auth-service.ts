import { schnorr } from "@noble/curves/secp256k1.js";
import { PayError, newId, randomToken, sha256Hex } from "../domain/index.ts";
import type { AuthContext } from "../domain/types.ts";
import type { PayConfig } from "../config.ts";
import type {
  AuditRepository,
  ConsoleChallengeRepository,
  ConsoleNostrIdentity,
  ConsoleNostrIdentityRepository,
  MerchantRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";
import type { ConsoleContext } from "./console-session-service.ts";

const CHALLENGE_TTL_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 300;
const KIND_NOSTR_AUTH = 22242;

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface NostrChallenge {
  challenge: string;
  origin: string;
  expires_at: string;
}

function invalid(message = "invalid Nostr proof"): PayError {
  return new PayError("PAY_AUTH_INVALID", message);
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function eventId(event: NostrEvent): string {
  return sha256Hex(
    JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content
    ])
  );
}

function singleTag(tags: string[][], name: string): string {
  const matches = tags.filter((tag) => tag[0] === name);
  if (matches.length !== 1 || typeof matches[0]?.[1] !== "string") {
    throw invalid(`missing or repeated ${name} tag`);
  }
  return matches[0][1]!;
}

function validEventShape(event: unknown): asserts event is NostrEvent {
  if (!event || typeof event !== "object") throw invalid();
  const candidate = event as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !/^[0-9a-f]{64}$/.test(candidate.id)) {
    throw invalid();
  }
  if (typeof candidate.pubkey !== "string" || !/^[0-9a-f]{64}$/.test(candidate.pubkey)) {
    throw invalid();
  }
  if (!Number.isInteger(candidate.created_at)) throw invalid();
  if (candidate.kind !== KIND_NOSTR_AUTH) throw invalid();
  if (typeof candidate.content !== "string" || candidate.content !== "") throw invalid();
  if (typeof candidate.sig !== "string" || !/^[0-9a-f]{128}$/.test(candidate.sig)) {
    throw invalid();
  }
  if (!Array.isArray(candidate.tags) || candidate.tags.length > 16) throw invalid();
  for (const tag of candidate.tags) {
    if (!Array.isArray(tag) || tag.length < 2 || tag.length > 4) throw invalid();
    if (!tag.every((part) => typeof part === "string")) throw invalid();
  }
}

export class NostrAuthService {
  private readonly challenges: ConsoleChallengeRepository;
  private readonly identities: ConsoleNostrIdentityRepository;
  private readonly merchants: MerchantRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly origin: string;
  private readonly now: () => Date;

  constructor(
    challenges: ConsoleChallengeRepository,
    identities: ConsoleNostrIdentityRepository,
    merchants: MerchantRepository,
    audit: AuditRepository,
    auth: AuthService,
    config: Pick<PayConfig, "publicBaseUrl">,
    now: () => Date = () => new Date()
  ) {
    this.challenges = challenges;
    this.identities = identities;
    this.merchants = merchants;
    this.audit = audit;
    this.auth = auth;
    this.origin = new URL(config.publicBaseUrl).origin;
    this.now = now;
  }

  async createLoginChallenge(): Promise<NostrChallenge> {
    return this.createChallenge("LOGIN", null, null);
  }

  async createLinkChallenge(context: ConsoleContext): Promise<NostrChallenge> {
    this.auth.requireScope(context.auth, "keys:write");
    if (context.authMethod !== "api_key") {
      throw new PayError("PAY_AUTH_SCOPE", "link a Nostr key from an API-key session");
    }
    return this.createChallenge("LINK", context.auth.merchantId, context.sessionId);
  }

  async verifyLogin(
    event: NostrEvent
  ): Promise<{ pubkey: string; identity: ConsoleNostrIdentity | null }> {
    const pubkey = await this.verifyChallenge(event, "LOGIN", null);
    const identity = await this.identities.findActiveByPubkey(pubkey);
    if (!identity) {
      const revoked = await this.identities.findByPubkey(pubkey);
      if (revoked) throw new PayError("PAY_AUTH_REVOKED", "this Nostr key was revoked");
    }
    return { pubkey, identity };
  }

  async login(event: NostrEvent): Promise<ConsoleNostrIdentity> {
    const { identity } = await this.verifyLogin(event);
    if (!identity) {
      throw invalid("this Nostr key is not linked to a merchant");
    }
    return identity;
  }

  async link(context: ConsoleContext, event: NostrEvent): Promise<ConsoleNostrIdentity> {
    const pubkey = await this.verifyChallenge(event, "LINK", context);
    const existing = await this.identities.findByPubkey(pubkey);
    if (existing) {
      if (
        existing.status === "ACTIVE" &&
        existing.merchantId === context.auth.merchantId &&
        existing.apiKeyId === context.auth.apiKeyId
      ) {
        await this.identities.touch(existing.id, this.now());
        return existing;
      }
      throw new PayError("PAY_AUTH_SCOPE", "Nostr key is already linked");
    }

    const now = this.now();
    const identity = await this.identities.create({
      id: newId("nid"),
      merchantId: context.auth.merchantId,
      organizationId: context.auth.organizationId,
      apiKeyId: context.auth.apiKeyId,
      pubkey,
      now
    });
    await this.audit.insert({
      id: newId("aud"),
      organizationId: context.auth.organizationId,
      actorRef: `api_key:${context.auth.apiKeyId}`,
      action: "console.nostr.link",
      targetRef: identity.id,
      result: "ACCEPTED",
      now
    });
    return identity;
  }

  private async createChallenge(
    purpose: "LOGIN" | "LINK",
    merchantId: string | null,
    sessionId: string | null
  ): Promise<NostrChallenge> {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000);
    const challenge = randomToken("nch_", 32);
    await this.challenges.deleteExpired(now);
    await this.challenges.create({
      id: newId("chl"),
      challengeHash: sha256Hex(challenge),
      purpose,
      merchantId,
      sessionId,
      now,
      expiresAt
    });
    return {
      challenge,
      origin: this.origin,
      expires_at: expiresAt.toISOString()
    };
  }

  private async verifyChallenge(
    event: NostrEvent,
    purpose: "LOGIN" | "LINK",
    context: ConsoleContext | null
  ): Promise<string> {
    validEventShape(event);
    const now = this.now();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (Math.abs(nowSeconds - event.created_at) > CLOCK_SKEW_SECONDS) {
      throw invalid("Nostr proof is outside the allowed time window");
    }
    const challenge = singleTag(event.tags, "challenge");
    if (singleTag(event.tags, "relay") !== this.origin) {
      throw invalid("Nostr proof relay does not match this console");
    }
    const stored = await this.challenges.findActive(sha256Hex(challenge), purpose, now);
    if (!stored) throw invalid("Nostr challenge is unknown or expired");
    if (
      context &&
      (stored.merchantId !== context.auth.merchantId || stored.sessionId !== context.sessionId)
    ) {
      throw invalid("Nostr challenge is not bound to this session");
    }

    if (eventId(event) !== event.id) throw invalid("Nostr event id does not match");
    let verified = false;
    try {
      verified = schnorr.verify(
        hexBytes(event.sig),
        hexBytes(event.id),
        hexBytes(event.pubkey)
      );
    } catch {
      verified = false;
    }
    if (!verified) throw invalid("Nostr signature is invalid");

    const consumed = await this.challenges.consume(
      sha256Hex(challenge),
      purpose,
      context ? context.auth.merchantId : null,
      context ? context.sessionId : null,
      now
    );
    if (!consumed) throw invalid("Nostr challenge was already used");
    return event.pubkey;
  }
}
