import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.ts";
import { migrate } from "../infrastructure/db/migrate.ts";
import { createDatabase } from "../infrastructure/db/create-database.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await createDatabase(config.databaseUrl);
  try {
    const result = await migrate(db, config.schema);
    console.log(JSON.stringify({ schema: config.schema, ...result }));
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
