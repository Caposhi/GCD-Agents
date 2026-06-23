/**
 * Minimal forward-only migration runner. Applies every *.sql file in
 * state/migrations in lexical order, tracking applied files in a _migrations
 * table. Idempotent: already-applied files are skipped.
 *
 * Usage: npm run build && npm run migrate   (requires DATABASE_URL)
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../harness/config.js";

async function main(): Promise<void> {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not set — cannot run migrations.");
  }
  const pg: any = await import("pg");
  const pool = new pg.Pool({ connectionString: config.databaseUrl });

  const dir = resolve(process.cwd(), "state/migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  for (const file of files) {
    const { rows } = await pool.query(`SELECT 1 FROM _migrations WHERE name = $1`, [file]);
    if (rows.length > 0) {
      console.log(`[migrate] skip ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(resolve(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  await pool.end();
  console.log("[migrate] done");
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
