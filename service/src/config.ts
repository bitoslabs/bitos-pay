import { schemaName } from "./infrastructure/db/database.ts";

export type LightningProviderName = "mock" | "lnbits" | "blink" | "strike";
export type ConsoleMode = "sandbox" | "live";
export type ConsoleModeSetting = ConsoleMode | "both";

export interface PayConfig {
  databaseUrl: string;
  schema: string;
  host: string;
  port: number;
  publicBaseUrl: string;
  invoiceTtlSeconds: number;
  defaultFeeBps: number;
  riskMaxPaymentMsat: number;
  riskDailyVolumeMsat: number;
  riskMaxPaymentsPerMinute: number;
  secretKey: string;
  lightningProvider: LightningProviderName;
  liveEnabled: boolean;
  lnbitsUrl: string | null;
  lnbitsApiKey: string | null;
  lnbitsWebhookSecret: string | null;
  blinkApiUrl: string | null;
  blinkApiKey: string | null;
  blinkWalletId: string | null;
  blinkWebhookSecret: string | null;
  strikeApiUrl: string | null;
  strikeApiKey: string | null;
  strikeWebhookSecret: string | null;
  sandboxEnabled: boolean;
  sandboxToken: string | null;
  webhookMaxAttempts: number;
  webhookTimeoutMs: number;
  webhookRotationGraceSeconds: number;
  webhookAllowPrivate: boolean;
  workerIntervalMs: number;
  autoMigrate: boolean;
  consoleEnabled: boolean;
  consoleMode: ConsoleModeSetting;
  consoleCookieSecure: boolean;
  consoleSessionTtlSeconds: number;
  consoleNsecEnabled: boolean;
  consoleNostrRelay: string | null;
  onboardingEnabled: boolean;
  onboardingMaxPerHour: number;
  paymentLinkRateLimit: number;
  corsOrigins: string[];
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function providerEnv(): LightningProviderName {
  const raw = (process.env.PAY_LIGHTNING_PROVIDER ?? "mock").trim().toLowerCase();
  if (raw === "mock" || raw === "lnbits" || raw === "blink" || raw === "strike") {
    return raw;
  }
  throw new Error("PAY_LIGHTNING_PROVIDER must be mock, lnbits, blink or strike");
}

function consoleModeEnv(): ConsoleModeSetting {
  const raw = (process.env.PAY_CONSOLE_MODE ?? "sandbox").trim().toLowerCase();
  if (raw === "sandbox" || raw === "live" || raw === "both") return raw;
  throw new Error("PAY_CONSOLE_MODE must be sandbox, live or both");
}

function httpUrlEnv(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain credentials`);
  }
  return url.toString().replace(/\/$/, "");
}

function secretEnv(name: string, minLength = 16): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  if (raw.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters`);
  }
  return raw;
}

function valueEnv(name: string, minLength = 1): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  if (raw.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters`);
  }
  return raw;
}

function websocketUrlEnv(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a ws:// or wss:// URL`);
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`${name} must be a ws:// or wss:// URL`);
  }
  return url.toString().replace(/\/$/, "");
}

function corsOriginsEnv(): string[] {
  const raw = process.env.PAY_CORS_ORIGINS;
  if (!raw) return [];
  return [...new Set(raw.split(",").map((item) => item.trim()).filter(Boolean))].map((item) => {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new Error("PAY_CORS_ORIGINS entries must be absolute origins");
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("PAY_CORS_ORIGINS entries must be origins without paths");
    }
    return url.origin;
  });
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "1" || raw.toLowerCase() === "true") return true;
  if (raw === "0" || raw.toLowerCase() === "false") return false;
  throw new Error(`${name} must be 1/0 or true/false`);
}

