import type { PayConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import type { Db } from "./infrastructure/db/database.ts";
import { migrate } from "./infrastructure/db/migrate.ts";
import { createDatabase } from "./infrastructure/db/create-database.ts";
import { createRepositories, type Repositories } from "./infrastructure/repositories/index.ts";
import { createLightningProviders } from "./infrastructure/providers/index.ts";
import { createSecretBox } from "./infrastructure/crypto/secret-box.ts";
import { ApiKeyService } from "./application/api-key-service.ts";
import { AuthService } from "./application/auth-service.ts";
import { CheckoutService } from "./application/checkout-service.ts";
import { ConsoleSessionService } from "./application/console-session-service.ts";
import { NostrAuthService } from "./application/nostr-auth-service.ts";
import { OnboardingService } from "./application/onboarding-service.ts";
import { EventPublisher } from "./application/event-publisher.ts";
import { ExpirationService } from "./application/expiration-service.ts";
import { ProvisioningService } from "./application/provisioning-service.ts";
import { PaymentIntentService } from "./application/payment-intent-service.ts";
import { PaymentLinkService } from "./application/payment-link-service.ts";
import { MerchantProfileService } from "./application/merchant-profile-service.ts";
import { MemberService } from "./application/member-service.ts";
import { PlanService } from "./application/plan-service.ts";
import { ProviderConnectionService } from "./application/provider-connection-service.ts";
import { SettlementService } from "./application/settlement-service.ts";
import { LedgerQueryService } from "./application/ledger-query-service.ts";
import { LocationService } from "./application/location-service.ts";
import { QuoteService } from "./application/quote-service.ts";
import { RefundService } from "./application/refund-service.ts";
import { RiskService } from "./application/risk-service.ts";
import { SettlementReportingService } from "./application/settlement-reporting-service.ts";
import { WebhookService } from "./application/webhook-service.ts";
import type { AppDependencies } from "./api/dependencies.ts";

export interface Services {
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

export interface Container {
  config: PayConfig;
  db: Db;
  repositories: Repositories;
  services: Services;
  dependencies: AppDependencies;
}

export interface ContainerOptions {
  config?: PayConfig;
  autoMigrate?: boolean;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const config = options.config ?? loadConfig();
  const db = await createDatabase(config.databaseUrl);
  if (options.autoMigrate ?? config.autoMigrate) {
    await migrate(db, config.schema);
  }
  const repositories = createRepositories(db, config.schema);
  const providers = createLightningProviders(config, options.fetchImpl ?? globalThis.fetch);
  const secrets = createSecretBox(config.secretKey);
  const now = options.now ?? (() => new Date());
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
  const expiration = new ExpirationService(
    repositories.payments,
    repositories.audit,
    events,
    now
  );
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
    now,
    options.fetchImpl ?? globalThis.fetch
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
    config,
    db,
    repositories,
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
    dependencies
  };
}
