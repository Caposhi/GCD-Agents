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

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { assertValidSocialPostSubject, validateSocialPostSubject } from "../mcp/posting-tool/validation.js";
import { assertPlatformSafePublicationJpeg } from "./mediaPolicy.js";
import {
  EvidenceRecord,
  EvidenceRelation,
  assertValidEvidenceRecord,
  assertValidEvidenceRelation,
} from "./evidence/contract.js";

type Pool = import("pg").Pool;

let pool: Pool | undefined;
let enabled = false;
const STATE_CONNECTION_TIMEOUT_MS = 10_000;
const STATE_QUERY_TIMEOUT_MS = 10_000;
const SOCIAL_POST_APPROVAL_SUBJECT = "social-post-packages/v1";

export interface InitStateOptions {
  /** Refuse the process-local fallback. API/worker/scheduler must set this. */
  requireDurable?: boolean;
}

/** Pure configuration guard, exported so the fail-closed path is testable offline. */
export function assertDurableStateConfigured(
  databaseUrl: string | undefined,
  requireDurable: boolean,
): void {
  if (requireDurable && !databaseUrl) {
    throw new Error("DATABASE_URL is required for durable process state");
  }
}

export async function initState(options: InitStateOptions = {}): Promise<void> {
  assertDurableStateConfigured(config.databaseUrl, options.requireDurable === true);
  if (!config.databaseUrl) {
    enabled = false;
    return;
  }
  const pg: any = await import("pg");
  const candidate: Pool = new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: STATE_CONNECTION_TIMEOUT_MS,
    query_timeout: STATE_QUERY_TIMEOUT_MS,
  });
  try {
    // Pool construction is lazy. Do not announce durable state or accept work
    // until a real connection has succeeded.
    await candidate.query("SELECT 1");
    if (options.requireDurable) {
      // Fail startup if code was deployed before the Phase-0A migration. A
      // reachable but incompatible database must not degrade to an unsafe gate.
      await candidate.query(
        `SELECT q.subject_type, q.subject_payload, q.payload_sha256,
                q.approval_token_hash, q.token_expires_at,
                q.authorization_expires_at, q.revoked_at,
                d.approval_id
         FROM approval_queue q
         LEFT JOIN approval_decisions d ON d.approval_id=q.id
         LIMIT 0`,
      );
      await candidate.query(`SELECT content_sha256 FROM media LIMIT 0`);
      const triggerProbe = await candidate.query(
        `SELECT count(*)::int AS count
         FROM pg_trigger
         WHERE NOT tgisinternal
           AND tgenabled IN ('O', 'A')
           AND (
             (tgrelid='approval_decisions'::regclass AND tgname IN (
               'approval_decision_no_update',
               'approval_decision_no_delete'
             ))
             OR (tgrelid='approval_queue'::regclass AND tgname='approval_subject_immutable')
             OR (tgrelid='media'::regclass AND tgname='media_content_immutable')
           )`,
      );
      if (triggerProbe.rows[0]?.count !== 4) {
        throw new Error("Phase-0A approval/media integrity triggers are missing");
      }
      const constraintProbe = await candidate.query(
        `SELECT count(*)::int AS count
         FROM pg_constraint
         WHERE conrelid='approval_queue'::regclass
           AND contype='c'
           AND convalidated
           AND conname IN (
             'approval_queue_no_plaintext_token',
             'approval_queue_subject_copies_match'
           )`,
      );
      if (constraintProbe.rows[0]?.count !== 2) {
        throw new Error("Phase-0A approval integrity constraints are missing");
      }
    }
    pool = candidate;
    enabled = true;
  } catch (err) {
    enabled = false;
    await candidate.end().catch(() => {});
    throw err;
  }
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

/**
 * The atomic pending->running claim.
 *
 * Exported so the worker can execute it on the session that holds the worker
 * ownership advisory lock instead of on the shared pool. Running it there is
 * what makes "claimed only while still the exclusive owner" true at commit
 * time rather than merely true at an earlier barrier check.
 */
export const CLAIM_PENDING_BRIEF_SQL =
  `UPDATE brief_queue SET status='running', claimed_at=now()
     WHERE id = (SELECT id FROM brief_queue WHERE status='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING id, brief`;

/**
 * Atomically claim the oldest pending brief (FOR UPDATE SKIP LOCKED in PG).
 *
 * Pool-based path, retained for the in-memory/offline fallback and for callers
 * that are not the owning worker. The production worker claims through its
 * ownership session instead — see CLAIM_PENDING_BRIEF_SQL.
 */
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
  const res = await pool.query(CLAIM_PENDING_BRIEF_SQL);
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

// --- approval queue (canonical hash-bound subjects + one-time decision token) ---

export type ApprovalStatus = "pending" | "approved" | "rejected" | "posted" | "failed";
export type ApprovalDecision = "approved" | "rejected";

const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

/**
 * Normalize JSON into a deterministic representation before hashing/storing it.
 * Object keys are sorted; object properties whose value is undefined are
 * omitted (matching JSON.stringify); undefined array entries become null.
 * Non-JSON values are rejected so callers cannot approve one representation
 * and publish a lossy serialization of another.
 */
