import { PayError, newId } from "../domain/index.ts";
import type { AuthContext, MerchantLocation } from "../domain/types.ts";
import type { AuditRepository, LocationRepository } from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export interface CreateLocationInput {
  name: string;
  code: string;
}

export interface UpdateLocationInput {
  name?: string;
  active?: boolean;
}

export class LocationService {
  private readonly locations: LocationRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly now: () => Date;

  constructor(
    locations: LocationRepository,
    audit: AuditRepository,
    auth: AuthService,
    now: () => Date = () => new Date()
  ) {
    this.locations = locations;
    this.audit = audit;
    this.auth = auth;
    this.now = now;
  }

  async list(auth: AuthContext): Promise<MerchantLocation[]> {
    this.auth.requireScope(auth, "payments:read");
    return this.locations.list(auth.merchantId);
  }

  async create(auth: AuthContext, input: CreateLocationInput): Promise<MerchantLocation> {
    this.auth.requireScope(auth, "merchants:write");
    const name = input.name.trim();
    const code = input.code.trim().toUpperCase();
    if (name.length < 1 || name.length > 120) {
      throw new PayError("PAY_VALIDATION_BODY", "location name must be 1-120 characters");
    }
    if (!/^[A-Z0-9_-]{2,24}$/.test(code)) {
      throw new PayError("PAY_VALIDATION_BODY", "location code must be 2-24 letters, digits, _ or -");
    }
    if (await this.locations.findByCode(auth.merchantId, code)) {
      throw new PayError("PAY_STATE_ILLEGAL", "location code already exists");
    }
    const now = this.now();
    const location = await this.locations.create({
      id: newId("loc"),
      organizationId: auth.organizationId,
      merchantId: auth.merchantId,
      name,
      code,
      now
    });
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "location.create",
      targetRef: location.id,
      result: "ACCEPTED",
      now
    });
    return location;
  }

  async update(
    auth: AuthContext,
    locationId: string,
    input: UpdateLocationInput
  ): Promise<MerchantLocation> {
    this.auth.requireScope(auth, "merchants:write");
    if (input.name === undefined && input.active === undefined) {
      throw new PayError("PAY_VALIDATION_BODY", "provide name or active");
    }
    let name: string | null = null;
    if (input.name !== undefined) {
      name = input.name.trim();
      if (name.length < 1 || name.length > 120) {
        throw new PayError("PAY_VALIDATION_BODY", "location name must be 1-120 characters");
      }
    }
    if (input.active !== undefined && typeof input.active !== "boolean") {
      throw new PayError("PAY_VALIDATION_BODY", "active must be a boolean");
    }
    const now = this.now();
    const location = await this.locations.update(
      auth.merchantId,
      locationId,
      { name, active: input.active ?? null },
      now
    );
    if (!location) throw new PayError("PAY_NOT_FOUND_LOCATION");
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "location.update",
      targetRef: location.id,
      result: "ACCEPTED",
      now
    });
    return location;
  }

  async disable(auth: AuthContext, locationId: string): Promise<MerchantLocation> {
    this.auth.requireScope(auth, "merchants:write");
    const location = await this.locations.disable(auth.merchantId, locationId, this.now());
    if (!location) throw new PayError("PAY_NOT_FOUND_LOCATION");
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "location.disable",
      targetRef: location.id,
      result: "ACCEPTED",
      now: this.now()
    });
    return location;
  }
}
