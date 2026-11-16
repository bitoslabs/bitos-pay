import pg from "pg";
import type { Db, DbClient, DbResult, DbRow } from "./database.ts";

export class PgDatabase implements Db {
  private pool: pg.Pool;

  constructor(connectionString: string, max = 10) {
    this.pool = new pg.Pool({ connectionString, max });
  }

  async query<Row = DbRow>(sql: string, params: unknown[] = []): Promise<DbResult<Row>> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const dbClient: DbClient = {
      query: async <Row = DbRow>(sql: string, params: unknown[] = []): Promise<DbResult<Row>> => {
        const result = await client.query(sql, params);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
      },
      exec: async (sql: string): Promise<void> => {
        await client.query(sql);
      }
    };
    try {
      await client.query("BEGIN");
      const result = await fn(dbClient);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
