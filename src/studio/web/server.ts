/**
 * The Studio web service's lifecycle (docs/CONTENT_STUDIO_DESIGN.md §3.2, §3.3,
 * §7). `main.ts` decides the environment first, then loads this.
 *
 * 1. **Connect, then check the database before anything else:** it must be the
 *    migrated Studio database (`current_database()` is `gcd_studio`, the
 *    tripwire, the ledger and the `studio_database_identity` row) and its schema
 *    version must be exactly the one this code expects — the worker's check.
 *    Either refusal stops the service before it listens or writes anything.
 * 2. **Listen**, with bounded request and header timeouts, and emit one
 *    structured ready line.
 * 3. **Purge** at start and every ten minutes (design §4.1, §4.7, §7.3): login
 *    attempts 1 day after they expire, sessions 30 days after they expire or
 *    are revoked.
 */

import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";

import { probeStudioIdentity, readStudioMigrationFiles, STUDIO_MIGRATIONS_DIRECTORY } from "../db/runner.js";
import { createStudioWebApp, STUDIO_WEB_SERVICE, type WebLog } from "./app.js";
import { decideWebIdentity, decideWebSchemaVersion, type WebStartup } from "./startup.js";
import { PgWebStore } from "./store.js";

export const PURGE_INTERVAL_MS = 10 * 60 * 1000;

export interface StudioWebHandle {
  readonly server: Server;
  stop(): Promise<void>;
}

export async function startStudioWeb(startup: WebStartup, options: { repoRoot: string; log: WebLog; host?: string }): Promise<StudioWebHandle> {
  const pool = new pg.Pool({
    connectionString: startup.connectionString, application_name: STUDIO_WEB_SERVICE, max: 5, connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (error) => options.log("db.pool_error", { error_class: (error as Error)?.name ?? "Error" }));
  try {
    // 1. the database, before anything is written
    const client = await pool.connect();
    let schemaVersion: string;
    try {
      const probe = await probeStudioIdentity(client);
      decideWebIdentity(probe);
      const files = await readStudioMigrationFiles(resolve(options.repoRoot, STUDIO_MIGRATIONS_DIRECTORY));
      schemaVersion = decideWebSchemaVersion(probe.ledger, files);
    } finally {
      client.release();
    }

    // 2. listen
    const app = createStudioWebApp({ store: new PgWebStore(pool, pool), config: startup.config, commit: startup.commit, log: options.log });
    const server = createServer((req, res) => { void app.handle(req, res); });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    await new Promise<void>((settle, fail) => {
      server.once("error", fail);
      server.listen(startup.port, options.host ?? "0.0.0.0", () => { server.off("error", fail); settle(); });
    });
    options.log("ready", { service: STUDIO_WEB_SERVICE, commit: startup.commit, state: "postgres", schema_version: schemaVersion });

    // 3. purges
    const purge = () => app.purge().catch((error) => options.log("purge.failed", { error_class: (error as Error)?.name ?? "Error" }));
    await purge();
    const timer = setInterval(() => { void purge(); }, PURGE_INTERVAL_MS);
    timer.unref();

    return {
      server,
      async stop() {
        clearInterval(timer);
        await new Promise<void>((settle) => server.close(() => settle()));
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