function normalizeCanonicalJson(value: unknown, path = "$", inArray = false): CanonicalJson | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`approval subject contains a non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) return inArray ? null : undefined;
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeCanonicalJson(item, `${path}[${index}]`, true) ?? null);
  }
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`approval subject contains a non-plain object at ${path}`);
    }
    const out: Record<string, CanonicalJson> = Object.create(null) as Record<string, CanonicalJson>;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = normalizeCanonicalJson((value as Record<string, unknown>)[key], `${path}.${key}`, false);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  throw new Error(`approval subject contains an unsupported ${typeof value} value at ${path}`);
}

/** Canonical JSON bytes used for both persistence and SHA-256 binding. */
export function canonicalApprovalJson(value: unknown): string {
  const normalized = normalizeCanonicalJson(value);
  if (normalized === undefined) throw new Error("approval subject must be a JSON value");
  return JSON.stringify(normalized);
}

/** Lowercase SHA-256 of canonicalApprovalJson(value). */
export function hashApprovalSubject(value: unknown): string {
  return createHash("sha256").update(canonicalApprovalJson(value), "utf8").digest("hex");
}

function cloneApprovalSubject<T>(value: T): T {
  return JSON.parse(canonicalApprovalJson(value)) as T;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Lowercase SHA-256 for content-addressed hosted media. */
export function hashMediaBytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashesEqual(left: string | undefined, right: string): boolean {
  if (!left || !/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isPast(value: string | undefined, now = Date.now()): boolean {
  if (!value) return true;
  const millis = Date.parse(value);
  return !Number.isFinite(millis) || millis <= now;
}

function dateIso(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const millis = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : "";
}

export interface ApprovalRow {
  id: string;
  summary: string;
  subjectType: string;
  subject: unknown;
  /** Compatibility alias used by the current approval review surface. */
  packageFormatted: unknown;
  payloadSha256: string;
  status: ApprovalStatus;
  tokenExpiresAt: string;
  authorizationExpiresAt: string;
  decidedBy?: string;
  decidedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
}

interface StoredApprovalRow extends ApprovalRow {
  tokenHash: string;
}

interface StoredApprovalDecision {
  decision: ApprovalDecision;
  subjectType: string;
  payloadSha256: string;
  decidedBy: string;
  decidedAt: string;
}

export interface CreateApprovalOptions {
  subjectType?: string;
  /** Decision-link lifetime. Defaults to 24 hours. */
  tokenExpiresAt?: Date;
  /** Latest instant at which an approved subject may authorize publication. */
  authorizationExpiresAt?: Date;
}

export interface ApprovalHandleRecord {
  id: string;
  /** Returned once. Only its SHA-256 is stored. */
  token: string;
  payloadSha256: string;
  tokenExpiresAt: string;
  authorizationExpiresAt: string;
}

const approvalMem = new Map<string, StoredApprovalRow>();
const approvalDecisionMem = new Map<string, StoredApprovalDecision>();

function publicApprovalRow(row: StoredApprovalRow): ApprovalRow {
  const subject = cloneApprovalSubject(row.subject);
  return {
    id: row.id,
    summary: row.summary,
    subjectType: row.subjectType,
    subject,
    packageFormatted: cloneApprovalSubject(subject),
    payloadSha256: row.payloadSha256,
    status: row.status,
    tokenExpiresAt: row.tokenExpiresAt,
    authorizationExpiresAt: row.authorizationExpiresAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    revocationReason: row.revocationReason,
  };
}

function rowFromDb(row: any): StoredApprovalRow {
  const subject = row.subject;
  return {
    id: String(row.id),
    summary: String(row.summary ?? ""),
    subjectType: String(row.subjectType ?? ""),
    subject,
    packageFormatted: subject,
    payloadSha256: String(row.payloadSha256 ?? ""),
    tokenHash: String(row.tokenHash ?? ""),
    status: row.status as ApprovalStatus,
    tokenExpiresAt: dateIso(row.tokenExpiresAt),
    authorizationExpiresAt: dateIso(row.authorizationExpiresAt),
    decidedBy: row.decidedBy ? String(row.decidedBy) : undefined,
    decidedAt: row.decidedAt ? dateIso(row.decidedAt) : undefined,
    revokedAt: row.revokedAt ? dateIso(row.revokedAt) : undefined,
    revokedBy: row.revokedBy ? String(row.revokedBy) : undefined,
    revocationReason: row.revocationReason ? String(row.revocationReason) : undefined,
  };
}

async function getStoredApproval(id: string): Promise<StoredApprovalRow | undefined> {
  if (!enabled || !pool) return approvalMem.get(id);
  const res = await pool.query(
    `SELECT id,
            summary,
            subject_type AS "subjectType",
            subject_payload AS subject,
            payload_sha256 AS "payloadSha256",
            approval_token_hash AS "tokenHash",
            status,
            token_expires_at AS "tokenExpiresAt",
            authorization_expires_at AS "authorizationExpiresAt",
            decided_by AS "decidedBy",
            decided_at AS "decidedAt",
            revoked_at AS "revokedAt",
            revoked_by AS "revokedBy",
            revocation_reason AS "revocationReason"
     FROM approval_queue WHERE id=$1`,
    [id],
  );
  return res.rows[0] ? rowFromDb(res.rows[0]) : undefined;
}

export async function createApproval(
  summary: string,
  packageFormatted: unknown,
  options: CreateApprovalOptions = {},
): Promise<ApprovalHandleRecord> {
  const subjectType = options.subjectType?.trim() || "social-post-packages/v1";
  const subject = cloneApprovalSubject(packageFormatted);
  if (subjectType === SOCIAL_POST_APPROVAL_SUBJECT) assertValidSocialPostSubject(subject);
  const payloadSha256 = hashApprovalSubject(subject);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256Text(token);
  const now = Date.now();
  const tokenExpiresAt = (options.tokenExpiresAt ?? new Date(now + DEFAULT_APPROVAL_TTL_MS)).toISOString();
  const authorizationExpiresAt = (
    options.authorizationExpiresAt ?? new Date(now + DEFAULT_APPROVAL_TTL_MS)
  ).toISOString();

  if (!enabled || !pool) {
    const id = randomUUID();
    approvalMem.set(id, {
      id,
      summary,
      subjectType,
      subject,
      packageFormatted: subject,
      payloadSha256,
      tokenHash,
      tokenExpiresAt,
      authorizationExpiresAt,
      status: "pending",
    });
    return { id, token, payloadSha256, tokenExpiresAt, authorizationExpiresAt };
  }
  const res = await pool.query(
    `INSERT INTO approval_queue (
       platform, package, summary, package_formatted, approval_token, status,
       subject_type, subject_payload, payload_sha256, approval_token_hash,
       token_expires_at, authorization_expires_at
     )
     VALUES ('multi', $1, $2, $1, NULL, 'pending', $3, $1, $4, $5, $6, $7)
     RETURNING id`,
    [
      JSON.stringify(subject),
      summary,
      subjectType,
      payloadSha256,
      tokenHash,
      tokenExpiresAt,
      authorizationExpiresAt,
    ],
  );
  return {
    id: res.rows[0].id as string,
    token,
    payloadSha256,
    tokenExpiresAt,
    authorizationExpiresAt,
  };
}

/** Returns review data but never the plaintext token or its stored hash. */
export async function getApproval(id: string): Promise<ApprovalRow | undefined> {
  const row = await getStoredApproval(id);
  return row ? publicApprovalRow(row) : undefined;
}

/** Verify a transitional review token without exposing the stored token hash. */
export async function verifyApprovalToken(
  id: string,
  token: string,
): Promise<{ ok: boolean; reason?: string }> {
  const row = await getStoredApproval(id);
  if (!row) return { ok: false, reason: "not found" };
  if (!hashesEqual(row.tokenHash, sha256Text(token))) return { ok: false, reason: "invalid token" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (isPast(row.tokenExpiresAt)) return { ok: false, reason: "expired" };
  return { ok: true };
}

function subjectHashIsValid(row: StoredApprovalRow): boolean {
  try {
    return hashesEqual(row.payloadSha256, hashApprovalSubject(row.subject));
  } catch {
    return false;
  }
}

/** Record one human decision atomically. Concurrent/double decisions cannot both succeed. */
export async function decideApproval(
  id: string,
  token: string,
  decision: ApprovalDecision,
  decidedBy = "human",
): Promise<{ ok: boolean; reason?: string }> {
  if (decision !== "approved" && decision !== "rejected") return { ok: false, reason: "invalid decision" };
  const row = await getStoredApproval(id);
  if (!row) return { ok: false, reason: "not found" };
  if (!hashesEqual(row.tokenHash, sha256Text(token))) return { ok: false, reason: "invalid token" };
  if (!subjectHashIsValid(row)) return { ok: false, reason: "approval subject integrity check failed" };
  if (
    row.subjectType === SOCIAL_POST_APPROVAL_SUBJECT
    && !validateSocialPostSubject(row.subject).ok
  ) return { ok: false, reason: "approval subject shape check failed" };

  if (!enabled || !pool) {
    // No await occurs between the condition and mutation, so this transition is
    // atomic within the single-threaded offline test process.
    const current = approvalMem.get(id);
    if (!current) return { ok: false, reason: "not found" };
    if (current.revokedAt) return { ok: false, reason: "revoked" };
    if (isPast(current.tokenExpiresAt)) return { ok: false, reason: "expired" };
    if (current.status !== "pending") return { ok: false, reason: `already ${current.status}` };
    current.status = decision;
    current.decidedBy = decidedBy;
    current.decidedAt = new Date().toISOString();
    approvalDecisionMem.set(id, {
      decision,
      subjectType: current.subjectType,
      payloadSha256: current.payloadSha256,
      decidedBy,
      decidedAt: current.decidedAt,
    });
    return { ok: true };
  }

  const res = await pool.query(
    `WITH decided AS (
       UPDATE approval_queue
       SET status=$3, decided_by=$4, decided_at=now()
       WHERE id=$1
         AND approval_token_hash=$2
         AND status='pending'
         AND revoked_at IS NULL
         AND token_expires_at > now()
         AND payload_sha256 IS NOT NULL
       RETURNING id, status, subject_type, payload_sha256, decided_by, decided_at
     ), logged AS (
       INSERT INTO approval_decisions (
         approval_id, decision, subject_type, payload_sha256, decided_by, decided_at
       )
       SELECT id, status, subject_type, payload_sha256, decided_by, decided_at FROM decided
       RETURNING approval_id
     )
     SELECT decided.id FROM decided JOIN logged ON logged.approval_id=decided.id`,
    [id, row.tokenHash, decision, decidedBy],
  );
  if (res.rowCount === 1) return { ok: true };

  const current = await getStoredApproval(id);
  if (!current) return { ok: false, reason: "not found" };
  if (current.revokedAt) return { ok: false, reason: "revoked" };
  if (isPast(current.tokenExpiresAt)) return { ok: false, reason: "expired" };
  if (current.status !== "pending") return { ok: false, reason: `already ${current.status}` };
  return { ok: false, reason: "decision could not be recorded" };
}

/** Revoke a pending or approved authorization; publication checks this live. */
export async function revokeApproval(
  id: string,
  revokedBy = "system",
  reason = "revoked",
): Promise<{ ok: boolean; reason?: string }> {
  if (!enabled || !pool) {
    const row = approvalMem.get(id);
    if (!row) return { ok: false, reason: "not found" };
    if (row.revokedAt) return { ok: false, reason: "already revoked" };
    if (row.status !== "pending" && row.status !== "approved") {
      return { ok: false, reason: `cannot revoke ${row.status}` };
    }
    row.revokedAt = new Date().toISOString();
    row.revokedBy = revokedBy;
    row.revocationReason = reason;
    return { ok: true };
  }
  const res = await pool.query(
    `UPDATE approval_queue
     SET revoked_at=now(), revoked_by=$2, revocation_reason=$3
     WHERE id=$1 AND revoked_at IS NULL AND status IN ('pending','approved')`,
    [id, revokedBy, reason],
  );
  return res.rowCount === 1 ? { ok: true } : { ok: false, reason: "not found or no longer revocable" };
}

function validateApprovedSubject<T>(
  row: StoredApprovalRow,
  expectedSubjectType?: string,
): { subject: T; payloadSha256: string } {
  if (!row) throw new Error("BLOCKED: no durable approval record exists");
  if (row.status !== "approved") throw new Error(`BLOCKED: approval is ${row.status}, not approved`);
  if (row.revokedAt) throw new Error("BLOCKED: approval has been revoked");
  if (isPast(row.authorizationExpiresAt)) throw new Error("BLOCKED: approval authorization has expired");
  if (expectedSubjectType && row.subjectType !== expectedSubjectType) {
    throw new Error(`BLOCKED: approval subject type is ${row.subjectType || "missing"}`);
  }
  if (!subjectHashIsValid(row)) throw new Error("BLOCKED: approval subject hash mismatch");
  if (row.subjectType === SOCIAL_POST_APPROVAL_SUBJECT) assertValidSocialPostSubject(row.subject);
  return { subject: cloneApprovalSubject(row.subject) as T, payloadSha256: row.payloadSha256 };
}

/**
 * Self-test-only resolver for the process-local approval maps. Production
 * publication code must never call this function; it exists only so offline
 * tests can exercise expiry/revocation/decision semantics without a database.
 */
export async function getEphemeralApprovedSubjectForSelfTest<T = unknown>(
  id: string,
  expectedSubjectType?: string,
): Promise<{ subject: T; payloadSha256: string }> {
  if (enabled || pool) throw new Error("self-test resolver requires ephemeral state");
  const row = approvalMem.get(id);
  const decision = approvalDecisionMem.get(id);
  if (!row) throw new Error("BLOCKED: no ephemeral approval record exists");
  if (
    !decision
    || decision.decision !== "approved"
    || decision.subjectType !== row.subjectType
    || !hashesEqual(decision.payloadSha256, row.payloadSha256)
  ) {
    throw new Error("BLOCKED: no matching recorded approval decision exists");
  }
  return validateApprovedSubject<T>(row, expectedSubjectType);
}

/**
 * Resolve a live, exact approval subject from PostgreSQL. This authorization
 * primitive always requires the durable backend, regardless of NODE_ENV; the
 * process-local maps can never authorize a publication.
 */
export async function getLiveApprovedSubject<T = unknown>(
  id: string,
  expectedSubjectType?: string,
): Promise<{ subject: T; payloadSha256: string }> {
  if (!enabled || !pool) throw new Error("BLOCKED: durable approval state is unavailable");

  // Require the immutable decision row and current queue state to agree in one
  // database snapshot. Merely setting approval_queue.status cannot grant
  // publication authority.
  const res = await pool.query(
    `SELECT q.id,
            q.summary,
            q.subject_type AS "subjectType",
            q.subject_payload AS subject,
            q.payload_sha256 AS "payloadSha256",
            q.approval_token_hash AS "tokenHash",
            q.status,
            q.token_expires_at AS "tokenExpiresAt",
            q.authorization_expires_at AS "authorizationExpiresAt",
            q.decided_by AS "decidedBy",
            q.decided_at AS "decidedAt",
            q.revoked_at AS "revokedAt",
            q.revoked_by AS "revokedBy",
            q.revocation_reason AS "revocationReason"
     FROM approval_queue q
     JOIN approval_decisions d
       ON d.approval_id=q.id
      AND d.decision='approved'
      AND d.subject_type=q.subject_type
      AND d.payload_sha256=q.payload_sha256
     WHERE q.id=$1
       AND q.status='approved'
       AND q.revoked_at IS NULL
       AND q.authorization_expires_at > now()`,
    [id],
  );
  const row = res.rows[0] ? rowFromDb(res.rows[0]) : undefined;
  if (!row) {
    const current = await getStoredApproval(id);
    if (!current) throw new Error("BLOCKED: no durable approval record exists");
    if (current.status !== "approved") throw new Error(`BLOCKED: approval is ${current.status}, not approved`);
    if (current.revokedAt) throw new Error("BLOCKED: approval has been revoked");
    if (isPast(current.authorizationExpiresAt)) throw new Error("BLOCKED: approval authorization has expired");
    throw new Error("BLOCKED: no matching recorded approval decision exists");
  }
  return validateApprovedSubject<T>(row, expectedSubjectType);
}

/** Publication outcome transition; never creates or repairs an authorization. */
export async function setApprovalStatus(id: string, status: ApprovalStatus): Promise<void> {
  if (status !== "posted" && status !== "failed") {
    throw new Error(`approval publication status must be posted or failed, received ${status}`);
  }
  if (!enabled || !pool) {
    const row = approvalMem.get(id);
    if (row?.status === "approved") row.status = status;
    return;
  }
  await pool.query(
    `UPDATE approval_queue SET status=$2 WHERE id=$1 AND status='approved'`,
    [id, status],
  );
}

// --- live activity events (console / "live game view") ---

export interface EventRow {
  id: number;
  runId?: string;
  kind: string;
  agent?: string;
  message: string;
  data?: unknown;
  createdAt: string;
}

interface EventInput {
  runId?: string;
  kind: string;
  agent?: string;
  message: string;
  data?: unknown;
}

const eventMem: EventRow[] = [];
let eventMemSeq = 0;

/** Append a live event. Fire-and-forget at call sites — never let telemetry break a run. */
export async function recordEvent(e: EventInput): Promise<void> {
  if (!enabled || !pool) {
    eventMem.push({
      id: ++eventMemSeq,
      runId: e.runId,
      kind: e.kind,
      agent: e.agent,
      message: e.message,
      data: e.data,
      createdAt: new Date().toISOString(),
    });
    if (eventMem.length > 500) eventMem.shift();
    return;
  }
  await pool.query(
    `INSERT INTO events (run_id, kind, agent, message, data) VALUES ($1, $2, $3, $4, $5)`,
    [e.runId ?? null, e.kind, e.agent ?? null, e.message, e.data === undefined ? null : JSON.stringify(e.data)],
  );
}

/**
 * Safety-critical sibling of recordEvent, deliberately a separate function.
 *
 * recordEvent above is best-effort telemetry and its callers swallow failures;
 * that contract stays true so nobody has to reason about which call sites may
 * drop writes. These markers are recovery state, not telemetry: a later worker
 * classifies interrupted work purely from them, so a silently dropped marker
 * would make an already-published brief look like it never reached a provider.
 *
 * Callers MUST await this and MUST NOT swallow the rejection. No external side
 * effect may begin unless its preceding marker committed.
 */
export async function recordDurablePhaseEvent(e: EventInput): Promise<void> {
  if (!enabled || !pool) {
    // Offline/self-test state keeps the same append semantics, but production
    // durability is enforced by the worker requiring durable state at startup.
    eventMem.push({
      id: ++eventMemSeq,
      runId: e.runId,
      kind: e.kind,
      agent: e.agent,
      message: e.message,
      data: e.data,
      createdAt: new Date().toISOString(),
    });
    if (eventMem.length > 500) eventMem.shift();
    return;
  }
  const res = await pool.query(
    `INSERT INTO events (run_id, kind, agent, message, data) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [e.runId ?? null, e.kind, e.agent ?? null, e.message, e.data === undefined ? null : JSON.stringify(e.data)],
  );
  if (res.rowCount !== 1) throw new Error(`durable phase event ${e.kind} was not persisted`);
}

