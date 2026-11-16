import type { Db } from "../db/database.ts";

export class BaseRepository {
  readonly db: Db;
  readonly schema: string;

  constructor(db: Db, schema: string) {
    this.db = db;
    this.schema = schema;
  }

  protected t(table: string): string {
    return `${this.schema}.${table}`;
  }

  async ready(): Promise<boolean> {
    try {
      await this.db.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
