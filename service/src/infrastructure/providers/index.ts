import type { PayConfig } from "../../config.ts";
import type { LightningProvider } from "../../application/ports/lightning-provider.ts";
import { BlinkLightningProvider } from "./blink-lightning-provider.ts";
import { LnbitsLightningProvider } from "./lnbits-lightning-provider.ts";
import { MockLightningProvider } from "./mock-lightning-provider.ts";
import { StrikeLightningProvider } from "./strike-lightning-provider.ts";

export interface LightningProviders {
  sandbox: LightningProvider;
  live: LightningProvider | null;
}

export function createLightningProviders(
  config: PayConfig,
  fetchImpl: typeof fetch = globalThis.fetch
): LightningProviders {
  const sandbox = new MockLightningProvider();
  if (config.lightningProvider === "mock") {
    return { sandbox, live: null };
  }
  if (config.lightningProvider === "lnbits") {
    if (!config.lnbitsUrl || !config.lnbitsApiKey) {
      throw new Error("live LNbits configuration is incomplete");
    }
    return {
      sandbox,
      live: new LnbitsLightningProvider({
        baseUrl: config.lnbitsUrl,
        apiKey: config.lnbitsApiKey,
        fetchImpl
      })
    };
  }
  if (config.lightningProvider === "blink") {
    if (!config.blinkApiKey || !config.blinkWalletId) {
      throw new Error("live Blink configuration is incomplete");
    }
    return {
      sandbox,
      live: new BlinkLightningProvider({
        baseUrl: config.blinkApiUrl ?? "https://api.blink.sv/graphql",
        apiKey: config.blinkApiKey,
        walletId: config.blinkWalletId,
        fetchImpl
      })
    };
  }
  if (config.lightningProvider !== "strike") {
    throw new Error("unsupported live Lightning provider");
  }
  if (!config.strikeApiKey) {
    throw new Error("live Strike configuration is incomplete");
  }
  return {
    sandbox,
    live: new StrikeLightningProvider({
      baseUrl: config.strikeApiUrl ?? "https://api.strike.me/v1",
      apiKey: config.strikeApiKey,
      fetchImpl
    })
  };
}