export interface RunningBriefRow {
  id: string;
  brief: any;
  claimedAt?: string;
}

/**
 * Briefs still marked running. Only meaningful to a process that already holds
 * exclusive worker ownership — otherwise a row here may belong to a live peer
 * that Render has not shut down yet.
 */
export async function listRunningBriefs(): Promise<RunningBriefRow[]> {
  if (!enabled || !pool) {
    return [...briefMem.values()]
      .filter((row) => row.status === "running")
      .map((row) => ({ id: row.id, brief: row.brief }));
  }
  const res = await pool.query(
    `SELECT id, brief, claimed_at FROM brief_queue WHERE status='running' ORDER BY created_at`,
  );
  return res.rows.map((row: any) => ({
    id: row.id as string,
    brief: row.brief,
    claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : undefined,
  }));
}

/** Durable phase history for one run, oldest first. General-purpose. */
export async function eventsForRun(runId: string, limit = 500): Promise<EventRow[]> {
  if (!enabled || !pool) {
    return eventMem.filter((e) => e.runId === runId).slice(0, limit);
  }
  const res = await pool.query(
    `SELECT id, run_id AS "runId", kind, agent, message, data, created_at AS "createdAt"
     FROM events WHERE run_id=$1 ORDER BY id ASC LIMIT $2`,
    [runId, Math.min(limit, 2_000)],
  );
  return res.rows as EventRow[];
}