export function loadConfig(overrides: Partial<PayConfig> = {}): PayConfig {
  const databaseUrl = overrides.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const secretKey = overrides.secretKey ?? process.env.PAY_SECRET_KEY;
  if (!secretKey) throw new Error("PAY_SECRET_KEY is required");
  const lightningProvider = overrides.lightningProvider ?? providerEnv();
  const liveEnabled = overrides.liveEnabled ?? booleanEnv("PAY_LIVE_ENABLED", false);
  const lnbitsUrl = overrides.lnbitsUrl ?? httpUrlEnv("PAY_LNBITS_URL");
  const lnbitsApiKey = overrides.lnbitsApiKey ?? secretEnv("PAY_LNBITS_API_KEY", 8);
  const lnbitsWebhookSecret =
    overrides.lnbitsWebhookSecret ?? secretEnv("PAY_LNBITS_WEBHOOK_SECRET", 16);
  const blinkApiUrl = overrides.blinkApiUrl ?? httpUrlEnv("PAY_BLINK_API_URL");
  const blinkApiKey = overrides.blinkApiKey ?? secretEnv("PAY_BLINK_API_KEY", 8);
  const blinkWalletId = overrides.blinkWalletId ?? valueEnv("PAY_BLINK_WALLET_ID", 1);
  const blinkWebhookSecret =
    overrides.blinkWebhookSecret ?? secretEnv("PAY_BLINK_WEBHOOK_SECRET", 16);
  const strikeApiUrl = overrides.strikeApiUrl ?? httpUrlEnv("PAY_STRIKE_API_URL");
  const strikeApiKey = overrides.strikeApiKey ?? secretEnv("PAY_STRIKE_API_KEY", 8);
  const strikeWebhookSecret =
    overrides.strikeWebhookSecret ?? secretEnv("PAY_STRIKE_WEBHOOK_SECRET", 10);
  if (lightningProvider === "mock" && liveEnabled) {
    throw new Error("PAY_LIVE_ENABLED requires a non-mock PAY_LIGHTNING_PROVIDER");
  }
  if (lightningProvider === "lnbits") {
    if (!liveEnabled) {
      throw new Error("PAY_LIGHTNING_PROVIDER=lnbits requires PAY_LIVE_ENABLED=1");
    }
    if (!lnbitsUrl || !lnbitsApiKey || !lnbitsWebhookSecret) {
      throw new Error(
        "PAY_LNBITS_URL, PAY_LNBITS_API_KEY and PAY_LNBITS_WEBHOOK_SECRET are required for live"
      );
    }
  }
  if (lightningProvider === "blink") {
    if (!liveEnabled) {
      throw new Error("PAY_LIGHTNING_PROVIDER=blink requires PAY_LIVE_ENABLED=1");
    }
    if (!blinkApiKey || !blinkWalletId || !blinkWebhookSecret) {
      throw new Error(
        "PAY_BLINK_API_KEY, PAY_BLINK_WALLET_ID and PAY_BLINK_WEBHOOK_SECRET are required for live"
      );
    }
  }
  if (lightningProvider === "strike") {
    if (!liveEnabled) {
      throw new Error("PAY_LIGHTNING_PROVIDER=strike requires PAY_LIVE_ENABLED=1");
    }
    if (!strikeApiKey || !strikeWebhookSecret) {
      throw new Error(
        "PAY_STRIKE_API_KEY and PAY_STRIKE_WEBHOOK_SECRET are required for live"
      );
    }
  }
  const consoleMode = overrides.consoleMode ?? consoleModeEnv();
  if (consoleMode !== "sandbox" && !liveEnabled) {
    throw new Error("PAY_CONSOLE_MODE=live or both requires PAY_LIVE_ENABLED=1");
  }
  const sandboxEnabled = overrides.sandboxEnabled ?? booleanEnv("PAY_SANDBOX_ENABLED", false);
  const sandboxToken = overrides.sandboxToken ?? (process.env.PAY_SANDBOX_TOKEN || null);
  if (sandboxEnabled && !sandboxToken) {
    throw new Error("PAY_SANDBOX_TOKEN is required when PAY_SANDBOX_ENABLED is on");
  }
  return {
    databaseUrl,
    schema: overrides.schema ?? schemaName(process.env.PAY_DB_SCHEMA),
    host: overrides.host ?? process.env.PAY_HOST ?? "127.0.0.1",
    port: overrides.port ?? integerEnv("PAY_PORT", 8788, 0, 65535),
    publicBaseUrl: overrides.publicBaseUrl ?? process.env.PAY_PUBLIC_BASE_URL ?? "http://127.0.0.1:8788",
    invoiceTtlSeconds:
      overrides.invoiceTtlSeconds ?? integerEnv("PAY_INVOICE_TTL_SECONDS", 900, 30, 86400),
    defaultFeeBps: overrides.defaultFeeBps ?? integerEnv("PAY_FEE_BPS", 0, 0, 10000),
    riskMaxPaymentMsat:
      overrides.riskMaxPaymentMsat ??
      integerEnv("PAY_RISK_MAX_PAYMENT_MSAT", 100_000_000, 1, Number.MAX_SAFE_INTEGER),
    riskDailyVolumeMsat:
      overrides.riskDailyVolumeMsat ??
      integerEnv("PAY_RISK_DAILY_VOLUME_MSAT", 1_000_000_000, 1, Number.MAX_SAFE_INTEGER),
    riskMaxPaymentsPerMinute:
      overrides.riskMaxPaymentsPerMinute ??
      integerEnv("PAY_RISK_MAX_PAYMENTS_PER_MINUTE", 60, 1, 100_000),
    secretKey,
    lightningProvider,
    liveEnabled,
    lnbitsUrl,
    lnbitsApiKey,
    lnbitsWebhookSecret,
    blinkApiUrl,
    blinkApiKey,
    blinkWalletId,
    blinkWebhookSecret,
    strikeApiUrl,
    strikeApiKey,
    strikeWebhookSecret,
    sandboxEnabled,
    sandboxToken: sandboxToken ?? null,
    webhookMaxAttempts:
      overrides.webhookMaxAttempts ?? integerEnv("PAY_WEBHOOK_MAX_ATTEMPTS", 8, 1, 32),
    webhookTimeoutMs:
      overrides.webhookTimeoutMs ?? integerEnv("PAY_WEBHOOK_TIMEOUT_MS", 5000, 250, 60000),
    webhookRotationGraceSeconds:
      overrides.webhookRotationGraceSeconds ??
      integerEnv("PAY_WEBHOOK_ROTATION_GRACE_SECONDS", 86400, 60, 604800),
    webhookAllowPrivate:
      overrides.webhookAllowPrivate ?? booleanEnv("PAY_WEBHOOK_ALLOW_PRIVATE", true),
    workerIntervalMs:
      overrides.workerIntervalMs ?? integerEnv("PAY_WORKER_INTERVAL_MS", 5000, 1000, 300000),
    autoMigrate: overrides.autoMigrate ?? booleanEnv("PAY_AUTO_MIGRATE", false),
    consoleEnabled: overrides.consoleEnabled ?? booleanEnv("PAY_CONSOLE_ENABLED", true),
    consoleMode,
    consoleCookieSecure:
      overrides.consoleCookieSecure ?? booleanEnv("PAY_CONSOLE_COOKIE_SECURE", false),
    consoleSessionTtlSeconds:
      overrides.consoleSessionTtlSeconds ??
      integerEnv("PAY_CONSOLE_SESSION_TTL_SECONDS", 28800, 300, 604800),
    consoleNsecEnabled:
      overrides.consoleNsecEnabled ?? booleanEnv("PAY_CONSOLE_ALLOW_NSEC", false),
    consoleNostrRelay:
      overrides.consoleNostrRelay ?? websocketUrlEnv("PAY_CONSOLE_NOSTR_RELAY"),
    onboardingEnabled:
      overrides.onboardingEnabled ?? booleanEnv("PAY_ONBOARDING_ENABLED", false),
    onboardingMaxPerHour:
      overrides.onboardingMaxPerHour ??
      integerEnv("PAY_ONBOARDING_MAX_PER_HOUR", 5, 1, 1000),
    paymentLinkRateLimit:
      overrides.paymentLinkRateLimit ??
      integerEnv("PAY_PAYMENT_LINK_RATE_LIMIT", 20, 1, 1000),
    corsOrigins: overrides.corsOrigins ?? corsOriginsEnv()
  };
}
