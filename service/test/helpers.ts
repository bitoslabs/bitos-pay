import { PGlite } from "@electric-sql/pglite";
import type { PayConfig } from "../src/config.ts";
import type { AppDependencies } from "../src/api/dependencies.ts";
import { ApiKeyService } from "../src/application/api-key-service.ts";
import { AuthService } from "../src/application/auth-service.ts";
import { CheckoutService } from "../src/application/checkout-service.ts";
import { ConsoleSessionService } from "../src/application/console-session-service.ts";
import { NostrAuthService } from "../src/application/nostr-auth-service.ts";
import { OnboardingService } from "../src/application/onboarding-service.ts";
import { EventPublisher } from "../src/application/event-publisher.ts";
import { ExpirationService } from "../src/application/expiration-service.ts";
import { LedgerQueryService } from "../src/application/ledger-query-service.ts";
import { LocationService } from "../src/application/location-service.ts";
import { PaymentIntentService } from "../src/application/payment-intent-service.ts";
import { PaymentLinkService } from "../src/application/payment-link-service.ts";
import { MerchantProfileService } from "../src/application/merchant-profile-service.ts";
import { MemberService } from "../src/application/member-service.ts";
import { PlanService } from "../src/application/plan-service.ts";
import { ProviderConnectionService } from "../src/application/provider-connection-service.ts";
import { QuoteService } from "../src/application/quote-service.ts";
import { RefundService } from "../src/application/refund-service.ts";
import { RiskService } from "../src/application/risk-service.ts";
import { SettlementReportingService } from "../src/application/settlement-reporting-service.ts";
import { ProvisioningService } from "../src/application/provisioning-service.ts";
import { SettlementService } from "../src/application/settlement-service.ts";
import { WebhookService } from "../src/application/webhook-service.ts";
import { createSecretBox } from "../src/infrastructure/crypto/secret-box.ts";
import { migrate } from "../src/infrastructure/db/migrate.ts";
import { PGliteDatabase } from "../src/infrastructure/db/pglite-database.ts";
import { MockLightningProvider } from "../src/infrastructure/providers/mock-lightning-provider.ts";
import type { LightningProviders } from "../src/infrastructure/providers/index.ts";
import type { LightningProvider } from "../src/application/ports/lightning-provider.ts";
import {
  createRepositories,
  type Repositories
} from "../src/infrastructure/repositories/index.ts";

export function testConfig(overrides: Partial<PayConfig> = {}): PayConfig {
  return {
    databaseUrl: "pglite://memory",
    schema: "public",
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "http://127.0.0.1",
    invoiceTtlSeconds: 900,
    defaultFeeBps: 0,
    riskMaxPaymentMsat: 100_000_000,
    riskDailyVolumeMsat: 1_000_000_000,
    riskMaxPaymentsPerMinute: 60,
    secretKey: Buffer.alloc(32, 7).toString("base64"),
    lightningProvider: "mock",
    liveEnabled: false,
    lnbitsUrl: null,
    lnbitsApiKey: null,
    lnbitsWebhookSecret: null,
    blinkApiUrl: null,
    blinkApiKey: null,
    blinkWalletId: null,
    blinkWebhookSecret: null,
    strikeApiUrl: null,
    strikeApiKey: null,
    strikeWebhookSecret: null,
    sandboxEnabled: true,
    sandboxToken: "sandbox-test-token",
    webhookMaxAttempts: 4,
    webhookTimeoutMs: 1000,
    webhookRotationGraceSeconds: 3600,
    webhookAllowPrivate: true,
    workerIntervalMs: 5000,
    autoMigrate: false,
    consoleEnabled: true,
    consoleMode: "sandbox",
    consoleCookieSecure: false,
    consoleSessionTtlSeconds: 28800,
    consoleNsecEnabled: false,
    consoleNostrRelay: null,
    onboardingEnabled: false,
    onboardingMaxPerHour: 5,
    paymentLinkRateLimit: 20,
    corsOrigins: [],
    ...overrides
  };
}

export interface TestServices {
  auth: AuthService;
  consoleSessions: ConsoleSessionService;
  nostrAuth: NostrAuthService;
  onboarding: OnboardingService;
  provisioning: ProvisioningService;
  paymentIntents: PaymentIntentService;
  locations: LocationService;
  paymentLinks: PaymentLinkService;
  merchantProfiles: MerchantProfileService;
  members: MemberService;
  checkout: CheckoutService;
  plans: PlanService;
  providerConnections: ProviderConnectionService;
  settlements: SettlementService;
  ledgerQuery: LedgerQueryService;
  webhooks: WebhookService;
  expiration: ExpirationService;
  apiKeys: ApiKeyService;
  quotes: QuoteService;
  refunds: RefundService;
  risk: RiskService;
  settlementReports: SettlementReportingService;
}

export interface TestRuntime {
  db: PGliteDatabase;
  repositories: Repositories;
  provider: MockLightningProvider;
  services: TestServices;
  dependencies: AppDependencies;
  config: PayConfig;
  close: () => Promise<void>;
}

