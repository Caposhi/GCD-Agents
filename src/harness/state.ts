/**
 * State persistence over Postgres. Backs the approval queue, brand scorecard,
 * self-improvement proposal lineage, and cross-run session memory.
 *
 * Session memory is the GCD-SOCIAL implementation of the lifecycle documented
 * in vendor/ECC/hooks/memory-persistence (reference contract, MIT, pinned). We
 * deliberately do NOT import ECC's executable observe/learning hooks — the
 * self-improvement loop is propose-only and human-gated
 * (skills/self-improvement-protocol/SKILL.md).
 *
 * If DATABASE_URL is unset the store runs in a no-op/in-memory mode so the
 * skeleton boots locally; production always has a Postgres URL injected.
 */

import { config } from "./config.js";

type Pool = import("pg").Pool;

let pool: Pool | undefined;
let enabled = false;

export async function initState(): Promise<void> {
  if (!config.databaseUrl) {
    enabled = false;
    return;
  }
  const pg: any = await import("pg");
  pool = new pg.Pool({ connectionString: config.databaseUrl });
  enabled = true;
}

export function stateEnabled(): boolean {
  return enabled;
}

export async function closeState(): Promise<void> {
  await pool?.end();
  pool = undefined;
  enabled = false;
}

// --- session memory (cross-run state) ---

const sessionMem = new Map<string, unknown>();

export async function saveSessionState(sessionId: string, state: unknown): Promise<void> {
  if (!enabled || !pool) {
    sessionMem.set(sessionId, state);
    return;
  }
  await pool.query(
    `INSERT INTO session_state (session_id, state, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (session_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [sessionId, JSON.stringify(state)],
  );
}

export async function loadSessionState<T = unknown>(sessionId: string): Promise<T | undefined> {
  if (!enabled || !pool) return sessionMem.get(sessionId) as T | undefined;
  const res = await pool.query(`SELECT state FROM session_state WHERE session_id = $1`, [sessionId]);
  return res.rows[0]?.state as T | undefined;
}

// --- approval queue ---

export interface ApprovalRecord {
  id: string;
  platform: string;
  packageJson: unknown;
  status: "pending" | "approved" | "rejected" | "posted" | "failed";
}

export async function enqueueApproval(platform: string, packageJson: unknown): Promise<string | undefined> {
  if (!enabled || !pool) return undefined;
  const res = await pool.query(
    `INSERT INTO approval_queue (platform, package, status)
     VALUES ($1, $2, 'pending') RETURNING id`,
    [platform, JSON.stringify(packageJson)],
  );
  return res.rows[0]?.id as string | undefined;
}

export async function getApprovalStatus(id: string): Promise<ApprovalRecord["status"] | undefined> {
  if (!enabled || !pool) return undefined;
  const res = await pool.query(`SELECT status FROM approval_queue WHERE id = $1`, [id]);
  return res.rows[0]?.status as ApprovalRecord["status"] | undefined;
}
