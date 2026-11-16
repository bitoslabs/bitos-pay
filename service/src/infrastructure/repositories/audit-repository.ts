import type { AuditLogEntry } from "../../domain/types.ts";
import type { DbClient } from "../db/database.ts";
import { BaseRepository } from "./base-repository.ts";
import { toIso } from "./rows.ts";

export class AuditRepository extends BaseRepository {
  async insert(
    input: {
      id: string;
      organizationId: string;
      actorRef: string;
      action: string;
      targetRef: string;
      result: string;
      now: Date;
    },
    client: DbClient = this.db
  ): Promise<void> {
    await client.query(
      `INSERT INTO ${this.t("audit_logs")}
        (id, organization_id, actor_ref, action, target_ref, result, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.id,
        input.organizationId,
        input.actorRef,
        input.action,
        input.targetRef,
        input.result,
        input.now.toISOString()
      ]
    );
  }

  async listByOrganization(
    organizationId: string,
    options: { limit: number; actionPrefix?: string; targetRef?: string }
  ): Promise<AuditLogEntry[]> {
    const params: unknown[] = [organizationId];
    let where = "organization_id = $1";
    if (options.actionPrefix) {
      params.push(`${options.actionPrefix}%`);
      where += ` AND action LIKE $${params.length}`;
    }
    if (options.targetRef) {
      params.push(options.targetRef);
      where += ` AND target_ref = $${params.length}`;
    }
    params.push(options.limit);
    const result = await this.db.query<{
      id: string;
      organization_id: string;
      actor_ref: string;
      action: string;
      target_ref: string;
      result: string;
      occurred_at: Date | string;
    }>(
      `SELECT id, organization_id, actor_ref, action, target_ref, result, occurred_at
         FROM ${this.t("audit_logs")}
        WHERE ${where}
        ORDER BY occurred_at DESC, id DESC
        LIMIT $${params.length}`,
      params
    );
    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      actorRef: row.actor_ref,
      action: row.action,
      targetRef: row.target_ref,
      result: row.result,
      occurredAt: toIso(row.occurred_at)
    }));
  }
}
