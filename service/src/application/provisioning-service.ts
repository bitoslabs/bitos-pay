import type { PayConfig } from "../config.ts";
import {
  API_KEY_SCOPES,
  PayError,
  SAT_CURRENCY,
  newId,
  randomToken,
  sha256Hex
} from "../domain/index.ts";
import type { LightningProvider } from "./ports/lightning-provider.ts";
import type { LightningProviders } from "../infrastructure/providers/index.ts";
import type {
  ConsoleNostrIdentity,
  ConsoleNostrIdentityRepository,
  MerchantRepository
} from "../infrastructure/repositories/index.ts";

export interface BootstrapInput {
  organizationName: string;
  merchantName: string;
  country?: string;
  feeBps?: number;
  livemode?: boolean;
  subjectRef?: string | null;
  ownerPubkey?: string | null;
  consoleNostrPubkey?: string | null;
  createdVia?: string;
}

export interface BootstrapResult {
  organizationId: string;
  merchantId: string;
  providerConnectionId: string;
  apiKey: string;
  apiKeyId: string;
  livemode: boolean;
}

export class ProvisioningService {
  private readonly merchants: MerchantRepository;
  private readonly identities: ConsoleNostrIdentityRepository;
  private readonly providers: LightningProviders;
  private readonly config: PayConfig;
  private readonly now: () => Date;

  constructor(
    merchants: MerchantRepository,
    identities: ConsoleNostrIdentityRepository,
    providers: LightningProviders,
    config: PayConfig,
    now: () => Date = () => new Date()
  ) {
    this.merchants = merchants;
    this.identities = identities;
    this.providers = providers;
    this.config = config;
    this.now = now;
  }

  async ensureConsoleIdentity(
    pubkey: string,
    now: Date = this.now()
  ): Promise<ConsoleNostrIdentity | null> {
    const existing = await this.identities.findByPubkey(pubkey);
    if (existing) {
      if (existing.status !== "ACTIVE") {
        throw new PayError("PAY_AUTH_REVOKED", "this Nostr key was revoked");
      }
      return existing;
    }
    const owned = await this.merchants.findByOwnerPubkey(pubkey);
    if (!owned) return null;
    return this.identities.create({
      id: newId("nid"),
      merchantId: owned.merchantId,
      organizationId: owned.organizationId,
      apiKeyId: owned.apiKeyId,
      pubkey,
      now
    });
  }

  async bootstrapMerchant(input: BootstrapInput): Promise<BootstrapResult> {
    const now = this.now();
    const organizationId = newId("org");
    const merchantId = newId("mer");
    const providerConnectionId = newId("pc");
    const apiKeyId = newId("key");
    const livemode = input.livemode ?? false;
    const provider = livemode ? this.providers.live : this.providers.sandbox;
    if (!provider) {
      throw new PayError("PAY_PROVIDER_UNAVAILABLE", "live provider is not configured");
    }
    const apiKey = randomToken(livemode ? "bp_live_" : "bp_test_", 32);
    await this.merchants.db.transaction(async (client) => {
      await this.merchants.createOrganization(
        {
          id: organizationId,
          name: input.organizationName,
          country: input.country ?? "LA",
          subjectRef: input.subjectRef ?? null,
          ownerPubkey: input.ownerPubkey ?? null,
          createdVia: input.createdVia ?? "seed",
          now
        },
        client
      );
      await this.merchants.createMerchant(
        {
          id: merchantId,
          organizationId,
          name: input.merchantName,
          status: "ACTIVE",
          defaultCurrency: SAT_CURRENCY,
          feeBps: input.feeBps ?? this.config.defaultFeeBps,
          maxPaymentMsat: BigInt(this.config.riskMaxPaymentMsat),
          dailyVolumeMsat: BigInt(this.config.riskDailyVolumeMsat),
          maxPaymentsPerMinute: this.config.riskMaxPaymentsPerMinute,
          now
        },
        client
      );
      await this.merchants.createProviderConnection(
        {
          id: providerConnectionId,
          organizationId,
          provider: provider.name,
          mode: provider.mode === "live" ? "live" : "sandbox",
          status: "ACTIVE",
          now
        },
        client
      );
      await this.merchants.createApiKey(
        {
          id: apiKeyId,
          merchantId,
          keyPrefix: apiKey.slice(0, 20),
          keyHash: sha256Hex(apiKey),
          scopes: [...API_KEY_SCOPES],
          livemode,
          now
        },
        client
      );
      if (input.consoleNostrPubkey) {
        await this.identities.create(
          {
            id: newId("nid"),
            merchantId,
            organizationId,
            apiKeyId,
            pubkey: input.consoleNostrPubkey,
            now
          },
          client
        );
      }
    });
    return { organizationId, merchantId, providerConnectionId, apiKey, apiKeyId, livemode };
  }
}
