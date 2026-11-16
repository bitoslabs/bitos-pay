export type DbRow = Record<string, unknown>;

export interface DbResult<Row = DbRow> {
  rows: Row[];
  rowCount: number | null;
}

export interface DbClient {
  query<Row = DbRow>(sql: string, params?: unknown[]): Promise<DbResult<Row>>;
  exec(sql: string): Promise<void>;
}

export interface Db extends DbClient {
  transaction<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function schemaName(raw: string | undefined): string {
  const schema = raw?.trim() || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error("PAY_DB_SCHEMA must match /^[a-z_][a-z0-9_]*$/");
  }
  return schema;
}
