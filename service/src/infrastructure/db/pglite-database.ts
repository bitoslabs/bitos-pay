import type { PGlite } from "@electric-sql/pglite";
import type { Db, DbClient, DbResult, DbRow } from "./database.ts";

export class PGliteDatabase implements Db {
  private db: PGlite;

  constructor(db: PGlite) {
    this.db = db;
  }

  async query<Row = DbRow>(sql: string, params: unknown[] = []): Promise<DbResult<Row>> {
    const result = await this.db.query<Row>(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    await this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      await this.db.exec("COMMIT");
      return result;
    } catch (error) {
      await this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
