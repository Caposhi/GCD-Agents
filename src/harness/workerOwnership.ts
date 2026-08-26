/**
 * Exclusive worker ownership via a PostgreSQL session-level advisory lock.
 *
 * Render background-worker deploys are zero-downtime: the NEW instance starts
 * while the OLD instance is still alive and may still be executing a brief.
 * "My process just started" therefore does NOT mean "the running brief is
 * abandoned". Startup reconciliation must be gated on a real ownership
 * predicate instead.
 *
 * The lock is session-scoped, so PostgreSQL releases it automatically the
 * instant the owning session ends — clean exit, SIGKILL, OOM, or host loss are
 * all identical and need no TTL. That property is why an advisory lock beats a
 * durable lease table here: a lease row survives its holder and would need an
 * expiry, but a worker legitimately blocks in waitForApproval for up to 24h, so
 * no expiry can distinguish "crashed" from "waiting for a human".
 *
 * Ownership is held on a DEDICATED client, never through the shared Pool:
 * Pool.query() returns its connection to the pool afterwards, so a session lock
 * would sit on an untracked idle connection, could be silently released when the
 * pool reaps that connection, and could never be released deliberately (an
 * unlock issued from a different connection is a no-op).
 *
 * Ownership is a fence for external side effects, not merely a startup gate:
 * losing it must stop all new provider work immediately. See assertOwned().
 */

import { createHash } from "node:crypto";

type Client = import("pg").Client;

/**
 * Reviewed, hard-coded two-int32 advisory key.
 *
 *   sha256("gcd-social:worker-ownership:v1")
 *     = 709ea97735090a4fb3c3439f83c41fdb35d39ace2e8dfa3205cdd42a2ac49c1e
 *   k1 = int32 big-endian at byte 0 = 1889446263
 *   k2 = int32 big-endian at byte 4 =  889784911
 *
 * The constants are literals rather than a runtime hash so the exact key is
 * reviewable in the diff and cannot drift if the derivation changes.
 * ownershipKeyMatchesNamespace() re-derives them in tests.
 */
export const WORKER_OWNERSHIP_NAMESPACE = "gcd-social:worker-ownership:v1";
export const WORKER_OWNERSHIP_KEY_1 = 1_889_446_263;
export const WORKER_OWNERSHIP_KEY_2 = 889_784_911;

/** Proves the shipped literals still match the documented namespace. */
export function ownershipKeyMatchesNamespace(namespace = WORKER_OWNERSHIP_NAMESPACE): boolean {
  const digest = createHash("sha256").update(namespace).digest();
  return digest.readInt32BE(0) === WORKER_OWNERSHIP_KEY_1
    && digest.readInt32BE(4) === WORKER_OWNERSHIP_KEY_2;
}

const ACQUIRE_POLL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
/** Log while waiting so a blocked handover is visible in Render logs. */
const WAITING_LOG_INTERVAL_MS = 30_000;

export type OwnershipLostReason =
  | "connection_error"
  | "heartbeat_failed"
  | "released";

export interface OwnershipClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
  on(event: "error", listener: (err: Error) => void): unknown;
}

