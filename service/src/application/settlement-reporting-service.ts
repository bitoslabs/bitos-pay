import { PayError, newId } from "../domain/index.ts";
import type { AuthContext, SettlementRecord, SettlementSummary } from "../domain/types.ts";
import type {
  AuditRepository,
  SettlementRepository
} from "../infrastructure/repositories/index.ts";
import type { AuthService } from "./auth-service.ts";

export class SettlementReportingService {
  private readonly reports: SettlementRepository;
  private readonly audit: AuditRepository;
  private readonly auth: AuthService;
  private readonly now: () => Date;

  constructor(
    reports: SettlementRepository,
    audit: AuditRepository,
    auth: AuthService,
    now: () => Date = () => new Date()
  ) {
    this.reports = reports;
    this.audit = audit;
    this.auth = auth;
    this.now = now;
  }

  async summary(auth: AuthContext, from: Date, to: Date): Promise<SettlementSummary> {
    this.auth.requireScope(auth, "payments:read");
    return this.compute(auth, from, to);
  }

  async get(auth: AuthContext, settlementId: string): Promise<SettlementSummary> {
    this.auth.requireScope(auth, "payments:read");
    const record = await this.reports.get(auth.merchantId, settlementId);
    if (!record) throw new PayError("PAY_NOT_FOUND_SETTLEMENT");
    return record;
  }

  async list(auth: AuthContext, limit = 20): Promise<SettlementRecord[]> {
    this.auth.requireScope(auth, "payments:read");
    return this.reports.list(auth.merchantId, Math.min(Math.max(1, limit), 100));
  }

  async reconcile(auth: AuthContext, from: Date, to: Date): Promise<SettlementRecord> {
    this.auth.requireScope(auth, "payments:write");
    const summary = await this.compute(auth, from, to);
    const id = newId("stl");
    const now = this.now();
    const result: SettlementRecord = { ...summary, id, createdAt: now.toISOString() };
    await this.reports.create(
      {
        ...result,
        organizationId: auth.organizationId,
        merchantId: auth.merchantId
      },
      now
    );
    await this.audit.insert({
      id: newId("aud"),
      organizationId: auth.organizationId,
      actorRef: `api_key:${auth.apiKeyId}`,
      action: "settlement.reconcile",
      targetRef: id,
      result: summary.ledgerBalanced ? "ACCEPTED" : "REVIEW",
      now
    });
    return result;
  }

  private async compute(auth: AuthContext, from: Date, to: Date): Promise<SettlementSummary> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new PayError("PAY_VALIDATION_BODY", "period_start and period_end must be ISO dates");
    }
    if (from.getTime() >= to.getTime()) {
      throw new PayError("PAY_VALIDATION_BODY", "period_end must be after period_start");
    }
    const summary = await this.reports.summarize(auth.merchantId, from, to);
    return {
      id: null,
      ...summary,
      status: summary.ledgerBalanced ? "COMPLETED" : "PENDING"
    };
  }
}