/** The event kinds recovery classifies from. Nothing else is safety state. */
export const PHASE_MARKER_KINDS = [
  "brief:approval_requested",
  "brief:publish_attempt_started",
  "brief:publish_attempt_settled",
  "brief:publish_attempt_abandoned",
] as const;

const PHASE_MARKER_LIMIT = 1_000;

/**
 * The safety markers for one run.
 *
 * Filtered by kind rather than paging the run's whole event stream: a chatty
 * run could otherwise push its markers past an "oldest N" window, and a
 * truncated marker trace does not read as incomplete — it reads as a run that
 * never requested an approval, i.e. as "no provider mutation was possible".
 * That is the most dangerous direction a misclassification can go.
 *
 * A run has a handful of markers, so the bound is unreachable in practice and
 * is enforced as an explicit ambiguity error rather than a silent slice.
 */
export async function phaseMarkersForRun(runId: string): Promise<EventRow[]> {
  if (!enabled || !pool) {
    return eventMem.filter((e) => e.runId === runId
      && (PHASE_MARKER_KINDS as readonly string[]).includes(e.kind));
  }
  const res = await pool.query(
    `SELECT id, run_id AS "runId", kind, agent, message, data, created_at AS "createdAt"
     FROM events WHERE run_id=$1 AND kind = ANY($2::text[]) ORDER BY id ASC LIMIT $3`,
    [runId, [...PHASE_MARKER_KINDS], PHASE_MARKER_LIMIT + 1],
  );
  if (res.rows.length > PHASE_MARKER_LIMIT) {
    throw new Error(
      `phase marker trace for ${runId} exceeded ${PHASE_MARKER_LIMIT} rows; refusing to classify a truncated trace`,
    );
  }
  return res.rows as EventRow[];
}

