/**
 * `npm run studio:migrate`: applies `studio/migrations/*.sql` to the Content
 * Studio database (docs/CONTENT_STUDIO_DESIGN.md §3.7). In production it runs
 * only as `gcd-studio-web`'s pre-deploy command (S8), never on a live service.
 *
 * It reads exactly two things from its environment: the value of
 * `STUDIO_DATABASE_URL`, and whether `DATABASE_URL` is present at all, which
 * is refused before any connection is made. Everything else is `runner.ts`.
 *
 * Usage: npm run build && npm run studio:migrate   (requires STUDIO_DATABASE_URL)
 */

import { resolve } from "node:path";
import pg from "pg";
import {
  resolveStudioDatabaseUrl,
  runStudioMigrations,
  STUDIO_MIGRATIONS_DIRECTORY,
  StudioMigrationRefusal,
} from "./runner.js";

async function main(): Promise<void> {
  const connectionString = resolveStudioDatabaseUrl({
    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL,
    databaseUrlPresent: process.env.DATABASE_URL !== undefined,
  });
  const client = new pg.Client({
    connectionString,
    application_name: "gcd-studio-migrate",
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await runStudioMigrations(client, {
      directory: resolve(process.cwd(), STUDIO_MIGRATIONS_DIRECTORY),
      log: (line) => console.log(line),
    });
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  // The message only: never an error object, which could carry connection details.
  if (error instanceof StudioMigrationRefusal) {
    console.error(`[studio-migrate] refused (${error.reason}): ${error.message}`);
  } else {
    console.error(`[studio-migrate] fatal: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
