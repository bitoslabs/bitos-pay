import type { DbClient } from "../db/database.ts";
import { BaseRepository } from "./base-repository.ts";
import { toJsonArray } from "./rows.ts";

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
}
