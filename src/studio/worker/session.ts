/**
 * The worker's one database session and its ownership lock
 * (docs/CONTENT_STUDIO_DESIGN.md §5.3).
 *
 * Everything the worker does goes through ONE connection: the session-level
 * advisory lock that makes it the single consumer is held on it, every job is
 * claimed on it, and every write of every run is made on it. So a claim, an
 * artifact or a request row cannot commit after ownership is lost: losing the
 * connection loses the lock and every later statement with it. Statements and
 * transactions are serialized here, because the critic panel's four lens rows
 * complete concurrently.
 */

import { createHash } from "node:crypto";
import pg from "pg";

/** The Studio-only ownership key's namespace. A different key, in a different database, from every live lock. */
export const STUDIO_WORKER_OWNERSHIP_NAMESPACE = "gcd-studio:worker-ownership:v1";
/** The live worker's ownership key (docs/DATA_MODEL.md). The Studio key must never equal it. */
export const LIVE_WORKER_OWNERSHIP_KEY = [1889446263, 889784911] as const;

/** The two signed 32-bit halves of the Studio key: the first eight bytes of sha256(namespace). */
export function studioOwnershipKey(): [number, number] {
  const digest = createHash("sha256").update(STUDIO_WORKER_OWNERSHIP_NAMESPACE).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

type Client = Pick<pg.Client, "query">;

export class WorkerSession {
  private tail: Promise<unknown> = Promise.resolve();
  private broken: Error | undefined;

  constructor(readonly client: pg.Client) {
    client.on("error", (error) => { this.broken ??= error; });
    client.on("end", () => { this.broken ??= new Error("the worker's database session ended"); });
  }

  /** Why the session can no longer be used, if it cannot. */
  get lost(): Error | undefined {
    return this.broken;
  }

  /** Runs `fn` alone on the session, after everything queued before it. */
  run<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const next = this.tail.then(() => {
      if (this.broken) throw this.broken;
      return fn(this.client);
    });
    this.tail = next.catch(() => undefined);
    return next;
  }

  query(text: string, values?: unknown[]) {
    return this.run((client) => client.query(text, values));
  }

  /** One transaction, alone on the session; rolled back on any error. `fn` must use the client it is given. */
  tx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    return this.run(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  }
}

/** Takes the session-level ownership lock without waiting. True when this session now holds it. */
export async function tryAcquireOwnership(session: WorkerSession): Promise<boolean> {
  const [a, b] = studioOwnershipKey();
  return (await session.query("SELECT pg_try_advisory_lock($1, $2) AS held", [a, b])).rows[0]?.held === true;
}

/** Whether THIS backend holds the ownership lock. Asked inside every claim transaction. */
export async function holdsOwnership(client: Client): Promise<boolean> {
  const [a, b] = studioOwnershipKey();
  const result = await client.query(
    `SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
        AND classid = ($1::bigint & 4294967295)::oid AND objid = ($2::bigint & 4294967295)::oid AND objsubid = 2) AS held`,
    [a, b]);
  return result.rows[0]?.held === true;
}
