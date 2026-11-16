import type { Db } from "../db/database.ts";
import { AuditRepository } from "./audit-repository.ts";
import { ConsoleChallengeRepository } from "./console-nostr-challenge-repository.ts";
import { ConsoleNostrIdentityRepository } from "./console-nostr-identity-repository.ts";
import { ConsoleSessionRepository } from "./console-session-repository.ts";
import { LedgerRepository } from "./ledger-repository.ts";
import { LocationRepository } from "./location-repository.ts";
import { MerchantRepository } from "./merchant-repository.ts";
import { OnboardingChallengeRepository } from "./onboarding-challenge-repository.ts";
import { PaymentLinkRepository } from "./payment-link-repository.ts";
import { PaymentRepository } from "./payment-repository.ts";
import { PlanRepository } from "./plan-repository.ts";
import { QuoteRepository } from "./quote-repository.ts";
import { RefundRepository } from "./refund-repository.ts";
import { SettlementRepository } from "./settlement-repository.ts";
import { WebhookRepository } from "./webhook-repository.ts";

export interface Repositories {
  merchants: MerchantRepository;
  locations: LocationRepository;
  payments: PaymentRepository;
  paymentLinks: PaymentLinkRepository;
  plans: PlanRepository;
  onboardingChallenges: OnboardingChallengeRepository;
  ledger: LedgerRepository;
  webhooks: WebhookRepository;
  quotes: QuoteRepository;
  refunds: RefundRepository;
  settlementReports: SettlementRepository;
  audit: AuditRepository;
  consoleSessions: ConsoleSessionRepository;
  consoleNostrIdentities: ConsoleNostrIdentityRepository;
  consoleChallenges: ConsoleChallengeRepository;
}

export function createRepositories(db: Db, schema: string): Repositories {
  return {
    merchants: new MerchantRepository(db, schema),
    locations: new LocationRepository(db, schema),
    payments: new PaymentRepository(db, schema),
    paymentLinks: new PaymentLinkRepository(db, schema),
    plans: new PlanRepository(db, schema),
    onboardingChallenges: new OnboardingChallengeRepository(db, schema),
    ledger: new LedgerRepository(db, schema),
    webhooks: new WebhookRepository(db, schema),
    quotes: new QuoteRepository(db, schema),
    refunds: new RefundRepository(db, schema),
    settlementReports: new SettlementRepository(db, schema),
    audit: new AuditRepository(db, schema),
    consoleSessions: new ConsoleSessionRepository(db, schema),
    consoleNostrIdentities: new ConsoleNostrIdentityRepository(db, schema),
    consoleChallenges: new ConsoleChallengeRepository(db, schema)
  };
}

export { AuditRepository } from "./audit-repository.ts";
export { ConsoleChallengeRepository } from "./console-nostr-challenge-repository.ts";
export { ConsoleNostrIdentityRepository } from "./console-nostr-identity-repository.ts";
export type { ConsoleNostrIdentity } from "./console-nostr-identity-repository.ts";
export { ConsoleSessionRepository } from "./console-session-repository.ts";
export { LedgerRepository } from "./ledger-repository.ts";
export { MerchantRepository } from "./merchant-repository.ts";
export { LocationRepository } from "./location-repository.ts";
export { OnboardingChallengeRepository } from "./onboarding-challenge-repository.ts";
export { PaymentLinkRepository } from "./payment-link-repository.ts";
export { PaymentRepository } from "./payment-repository.ts";
export { PlanRepository } from "./plan-repository.ts";
export type { Entitlement, Plan, Subscription } from "./plan-repository.ts";
export { WebhookRepository } from "./webhook-repository.ts";
export { QuoteRepository } from "./quote-repository.ts";
export { RefundRepository } from "./refund-repository.ts";
export { SettlementRepository } from "./settlement-repository.ts";
