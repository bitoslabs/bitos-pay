import type { AuthContext, ProviderConnectionSummary } from "../domain/types.ts";
import type { MerchantRepository } from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export interface RoutedProviderConnection {
  connection: ProviderConnectionSummary;
  selected: boolean;
}

export class ProviderConnectionService {
  private readonly merchants: MerchantRepository;
  private readonly auth: AuthService;

  constructor(merchants: MerchantRepository, auth: AuthService) {
    this.merchants = merchants;
    this.auth = auth;
  }

  async list(auth: AuthContext): Promise<RoutedProviderConnection[]> {
    this.auth.requireScope(auth, "payments:read");
    const connections = await this.merchants.listProviderConnections(auth.organizationId);
    const activeMode = auth.livemode ? "live" : "sandbox";
    let selected = false;
    return connections.map((connection) => {
      const routed =
        !selected &&
        connection.mode === activeMode &&
        connection.status === "ACTIVE";
      if (routed) selected = true;
      return { connection, selected: routed };
    });
  }
}