export interface WorkerOwnershipOptions {
  /** Creates and connects the dedicated session. Injected for tests. */
  connect: () => Promise<OwnershipClient>;
  /** Cooperative cancellation of the acquisition wait (startup shutdown). */
  signal?: AbortSignal;
  /** Called once, asynchronously, the first time ownership is lost. */
  onLost?: (reason: OwnershipLostReason, error?: Error) => void;
  acquirePollMs?: number;
  heartbeatIntervalMs?: number;
  waitingLogIntervalMs?: number;
  log?: (message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class OwnershipLostError extends Error {
  readonly reason: OwnershipLostReason;
  constructor(reason: OwnershipLostReason, message?: string) {
    super(message ?? `worker ownership lost (${reason})`);
    this.name = "OwnershipLostError";
    this.reason = reason;
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Exclusive ownership handle.
 *
 * Deliberately has no reconnect path. Reconnecting would re-acquire ownership
 * that another instance may legitimately hold by then, so a lost connection is
 * terminal for this process: mark lost, abort in-flight work, fail closed, and
 * let Render restart us into the normal acquisition path.
 */
export class WorkerOwnership {
  private client: OwnershipClient | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private lost = false;
  private lostReason: OwnershipLostReason | undefined;
  private readonly controller = new AbortController();
  private readonly onLost: ((reason: OwnershipLostReason, error?: Error) => void) | undefined;
  private readonly heartbeatIntervalMs: number;
  private readonly log: (message: string) => void;

  private constructor(
    client: OwnershipClient,
    onLost: ((reason: OwnershipLostReason, error?: Error) => void) | undefined,
    heartbeatIntervalMs: number,
    log: (message: string) => void,
  ) {
    this.client = client;
    this.onLost = onLost;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.log = log;
  }

  /**
   * Polls pg_try_advisory_lock until it succeeds. A single blocking
   * pg_advisory_lock is deliberately NOT used: the shared pool sets a 10s
   * query_timeout, and a blocking wait cannot be interrupted by shutdown.
   *
   * Waits indefinitely by design. The worker must never give up and start
   * consuming without ownership; bounding the handover is the deployment
   * controller's job, not the worker's.
   */
  static async acquire(options: WorkerOwnershipOptions): Promise<WorkerOwnership> {
    const log = options.log ?? ((message: string) => console.log(message));
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? (() => Date.now());
    const pollMs = options.acquirePollMs ?? ACQUIRE_POLL_MS;
    const waitingLogMs = options.waitingLogIntervalMs ?? WAITING_LOG_INTERVAL_MS;

    if (options.signal?.aborted) throw new Error("worker ownership acquisition aborted before start");

    const client = await options.connect();
    let connectionError: Error | undefined;
    client.on("error", (err) => {
      connectionError = err instanceof Error ? err : new Error(String(err));
    });

    const startedAt = now();
    let lastWaitingLog = startedAt;
    try {
      for (;;) {
        if (options.signal?.aborted) throw new Error("worker ownership acquisition aborted");
        if (connectionError) throw connectionError;

        const res = await client.query(
          "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
          [WORKER_OWNERSHIP_KEY_1, WORKER_OWNERSHIP_KEY_2],
        );
        if (res.rows[0]?.acquired === true) {
          const ownership = new WorkerOwnership(
            client,
            options.onLost,
            options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
            log,
          );
          log(`[worker] exclusive ownership acquired after ${now() - startedAt}ms`);
          return ownership;
        }

        if (now() - lastWaitingLog >= waitingLogMs) {
          lastWaitingLog = now();
          log(
            `[worker] waiting for exclusive worker ownership `
            + `(${Math.round((now() - startedAt) / 1000)}s) — not reconciling, not ready, not consuming`,
          );
        }
        await sleep(pollMs);
      }
    } catch (err) {
      await client.end().catch(() => {});
      throw err;
    }
  }

  /** Aborted the moment ownership is lost. Threaded into every side-effect path. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isOwner(): boolean {
    return !this.lost;
  }

  /**
   * The side-effect barrier. Call immediately before any new external or
   * durable side effect for a brief. A worker that no longer owns the lock is
   * not authorized to create approvals, call providers, or record new phase
   * state — only to run its coordinated shutdown path.
   */
  assertOwned(operation: string): void {
    if (this.lost) {
      throw new OwnershipLostError(
        this.lostReason ?? "connection_error",
        `BLOCKED: worker ownership lost — refusing ${operation}`,
      );
    }
  }

  /**
   * Periodic liveness probe on the dedicated session. Any error means the
   * session may be gone, which means PostgreSQL may already have released the
   * lock to another instance, so we must stop immediately.
   */
  startMonitoring(): void {
    if (this.heartbeat || this.lost) return;
    this.client?.on("error", (err) => this.markLost("connection_error", err));
    this.heartbeat = setInterval(() => {
      void (async () => {
        const client = this.client;
        if (!client || this.lost) return;
        try {
          const res = await client.query("SELECT 1 AS ok");
          if (res.rows[0]?.ok !== 1) {
            this.markLost("heartbeat_failed", new Error("ownership heartbeat returned no row"));
          }
        } catch (err) {
          this.markLost("heartbeat_failed", err instanceof Error ? err : new Error(String(err)));
        }
      })();
    }, this.heartbeatIntervalMs);
    // Never hold the event loop open for the heartbeat alone.
    (this.heartbeat as unknown as { unref?: () => void }).unref?.();
  }

  stopMonitoring(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private markLost(reason: OwnershipLostReason, error?: Error): void {
    if (this.lost) return;
    this.lost = true;
    this.lostReason = reason;
    this.stopMonitoring();
    this.controller.abort();
    this.log(`[worker] OWNERSHIP LOST (${reason}): ${error?.message ?? "no detail"} — failing closed`);
    try {
      this.onLost?.(reason, error);
    } catch {
      /* a listener failure must not mask ownership loss */
    }
  }

  /**
   * Releases ownership and closes the dedicated session. Called LAST during
   * shutdown so the lock is retained across all cleanup. Ending the session
   * would release the lock on its own; the explicit unlock only makes the
   * handover deterministic.
   */
  async release(): Promise<void> {
    this.stopMonitoring();
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    if (!this.lost) {
      this.lost = true;
      this.lostReason = "released";
      this.controller.abort();
      try {
        await client.query(
          "SELECT pg_advisory_unlock($1::int, $2::int)",
          [WORKER_OWNERSHIP_KEY_1, WORKER_OWNERSHIP_KEY_2],
        );
      } catch {
        /* session end releases the lock regardless */
      }
    }
    await client.end().catch(() => {});
  }
}

/** Builds the dedicated pg.Client used for ownership in production. */
export async function connectOwnershipClient(connectionString: string): Promise<OwnershipClient> {
  const pg: any = await import("pg");
  // No query_timeout: the shared pool's 10s cap is right for ordinary queries
  // but must not apply here. keepAlive lets a dead peer surface as a socket
  // error instead of a silently half-open session holding the lock.
  const client: Client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });
  await client.connect();
  return client as unknown as OwnershipClient;
}