/**
 * Pending, unrevoked approvals.
 *
 * Only safe to call at startup, after ownership is acquired and before queue
 * consumption begins: at that instant this owner has created no approvals, so
 * every row returned predates it. Combined with the caller's marker check, an
 * approval this or any live worker is waiting on can never be swept.
 */
export async function listRevocablePendingApprovals(): Promise<string[]> {
  if (!enabled || !pool) {
    return [...approvalMem.entries()]
      .filter(([, row]) => row.status === "pending" && !row.revokedAt)
      .map(([id]) => id);
  }
  const res = await pool.query(
    `SELECT id FROM approval_queue
     WHERE status='pending' AND revoked_at IS NULL
     ORDER BY created_at`,
  );
  return res.rows.map((row: any) => row.id as string);
}

/**
 * Of the given approval ids, those that a brief:approval_requested marker
 * claims. Returns approval ids, not run ids.
 */
export async function approvalIdsWithOwningBriefMarker(approvalIds: string[]): Promise<Set<string>> {
  const wanted = new Set(approvalIds);
  const found = new Set<string>();
  if (wanted.size === 0) return found;
  if (!enabled || !pool) {
    for (const e of eventMem) {
      if (e.kind !== "brief:approval_requested") continue;
      const approvalId = (e.data as any)?.approvalId;
      if (typeof approvalId === "string" && wanted.has(approvalId)) found.add(approvalId);
    }
    return found;
  }
  const res = await pool.query(
    `SELECT DISTINCT data->>'approvalId' AS approval_id
     FROM events
     WHERE kind='brief:approval_requested' AND data->>'approvalId' = ANY($1::text[])`,
    [[...wanted]],
  );
  for (const row of res.rows) if (row.approval_id) found.add(row.approval_id as string);
  return found;
}

