import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Db } from "./database.ts";
import { PgDatabase } from "./pg-database.ts";
import { PGliteDatabase } from "./pglite-database.ts";

export async function createDatabase(databaseUrl: string): Promise<Db> {
  if (!databaseUrl.startsWith("pglite://")) {
    return new PgDatabase(databaseUrl);
  }
  const target = databaseUrl.slice("pglite://".length);
  const { PGlite } = await import("@electric-sql/pglite");
  let pg;
  if (target && target !== "memory") {
    await mkdir(dirname(target), { recursive: true });
    pg = new PGlite(target);
  } else {
    pg = new PGlite();
  }
  await pg.waitReady;
  return new PGliteDatabase(pg);
}