export async function createTestRuntime(
  overrides: Partial<PayConfig> = {},
  options: { liveProvider?: LightningProvider } = {}
): Promise<TestRuntime> {
  const pg = new PGlite();
  await pg.waitReady;
  const db = new PGliteDatabase(pg);
  const config = testConfig(overrides);
  await migrate(db, config.schema);
  const repositories = createRepositories(db, config.schema);
  const provider = new MockLightningProvider();
  const providers: LightningProviders = {
    sandbox: provider,
    live: options.liveProvider ?? null
  };
  const secrets = createSecretBox(config.secretKey);
  const now = () => new Date();
  const events = new EventPublisher(repositories.webhooks);
  const auth = new AuthService(repositories.merchants, now);
  const consoleSessions = new ConsoleSessionService(
    repositories.consoleSessions,
    repositories.consoleNostrIdentities,
    repositories.merchants,
    repositories.audit,
    auth,
    config.consoleSessionTtlSeconds,
    config.consoleMode === "both" ? ["sandbox", "live"] : [config.consoleMode],
    now
  );
  const nostrAuth = new NostrAuthService(
    repositories.consoleChallenges,
    repositories.consoleNostrIdentities,
    repositories.merchants,
    repositories.audit,
    auth,
    config,
    now
  );
  const risk = new RiskService(repositories.merchants, repositories.payments, now);
  const merchantProfiles = new MerchantProfileService(
    repositories.merchants,
    repositories.audit,
    auth,
    now
  );
  const expiration = new ExpirationService(repositories.payments, repositories.audit, events, now);
  const provisioning = new ProvisioningService(
    repositories.merchants,
    repositories.consoleNostrIdentities,
    providers,
    config,
    now
  );
  const onboarding = new OnboardingService(provisioning, repositories.merchants, repositories.audit, repositories.onboardingChallenges, config, now);
  const checkout = new CheckoutService(
    repositories.payments,
    repositories.merchants,
    config,
    now,
    () => expiration.expireDueIntents()
  );
  const paymentIntents = new PaymentIntentService(
    repositories.payments,
    repositories.merchants,
    repositories.locations,
    repositories.audit,
    events,
    providers,
    auth,
    risk,
    checkout,
    config,
    now,
    () => expiration.expireDueIntents()
  );
  const paymentLinks = new PaymentLinkService(
    repositories.payments,
    repositories.paymentLinks,
    repositories.merchants,
    repositories.audit,
    auth,
    paymentIntents,
    config,
    now
  );
  const plans = new PlanService(
    repositories.plans,
    repositories.audit,
    auth,
    providers.sandbox,
    now
  );
  const settlements = new SettlementService(
    repositories.payments,
    repositories.merchants,
    repositories.ledger,
    repositories.audit,
    events,
    providers,
    now
  );
  const ledgerQuery = new LedgerQueryService(repositories.payments, repositories.ledger, auth);
  const providerConnections = new ProviderConnectionService(repositories.merchants, auth);
  const webhooks = new WebhookService(
    repositories.payments,
    repositories.webhooks,
    repositories.audit,
    auth,
    secrets,
    config,
    now
  );
  const apiKeys = new ApiKeyService(repositories.merchants, repositories.audit, auth, now);
  const quotes = new QuoteService(repositories.quotes, auth, now);
  const refunds = new RefundService(
    repositories.payments,
    repositories.refunds,
    repositories.ledger,
    repositories.audit,
    events,
    auth,
    now
  );
  const settlementReports = new SettlementReportingService(
    repositories.settlementReports,
    repositories.audit,
    auth,
    now
  );
  const members = new MemberService(
    repositories.consoleNostrIdentities,
    repositories.merchants,
    repositories.audit,
    auth,
    now
  );
  const locations = new LocationService(repositories.locations, repositories.audit, auth, now);
  const dependencies: AppDependencies = {
    config,
    auth,
    consoleSessions,
    nostrAuth,
    onboarding,
    paymentIntents,
    locations,
    paymentLinks,
    merchantProfiles,
    members,
    checkout,
    plans,
    providerConnections,
    settlements,
    ledgerQuery,
    webhooks,
    apiKeys,
    quotes,
    refunds,
    risk,
    settlementReports,
    ready: () => repositories.payments.ready(),
    sandboxEnabled: config.sandboxEnabled,
    sandboxToken: config.sandboxToken
  };
  return {
    db,
    repositories,
    provider,
    services: {
      auth,
      consoleSessions,
      nostrAuth,
      onboarding,
      provisioning,
      paymentIntents,
      locations,
      paymentLinks,
      merchantProfiles,
      members,
      checkout,
      plans,
      providerConnections,
      settlements,
      ledgerQuery,
      webhooks,
      expiration,
      apiKeys,
      quotes,
      refunds,
      risk,
      settlementReports
    },
    dependencies,
    config,
    close: async () => {
      await db.close();
    }
  };
}

export async function seedMerchant(
  runtime: TestRuntime,
  options: {
    feeBps?: number;
    organizationName?: string;
    merchantName?: string;
    livemode?: boolean;
  } = {}
): Promise<{
  organizationId: string;
  merchantId: string;
  providerConnectionId: string;
  apiKey: string;
  auth: Awaited<ReturnType<AuthService["authenticate"]>>;
}> {
  const seeded = await runtime.services.provisioning.bootstrapMerchant({
    organizationName: options.organizationName ?? "Test Organization",
    merchantName: options.merchantName ?? "Test Merchant",
    feeBps: options.feeBps ?? 0,
    livemode: options.livemode ?? false
  });
  const auth = await runtime.services.auth.authenticate(`Bearer ${seeded.apiKey}`);
  return { ...seeded, auth };
}

export function intentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount: 1000,
    currency: "SAT",
    scale: 0,
    payment_method: "lightning",
    external_reference: "ORDER-001",
    metadata: { source: "test" },
    ...overrides
  };
}