/**
 * Events for either of two callers, oldest-first in the returned array:
 *  - SSE cursor resume (`sinceId` explicitly passed, e.g. 0 for "from the
 *    start"): the next `limit` events after that id — a forward page.
 *  - a "recent activity" snapshot (`sinceId` omitted, e.g. /console/state):
 *    the most recent `limit` events, not the oldest ones ever recorded.
 * These are NOT interchangeable — collapsing "omitted" and "explicitly 0"
 * into the same value here previously pinned every snapshot caller to the
 * oldest 20 events forever (`WHERE id > 0 ORDER BY id ASC LIMIT 20`), so the
 * console's recent-activity strip never advanced past the very first posts.
 */
export async function recentEvents(opts: { sinceId?: number; limit?: number } = {}): Promise<EventRow[]> {
  const limit = Math.min(opts.limit ?? 100, 500);
  if (!enabled || !pool) {
    const sinceId = opts.sinceId ?? 0;
    return eventMem.filter((e) => e.id > sinceId).slice(-limit);
  }
  if (opts.sinceId === undefined) {
    const res = await pool.query(
      `SELECT id, run_id AS "runId", kind, agent, message, data, created_at AS "createdAt"
       FROM (SELECT * FROM events ORDER BY id DESC LIMIT $1) AS latest
       ORDER BY id ASC`,
      [limit],
    );
    return res.rows as EventRow[];
  }
  const res = await pool.query(
    `SELECT id, run_id AS "runId", kind, agent, message, data, created_at AS "createdAt"
     FROM events WHERE id > $1 ORDER BY id ASC LIMIT $2`,
    [opts.sinceId, limit],
  );
  return res.rows as EventRow[];
}

/** Compact operational snapshot for /console/state. */
export async function consoleSnapshot(): Promise<{
  queue: Record<string, number>;
  lastBrief?: { id: string; status: string; goal?: string };
}> {
  if (!enabled || !pool) {
    const queue: Record<string, number> = {};
    let last: BriefRow | undefined;
    for (const row of briefMem.values()) {
      queue[row.status] = (queue[row.status] ?? 0) + 1;
      last = row;
    }
    return {
      queue,
      lastBrief: last ? { id: last.id, status: last.status, goal: (last.brief as any)?.goal } : undefined,
    };
  }
  const counts = await pool.query(`SELECT status, count(*)::int AS n FROM brief_queue GROUP BY status`);
  const queue: Record<string, number> = {};
  for (const r of counts.rows) queue[r.status as string] = r.n as number;
  const last = await pool.query(
    `SELECT id, status, brief->>'goal' AS goal FROM brief_queue ORDER BY created_at DESC LIMIT 1`,
  );
  return {
    queue,
    lastBrief: last.rows[0] ? { id: last.rows[0].id, status: last.rows[0].status, goal: last.rows[0].goal } : undefined,
  };
}

