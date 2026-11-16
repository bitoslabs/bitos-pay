import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "../dependencies.ts";
import { registerApiKeyRoutes } from "./api-keys.ts";
import { registerBalanceRoutes } from "./balances.ts";
import { registerConsoleRoutes } from "./console.ts";
import { registerCheckoutRoutes } from "./checkout.ts";
import { registerHealthRoutes } from "./health.ts";
import { registerInvoiceRoutes } from "./invoices.ts";
import { registerLocationRoutes } from "./locations.ts";
import { registerMerchantRoutes } from "./merchants.ts";
import { registerOnboardingRoutes } from "./onboarding.ts";
import { registerOpenApiRoute } from "./openapi.ts";
import { registerPaymentIntentRoutes } from "./payment-intents.ts";
import { registerPaymentLinkRoutes } from "./payment-links.ts";
import { registerPublicPaymentLinkRoutes } from "./public-payment-links.ts";
import { registerPlanRoutes } from "./plans.ts";
import { registerProviderRoutes } from "./providers.ts";
import { registerQuoteRoutes } from "./quotes.ts";
import { registerRefundRoutes } from "./refunds.ts";
import { registerSandboxRoutes } from "./sandbox.ts";
import { registerSettlementRoutes } from "./settlements.ts";
import { registerTransactionRoutes } from "./transactions.ts";
import { registerWebhookRoutes } from "./webhooks.ts";

export async function registerRoutes(
  app: FastifyInstance,
  deps: AppDependencies
): Promise<void> {
  await registerHealthRoutes(app, deps);
  await registerConsoleRoutes(app, deps);
  await registerCheckoutRoutes(app, deps);
  await registerOnboardingRoutes(app, deps);
  await registerOpenApiRoute(app);
  await registerPaymentIntentRoutes(app, deps);
  await registerPaymentLinkRoutes(app, deps);
  await registerPublicPaymentLinkRoutes(app, deps);
  await registerPlanRoutes(app, deps);
  await registerInvoiceRoutes(app, deps);
  await registerTransactionRoutes(app, deps);
  await registerBalanceRoutes(app, deps);
  await registerMerchantRoutes(app, deps);
  await registerLocationRoutes(app, deps);
  await registerWebhookRoutes(app, deps);
  await registerApiKeyRoutes(app, deps);
  await registerQuoteRoutes(app, deps);
  await registerRefundRoutes(app, deps);
  await registerSettlementRoutes(app, deps);
  await registerSandboxRoutes(app, deps);
  await registerProviderRoutes(app, deps);
}
