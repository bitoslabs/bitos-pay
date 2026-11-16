import type { PayConfig } from "../config.ts";
import { schnorr } from "@noble/curves/secp256k1.js";
import {
  PayError,
  newId,
  randomToken,
  sha256Hex
} from "../domain/index.ts";
import type {
  AuditRepository,
  MerchantRepository,
  OnboardingChallengeRepository
} from "../infrastructure/repositories/index.ts";
import type { NostrEvent } from "./nostr-auth-service.ts";
import type { ProvisioningService, BootstrapResult } from "./provisioning-service.ts";

export interface SandboxOnboardingInput {
  organizationName: string;
  merchantName: string;
  country?: string;
}

export interface BnosWorkspaceInput extends SandboxOnboardingInput {
  workspaceId: string;
}

export interface BnosWorkspaceResult {
  organizationId: string;
  merchantId: string;
  providerConnectionId: string | null;
  apiKey: string | null;
  apiKeyId: string | null;
  livemode: boolean;
  ownerPubkey: string;
  subjectRef: string;
  created: boolean;
}

interface Window {
  count: number;
  resetAt: number;
}

const CHALLENGE_TTL_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 300;

function invalid(message = "invalid Nostr proof"): PayError {
  return new PayError("PAY_AUTH_INVALID", message);
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function eventId(event: NostrEvent): string {
  return sha256Hex(
    JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
  );
}

function singleTag(tags: string[][], name: string): string {
  const matches = tags.filter((tag) => tag[0] === name);
  if (matches.length !== 1 || typeof matches[0]?.[1] !== "string") {
    throw invalid(`missing or repeated ${name} tag`);
  }
  return matches[0][1]!;
}

function validEvent(event: unknown): asserts event is NostrEvent {
  if (!event || typeof event !== "object") throw invalid();
  const candidate = event as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !/^[0-9a-f]{64}$/.test(candidate.id)) throw invalid();
  if (typeof candidate.pubkey !== "string" || !/^[0-9a-f]{64}$/.test(candidate.pubkey)) {
    throw invalid();
  }
  if (!Number.isInteger(candidate.created_at)) throw invalid();
  if (candidate.kind !== 22242) throw invalid();
  if (candidate.content !== "") throw invalid();
  if (typeof candidate.sig !== "string" || !/^[0-9a-f]{128}$/.test(candidate.sig)) {
    throw invalid();
  }
  if (!Array.isArray(candidate.tags) || candidate.tags.length > 16) throw invalid();
  for (const tag of candidate.tags) {
    if (!Array.isArray(tag) || tag.length < 2 || tag.length > 4) throw invalid();
    if (!tag.every((part) => typeof part === "string")) throw invalid();
  }
}

export class OnboardingService {
  private readonly provisioning: ProvisioningService;
  private readonly merchants: MerchantRepository;
  private readonly audit: AuditRepository;
  private readonly challenges: OnboardingChallengeRepository;
  private readonly config: PayConfig;
  private readonly now: () => Date;
  private readonly origin: string;
  private readonly windows = new Map<string, Window>();

  constructor(
    provisioning: ProvisioningService,
    merchants: MerchantRepository,
    audit: AuditRepository,
    challenges: OnboardingChallengeRepository,
    config: PayConfig,
    now: () => Date = () => new Date()
  ) {
    this.provisioning = provisioning;
    this.merchants = merchants;
    this.audit = audit;
    this.challenges = challenges;
    this.config = config;
    this.now = now;
    this.origin = new URL(config.publicBaseUrl).origin;
  }