// --- hosted media (transcoded JPEGs served by the web service) ---

export interface StoredMedia {
  id: string;
  mime: string;
  bytes: Buffer;
  contentSha256: string;
}

const mediaMem = new Map<string, StoredMedia>();

export async function saveMedia(
  mime: string,
  bytes: Buffer,
): Promise<{ id: string; contentSha256: string }> {
  const contentSha256 = hashMediaBytes(bytes);
  if (!enabled || !pool) {
    const id = randomUUID();
    mediaMem.set(id, { id, mime, bytes: Buffer.from(bytes), contentSha256 });
    return { id, contentSha256 };
  }
  const res = await pool.query(
    `INSERT INTO media (mime, bytes, content_sha256) VALUES ($1, $2, $3) RETURNING id`,
    [mime, bytes, contentSha256],
  );
  return { id: res.rows[0].id as string, contentSha256 };
}

export async function getMedia(id: string): Promise<StoredMedia | undefined> {
  let media: StoredMedia | undefined;
  if (!enabled || !pool) {
    const stored = mediaMem.get(id);
    media = stored ? { ...stored, bytes: Buffer.from(stored.bytes) } : undefined;
  } else {
    const res = await pool.query(
      `SELECT id, mime, bytes, content_sha256 AS "contentSha256" FROM media WHERE id = $1`,
      [id],
    );
    media = res.rows[0] as StoredMedia | undefined;
  }
  if (!media) return undefined;
  const actual = hashMediaBytes(media.bytes);
  if (!hashesEqual(media.contentSha256, actual)) {
    throw new Error(`hosted media integrity mismatch (id=${id})`);
  }
  return media;
}

/**
 * Verify that one approved media reference is an internal content-addressed
 * immutable row whose live bytes still match the digest in the approval.
 */
export async function assertHostedMediaIntegrity(
  mediaUrl: string,
  expectedSha256: string,
): Promise<void> {
  if (!enabled || !pool) throw new Error("BLOCKED: durable media state is unavailable");
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("BLOCKED: approved media digest is missing or invalid");
  }
  if (!config.publicBaseUrl) throw new Error("BLOCKED: PUBLIC_BASE_URL is unavailable for media verification");

  let configured: URL;
  let candidate: URL;
  try {
    configured = new URL(config.publicBaseUrl);
    candidate = new URL(mediaUrl);
  } catch {
    throw new Error("BLOCKED: approved media URL is invalid");
  }
  if (
    configured.protocol !== "https:"
    || configured.pathname !== "/"
    || configured.search
    || configured.hash
    || configured.username
    || configured.password
  ) {
    throw new Error("BLOCKED: PUBLIC_BASE_URL must be a root HTTPS origin");
  }
  if (
    candidate.origin !== configured.origin
    || candidate.search
    || candidate.hash
    || candidate.username
    || candidate.password
  ) {
    throw new Error("BLOCKED: approved media URL is not on the configured internal media origin");
  }
  const match = candidate.pathname.match(
    /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{64})\.jpg$/i,
  );
  if (!match) throw new Error("BLOCKED: approved media URL is not content-addressed");
  const pathDigest = match[2]!.toLowerCase();
  if (!hashesEqual(pathDigest, expectedSha256)) {
    throw new Error("BLOCKED: approved media URL digest does not match its payload digest");
  }
  const media = await getMedia(match[1]!);
  if (!media || media.mime !== "image/jpeg" || !hashesEqual(media.contentSha256, expectedSha256)) {
    throw new Error("BLOCKED: approved media bytes are missing or do not match their digest");
  }
  try {
    assertPlatformSafePublicationJpeg(media.bytes);
  } catch (err) {
    throw new Error(`BLOCKED: hosted media is not a platform-safe JPEG: ${(err as Error).message}`);
  }
}

// --- content evidence (Phase 0B.0) ---
//
// Evidence is read by the Content Intelligence preview and written only by an
// explicit operator sync. Nothing here runs on application startup: importing
// approved facts is a deliberate command, not a boot side effect, so a deploy
// can never silently rewrite what the system believes.

/** Row → domain record. `null` columns become absent fields, not empty strings. */
function evidenceRowToRecord(row: any): EvidenceRecord {
  const iso = (value: unknown): string | undefined =>
    value instanceof Date ? value.toISOString() : (typeof value === "string" ? value : undefined);
  const record: EvidenceRecord = {
    id: String(row.id),
    kind: row.kind,
    claim: String(row.claim),
    subject: String(row.subject),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    sourceType: row.source_type,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    lifecycle: row.lifecycle,
  };
  if (row.attribute != null) record.attribute = String(row.attribute);
  if (row.source_ref != null) record.sourceRef = String(row.source_ref);
  if (row.provenance != null) record.provenance = String(row.provenance);
  if (row.confidence != null) record.confidence = Number(row.confidence);
  if (row.observed_at != null) record.observedAt = iso(row.observed_at);
  if (row.reviewed_at != null) record.reviewedAt = iso(row.reviewed_at);
  if (row.reviewed_by != null) record.reviewedBy = String(row.reviewed_by);
  if (row.review_by != null) record.reviewBy = iso(row.review_by);
  if (row.expires_at != null) record.expiresAt = iso(row.expires_at);
  if (row.superseded_by_id != null) record.supersededById = String(row.superseded_by_id);
  if (row.generalizable != null) record.generalizable = Boolean(row.generalizable);
  if (row.detail != null) record.detail = row.detail as Record<string, unknown>;
  return record;
}

