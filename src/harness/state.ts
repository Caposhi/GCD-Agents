/**
 * State persistence over Postgres, with an in-memory fallback so the harness
 * (and the offline self-tests) run without a DATABASE_URL. Production always
 * has Postgres injected.
 *
 * Backs: cross-run session memory (ECC memory-persistence lifecycle, our impl),
 * the brief queue (/triggers → worker), and the tokenized approval queue (the
 * HITL gate). We deliberately do NOT import ECC's continuous-learning observers
 * (propose-only guardrail — see hooks/README.md).
 */

import { randomUUID } from "node:crypto";
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

// --- session memory ---

const sessionMem = new Map<string, unknown>();

export async function saveSessionState(sessionId: string, state: unknown): Promise<void> {
  if (!enabled || !pool) {
    sessionMem.set(sessionId, state);
    return;
  }
  await pool.query(
    `INSERT INTO session_state (session_id, state, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (session_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
    [sessionId, JSON.stringify(state)],
  );
}

export async function loadSessionState<T = unknown>(sessionId: string): Promise<T | undefined> {
  if (!enabled || !pool) return sessionMem.get(sessionId) as T | undefined;
  const res = await pool.query(`SELECT state FROM session_state WHERE session_id = $1`, [sessionId]);
  return res.rows[0]?.state as T | undefined;
}

// --- brief queue ---

interface BriefRow {
  id: string;
  brief: unknown;
  status: "pending" | "running" | "done" | "failed";
  outcome?: unknown;
}
const briefMem = new Map<string, BriefRow>();

export async function enqueueBrief(brief: unknown): Promise<string> {
  if (!enabled || !pool) {
    const id = randomUUID();
    briefMem.set(id, { id, brief, status: "pending" });
    return id;
  }
  const res = await pool.query(
    `INSERT INTO brief_queue (brief, status) VALUES ($1, 'pending') RETURNING id`,
    [JSON.stringify(brief)],
  );
  return res.rows[0].id as string;
}

/** Atomically claim the oldest pending brief (FOR UPDATE SKIP LOCKED in PG). */
export async function claimNextBrief(): Promise<{ id: string; brief: any } | null> {
  if (!enabled || !pool) {
    for (const row of briefMem.values()) {
      if (row.status === "pending") {
        row.status = "running";
        return { id: row.id, brief: row.brief };
      }
    }
    return null;
  }
  const res = await pool.query(
    `UPDATE brief_queue SET status='running', claimed_at=now()
     WHERE id = (SELECT id FROM brief_queue WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, brief`,
  );
  if (res.rows.length === 0) return null;
  return { id: res.rows[0].id, brief: res.rows[0].brief };
}

export async function completeBrief(id: string, status: "done" | "failed", outcome: unknown): Promise<void> {
  if (!enabled || !pool) {
    const row = briefMem.get(id);
    if (row) { row.status = status; row.outcome = outcome; }
    return;
  }
  await pool.query(`UPDATE brief_queue SET status=$2, outcome=$3 WHERE id=$1`, [id, status, JSON.stringify(outcome)]);
}

// --- approval queue (tokenized) ---

export type ApprovalStatus = "pending" | "approved" | "rejected" | "posted" | "failed";

interface ApprovalRow {
  id: string;
  token: string;
  summary: string;
  packageFormatted: unknown;
  status: ApprovalStatus;
  decidedBy?: string;
}
const approvalMem = new Map<string, ApprovalRow>();

export async function createApproval(
  summary: string,
  packageFormatted: unknown,
): Promise<{ id: string; token: string }> {
  const token = randomUUID();
  if (!enabled || !pool) {
    const id = randomUUID();
    approvalMem.set(id, { id, token, summary, packageFormatted, status: "pending" });
    return { id, token };
  }
  const res = await pool.query(
    `INSERT INTO approval_queue (platform, package, summary, package_formatted, approval_token, status)
     VALUES ('multi', $1, $2, $1, $3, 'pending') RETURNING id`,
    [JSON.stringify(packageFormatted), summary, token],
  );
  return { id: res.rows[0].id as string, token };
}

export async function getApproval(id: string): Promise<ApprovalRow | undefined> {
  if (!enabled || !pool) return approvalMem.get(id);
  const res = await pool.query(
    `SELECT id, approval_token AS token, summary, package_formatted AS "packageFormatted", status, decided_by AS "decidedBy"
     FROM approval_queue WHERE id=$1`,
    [id],
  );
  return res.rows[0] as ApprovalRow | undefined;
}

/** Record a human decision. Verifies the token; only transitions from pending. */
export async function decideApproval(
  id: string,
  token: string,
  decision: "approved" | "rejected",
  decidedBy = "human",
): Promise<{ ok: boolean; reason?: string }> {
  const row = await getApproval(id);
  if (!row) return { ok: false, reason: "not found" };
  if (row.token !== token) return { ok: false, reason: "bad token" };
  if (row.status !== "pending") return { ok: false, reason: `already ${row.status}` };

  if (!enabled || !pool) {
    const m = approvalMem.get(id)!;
    m.status = decision;
    m.decidedBy = decidedBy;
    return { ok: true };
  }
  await pool.query(
    `UPDATE approval_queue SET status=$2, decided_by=$3, decided_at=now() WHERE id=$1 AND status='pending'`,
    [id, decision, decidedBy],
  );
  return { ok: true };
}

export async function setApprovalStatus(id: string, status: ApprovalStatus): Promise<void> {
  if (!enabled || !pool) {
    const m = approvalMem.get(id);
    if (m) m.status = status;
    return;
  }
  await pool.query(`UPDATE approval_queue SET status=$2 WHERE id=$1`, [id, status]);
}