  async createChallenge(): Promise<{
    challenge: string;
    origin: string;
    expires_at: string;
  }> {
    if (!this.config.onboardingEnabled) throw new PayError("PAY_ONBOARDING_DISABLED");
    const now = this.now();
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000);
    const challenge = randomToken("och_", 32);
    await this.challenges.deleteExpired(now);
    await this.challenges.create({
      id: newId("och"),
      challengeHash: sha256Hex(challenge),
      now,
      expiresAt
    });
    return { challenge, origin: this.origin, expires_at: expiresAt.toISOString() };
  }

  async ensureConsoleIdentity(pubkey: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(pubkey)) return false;
    return (await this.provisioning.ensureConsoleIdentity(pubkey)) !== null;
  }

  async createWithNostr(
    input: SandboxOnboardingInput,
    event: NostrEvent,
    clientKey: string
  ): Promise<BootstrapResult & { owner_pubkey: string }> {
    if (!this.config.onboardingEnabled) throw new PayError("PAY_ONBOARDING_DISABLED");
    const pubkey = await this.verifyProof(event);
    const result = await this.createSandboxForPubkey(input, pubkey, clientKey);
    return { ...result, owner_pubkey: pubkey };
  }

  async createSandboxForPubkey(
    input: SandboxOnboardingInput,
    pubkey: string,
    clientKey: string
  ): Promise<BootstrapResult> {
    if (!this.config.onboardingEnabled) throw new PayError("PAY_ONBOARDING_DISABLED");
    if (!/^[0-9a-f]{64}$/.test(pubkey)) throw invalid("invalid Nostr public key");
    if (await this.provisioning.ensureConsoleIdentity(pubkey)) {
      throw new PayError(
        "PAY_SUBJECT_CONFLICT",
        "this Nostr key already belongs to a workspace; sign in instead"
      );
    }
    const now = this.now();
    this.consume(clientKey);
    const result = await this.provisioning.bootstrapMerchant({
      organizationName: input.organizationName,
      merchantName: input.merchantName,
      country: input.country,
      livemode: false,
      subjectRef: null,
      ownerPubkey: pubkey,
      consoleNostrPubkey: pubkey,
      createdVia: "nostr_onboarding"
    });
    await this.audit.insert({
      id: newId("aud"),
      organizationId: result.organizationId,
      actorRef: `nostr:${pubkey}`,
      action: "organization.nostr_create",
      targetRef: result.organizationId,
      result: "ACCEPTED",
      now
    });
    return result;
  }

  async syncBnosWorkspace(
    input: BnosWorkspaceInput,
    event: NostrEvent,
    clientKey: string
  ): Promise<BnosWorkspaceResult> {
    if (!this.config.onboardingEnabled) throw new PayError("PAY_ONBOARDING_DISABLED");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(input.workspaceId)) {
      throw invalid("BNOS workspace id is not a supported reference");
    }
    const now = this.now();
    const subjectRef = `bnos:${input.workspaceId}`;
    const pubkey = await this.verifyProof(event, subjectRef);
    this.consume(clientKey);
    const existing = await this.merchants.findBySubjectRef(subjectRef);
    if (existing) {
      if (existing.ownerPubkey !== pubkey) {
        throw new PayError("PAY_SUBJECT_CONFLICT");
      }
      if (existing.merchantStatus !== "ACTIVE") {
        throw new PayError("PAY_RISK_MERCHANT_STATUS");
      }
      await this.provisioning.ensureConsoleIdentity(pubkey, now);
      await this.merchants.renameWorkspace(
        existing.organizationId,
        existing.merchantId,
        input.organizationName,
        input.merchantName,
        now
      );
      await this.audit.insert({
        id: newId("aud"),
        organizationId: existing.organizationId,
        actorRef: `nostr:${pubkey}`,
        action: "organization.bnos_sync",
        targetRef: existing.organizationId,
        result: "ACCEPTED",
        now
      });
      return {
        organizationId: existing.organizationId,
        merchantId: existing.merchantId,
        providerConnectionId: null,
        apiKey: null,
        apiKeyId: null,
        livemode: false,
        ownerPubkey: pubkey,
        subjectRef,
        created: false
      };
    }
    const result = await this.provisioning.bootstrapMerchant({
      organizationName: input.organizationName,
      merchantName: input.merchantName,
      country: input.country,
      livemode: false,
      subjectRef,
      ownerPubkey: pubkey,
      consoleNostrPubkey: pubkey,
      createdVia: "bnos_sync"
    });
    await this.audit.insert({
      id: newId("aud"),
      organizationId: result.organizationId,
      actorRef: `nostr:${pubkey}`,
      action: "organization.bnos_sync",
      targetRef: result.organizationId,
      result: "ACCEPTED",
      now
    });
    return {
      ...result,
      ownerPubkey: pubkey,
      subjectRef,
      created: true
    };
  }

  async createSandbox(input: SandboxOnboardingInput, clientKey: string): Promise<BootstrapResult> {
    if (!this.config.onboardingEnabled) {
      throw new PayError("PAY_ONBOARDING_DISABLED");
    }
    this.consume(clientKey);
    const result = await this.provisioning.bootstrapMerchant({
      organizationName: input.organizationName,
      merchantName: input.merchantName,
      country: input.country,
      livemode: false,
      subjectRef: null,
      createdVia: "sandbox_onboarding"
    });
    await this.audit.insert({
      id: newId("aud"),
      organizationId: result.organizationId,
      actorRef: `onboarding:${clientKey}`,
      action: "organization.sandbox_create",
      targetRef: result.organizationId,
      result: "ACCEPTED",
      now: this.now()
    });
    return result;
  }

  private async verifyProof(event: NostrEvent, subjectRef?: string): Promise<string> {
    validEvent(event);
    const now = this.now();
    if (Math.abs(Math.floor(now.getTime() / 1000) - event.created_at) > CLOCK_SKEW_SECONDS) {
      throw invalid("Nostr proof is outside the allowed time window");
    }
    if (singleTag(event.tags, "relay") !== this.origin) {
      throw invalid("Nostr proof relay does not match this service");
    }
    if (subjectRef && singleTag(event.tags, "subject") !== subjectRef) {
      throw invalid("Nostr proof does not bind this workspace");
    }
    const challenge = singleTag(event.tags, "challenge");
    if (eventId(event) !== event.id) throw invalid("Nostr event id does not match");
    let verified = false;
    try {
      verified = schnorr.verify(hexBytes(event.sig), hexBytes(event.id), hexBytes(event.pubkey));
    } catch {
      verified = false;
    }
    if (!verified) throw invalid("Nostr signature is invalid");
    const consumed = await this.challenges.consume(sha256Hex(challenge), now);
    if (!consumed) throw invalid("Nostr challenge is unknown, expired or already used");
    return event.pubkey;
  }

  private consume(clientKey: string): void {
    const now = this.now().getTime();
    const current = this.windows.get(clientKey);
    if (!current || current.resetAt <= now) {
      this.windows.set(clientKey, { count: 1, resetAt: now + 60 * 60 * 1000 });
      return;
    }
    if (current.count >= this.config.onboardingMaxPerHour) {
      throw new PayError("PAY_RATE_LIMITED", "sandbox onboarding rate limit exceeded");
    }
    current.count += 1;
  }
}