/** All evidence, ordered deterministically. Empty when durable state is off. */
export async function listContentEvidence(): Promise<EvidenceRecord[]> {
  if (!enabled || !pool) return [];
  const res = await pool.query(
    `SELECT * FROM content_evidence ORDER BY subject ASC, kind ASC, id ASC`,
  );
  return res.rows.map((row: any) => assertValidEvidenceRecord(evidenceRowToRecord(row)));
}

export async function listContentEvidenceRelations(): Promise<EvidenceRelation[]> {
  if (!enabled || !pool) return [];
  const res = await pool.query(
    `SELECT from_id, to_id, kind, note, created_at FROM content_evidence_relations
      ORDER BY from_id ASC, to_id ASC, kind ASC`,
  );
  return res.rows.map((row: any) => assertValidEvidenceRelation({
    fromId: String(row.from_id),
    toId: String(row.to_id),
    kind: row.kind,
    note: row.note != null ? String(row.note) : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

export interface EvidenceSyncResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Idempotent upsert of adapted evidence.
 *
 * Running it twice with the same input must report zero further changes — that
 * is what makes it safe to re-run after a failed operator session. The
 * `IS DISTINCT FROM` guard in the WHERE clause is what delivers it: an
 * unchanged row is not rewritten, so `updated_at` stays honest.
 */
export async function syncContentEvidence(records: EvidenceRecord[]): Promise<EvidenceSyncResult> {
  if (!enabled || !pool) throw new Error("content evidence sync requires durable PostgreSQL state");
  for (const record of records) assertValidEvidenceRecord(record);

  const result: EvidenceSyncResult = { inserted: 0, updated: 0, unchanged: 0 };
  for (const record of records) {
    const res = await pool.query(
      `INSERT INTO content_evidence (
         id, kind, claim, subject, attribute, tags, source_type, source_ref, provenance, confidence,
         observed_at, reviewed_at, reviewed_by, review_by, expires_at, created_at,
         lifecycle, superseded_by_id, generalizable, detail
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO UPDATE SET
         kind = EXCLUDED.kind, claim = EXCLUDED.claim, subject = EXCLUDED.subject,
         attribute = EXCLUDED.attribute,
         tags = EXCLUDED.tags, source_type = EXCLUDED.source_type,
         source_ref = EXCLUDED.source_ref, provenance = EXCLUDED.provenance,
         confidence = EXCLUDED.confidence, observed_at = EXCLUDED.observed_at,
         reviewed_at = EXCLUDED.reviewed_at, reviewed_by = EXCLUDED.reviewed_by,
         review_by = EXCLUDED.review_by, expires_at = EXCLUDED.expires_at,
         lifecycle = EXCLUDED.lifecycle, superseded_by_id = EXCLUDED.superseded_by_id,
         generalizable = EXCLUDED.generalizable, detail = EXCLUDED.detail
       WHERE (
         content_evidence.kind, content_evidence.claim, content_evidence.subject,
         content_evidence.attribute, content_evidence.tags, content_evidence.source_type, content_evidence.source_ref,
         content_evidence.provenance, content_evidence.confidence, content_evidence.observed_at,
         content_evidence.reviewed_at, content_evidence.reviewed_by, content_evidence.review_by,
         content_evidence.expires_at, content_evidence.lifecycle,
         content_evidence.superseded_by_id, content_evidence.generalizable, content_evidence.detail
       ) IS DISTINCT FROM (
         EXCLUDED.kind, EXCLUDED.claim, EXCLUDED.subject, EXCLUDED.attribute, EXCLUDED.tags, EXCLUDED.source_type,
         EXCLUDED.source_ref, EXCLUDED.provenance, EXCLUDED.confidence, EXCLUDED.observed_at,
         EXCLUDED.reviewed_at, EXCLUDED.reviewed_by, EXCLUDED.review_by, EXCLUDED.expires_at,
         EXCLUDED.lifecycle, EXCLUDED.superseded_by_id, EXCLUDED.generalizable, EXCLUDED.detail
       )
       RETURNING (xmax = 0) AS inserted`,
      [
        record.id, record.kind, record.claim, record.subject, record.attribute ?? null,
        record.tags, record.sourceType,
        record.sourceRef ?? null, record.provenance ?? null, record.confidence ?? null,
        record.observedAt ?? null, record.reviewedAt ?? null, record.reviewedBy ?? null,
        record.reviewBy ?? null, record.expiresAt ?? null, record.createdAt,
        record.lifecycle, record.supersededById ?? null, record.generalizable ?? false,
        record.detail ? JSON.stringify(record.detail) : null,
      ],
    );
    if (res.rows.length === 0) result.unchanged++;
    else if (res.rows[0].inserted) result.inserted++;
    else result.updated++;
  }
  return result;
}
