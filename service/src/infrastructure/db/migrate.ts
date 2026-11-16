import { readFileSync, readdirSync } from "node:fs";
import type { Db } from "./database.ts";

const MIGRATIONS = readdirSync(new URL("../../../migrations/", import.meta.url))
  .filter((file) => file.endsWith(".sql"))
  .sort();

export async function migrate(
  db: Db,
  schema: string
): Promise<{ applied: string[]; skipped: string[] }> {
  await db.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await db.exec(
    `CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (` +
      `id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  );
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of MIGRATIONS) {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM ${schema}.schema_migrations WHERE id = $1`,
      [file]
    );
    if (existing.rows.length > 0) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), "utf8")
      .replaceAll("{{schema}}", schema);
    await db.transaction(async (client) => {
      await client.exec(sql);
      await client.query(`INSERT INTO ${schema}.schema_migrations (id) VALUES ($1)`, [file]);
    });
    applied.push(file);
  }
  return { applied, skipped };
}
