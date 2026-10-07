/**
 * The Studio web service's database access (docs/CONTENT_STUDIO_DESIGN.md §4.1,
 * §4.6, §7). `WebStore` is the contract; `PgWebStore` implements it over the
 * Studio database, on S2's schema unchanged.
 *
 * The store decides nothing the decisions in `sessions.ts` decide: a session is
 * read with its live users row as stored, revoked or expired or not, and
 * `decideSession` judges it. The database's own invariants stay where S2 put
 * them and are relied on, not re-implemented: `studio_consume_login_attempt`
 * (single use, refuses expired), the users trigger's advisory-locked bootstrap
 * rule, the immutable `google_sub`, the session guard, and the revocation of a
 * disabled user's sessions in the same transaction.
 */

import pg from "pg";

import { microsToNumeric, numericToMicros, OVERRUN_ACKNOWLEDGED, UNACKNOWLEDGED_OVERRUNS_SQL } from "../db/runner.js";
import {
  decideCancel, decideConfirm, localDay, preflightPurgeable, type DeploymentCeilings, type PreflightRequestInput, type Refusal,
} from "./actions.js";
import { decideLineage, type BundleFile } from "./bundle.js";
import type {
  ArtifactMeta, FindingRow, RequestRow, RunFilters, RunLineage, RunListRow, RunRow, StoredArtifact,
} from "./runs.js";
import type { Role, SessionRow, StudioUserRow } from "./sessions.js";

export interface AuditEntry {
  action: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  /** Classes and counts only: never a token, code, state, nonce, cookie, claim value or email. */
  detail: Record<string, string | number | boolean>;
}

export interface WebHealth {
  /** The newest applied Studio migration, or null. */
  schemaVersion: string | null;
  /** Seconds since the worker's last heartbeat row, or null when it has never beaten. */
  workerHeartbeatAgeSeconds: number | null;
}

export interface WebStore {
  /** Runs `fn` in one transaction, rolled back on any error. */
  transaction<T>(fn: (store: WebStore) => Promise<T>): Promise<T>;
  createLoginAttempt(attempt: { stateHash: string; nonceHash: string; verifier: string }): Promise<void>;
  /** Through `studio_consume_login_attempt`: deletes it and returns it only if it had not expired. */
  consumeLoginAttempt(stateHash: string): Promise<{ nonceHash: string; verifier: string } | null>;
  findUserByEmail(email: string): Promise<StudioUserRow | null>;
  activeOwnerExists(): Promise<boolean>;
  /** The bootstrap owner (design §7.2); the schema's trigger refuses it once an owner exists. */
  createBootstrapOwner(owner: { email: string; sub: string; displayName: string | null }): Promise<StudioUserRow>;
  /** Sets `google_sub` only where it is still null; true when this call set it. */
  setGoogleSub(userId: string, sub: string): Promise<boolean>;
  createSession(session: {
    idHash: string; userId: string; csrfHash: string; createdAt: Date; idleExpiresAt: Date; absoluteExpiresAt: Date;
  }): Promise<void>;
  /** The session and its live users row, exactly as stored. */
  findSession(idHash: string): Promise<SessionRow | null>;
  touchSession(idHash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revokeSession(idHash: string, at: Date): Promise<void>;
  audit(entry: AuditEntry): Promise<void>;
  /**
   * Deletes login attempts that expired before `attemptsExpiredBefore`, and sessions that ended — expired (idle
   * or absolute) or were revoked — before `sessionsEndedBefore`; and (S6.2) preflight requests past their 30
   * days on which no consumed quote depends (`preflightPurgeable`, design §4.7).
   */
  purge(attemptsExpiredBefore: Date, sessionsEndedBefore: Date): Promise<PurgeResult>;
  health(): Promise<WebHealth>;

  // --- Content Studio S5: read-only. Every argument was validated by the caller (`runs.ts`); every query binds it.
  /** Live (not deleted) runs, newest first, filtered; at most `limit` rows from `offset`. */
  listRuns(filters: Omit<RunFilters, "page">, limit: number, offset: number): Promise<RunListRow[]>;
  /** One run as stored, its tombstone included (`runVisible` decides), or null when there is none. */
  findRun(id: string): Promise<RunRow | null>;
  runLineage(run: Pick<RunRow, "id" | "source_run_id">): Promise<RunLineage>;
  listArtifacts(runId: string): Promise<ArtifactMeta[]>;
  readArtifact(runId: string, name: string): Promise<StoredArtifact | null>;
  /** The worker's rows (S5's derivation), in the panel's order. The web derives none of them. */
  listFindings(runId: string): Promise<FindingRow[]>;
  listRequests(runId: string): Promise<RequestRow[]>;

  // --- Content Studio S6.2: the actions. The decisions are `actions.ts`'s; the store reads and writes.
  /** The database's clock, the heartbeat, the active fact version and the owner's caps. */
  actionContext(): Promise<ActionContext>;
  /** §6.1 step 1: the preflight job and its request, in ONE transaction. */
  createPreflightRequest(input: PreflightRequestInput): Promise<{ requestId: string; jobId: string }>;
  findPreflightRequest(id: string): Promise<PreflightView | null>;
  /** §6.1 step 4: `decideConfirm` under the settings-row lock, then the run, the consumption, the reservation and the job. */
  confirmQuote(input: { quoteId: string; userId: string; ceilings: DeploymentCeilings }, hooks?: ConfirmHooks): Promise<ConfirmResult>;
  /** §5.3: `decideCancel` under the job's and the run's row locks, then the cancellation. */
  cancelRun(input: { runId: string; user: { id: string; role: string; status: string } }): Promise<CancelResult>;
  /** §6.3: a fake run, owner only. */
  createFakeRun(input: { ownerId: string; goal: string; platforms: string[]; scopeTags: string[] | null;
    factVersionId: string | null }): Promise<{ runId: string; jobId: string }>;
  acknowledgeOverrun(input: { runId: string; ownerId: string }): Promise<boolean>;
  /** §6.4: spend for `day` (America/New_York) and its month, per user, and every overrun. */
  spendView(day: string): Promise<SpendView>;

  // --- Content Studio S7.2: fact versions and imports. Every owner edit runs in ONE transaction that first
  // declares its actor (`declareActor`, `SET LOCAL studio.actor`); the schema refuses a non-owner too.
  /** §8.5: the staged bytes, their fact check and its job, in ONE transaction; refused while another check is pending. */
  stageFactUpload(input: { ownerId: string; content: Buffer; sha256: string }): Promise<StageResult>;
  findFactCheck(id: string): Promise<FactCheckView | null>;
  /** Every version, newest first, with which is active; never a version's bytes. */
  listFactVersions(): Promise<FactVersionListRow[]>;
  /** A version's exact bytes (the route is the owner's alone). */
  readFactVersion(id: string): Promise<{ sha256: string; content: Buffer } | null>;
  /** Points the settings at a version (the schema refuses a retired one). */
  activateFactVersion(input: { ownerId: string; versionId: string }): Promise<EditResult>;
  /** Retires or restores a version (the schema refuses retiring the active one). */
  setFactVersionStatus(input: { ownerId: string; versionId: string; status: "active" | "retired" }): Promise<EditResult>;
  /** §8.6: the import's run, its files and its import job, in ONE transaction, with its lineage when exactly one import matches. */
  createImport(input: { ownerId: string; runner: "live" | "fake"; files: readonly BundleFile[];
    lineage: { runMeta: Buffer; roundOneCritic: Buffer } | null }): Promise<{ runId: string; jobId: string; sourceRunId: string | null }>;
}

export interface PurgeResult { loginAttempts: number; sessions: number; preflightRequests: number; factChecks: number }

export type EditResult = { ok: true } | ({ ok: false } & Refusal);
export type StageResult = { ok: true; checkId: string; jobId: string } | ({ ok: false } & Refusal);

export interface FactVersionListRow {
  id: string; sha256: string; byteLength: number; recordCount: number; tagCounts: Record<string, number>; uploadedAt: Date;
  uploaderName: string | null; status: "active" | "retired"; isActive: boolean; statusChangedAt: Date | null;
}

export interface FactCheckView {
  id: string; jobState: string; requestedBy: string; sha256: string; byteLength: number; createdAt: Date;
  outcome: "accepted" | "refused" | null; refusalClass: string | null; refusalMessage: string | null; unknownFields: string[] | null;
  /** The accepted bytes' version (by sha256), when it still exists. */
  version: { id: string; recordCount: number; tagCounts: Record<string, number>; status: string } | null;
  /** From the worker's audit row of the outcome: whether the bytes were already a version, and whether the upload is over the pack's cap. */
  existing: boolean; overCap: boolean;
}

/** The worker's heartbeat row, as the web reads it (design §3.3, §4.6). */
export interface HeartbeatRow {
  commit: string;
  approvedFactsSha256: string;
  priceTableSha256: string;
  /** Per tag, how many approved-facts records carry it (the worker computes them). */
  tagCounts: Record<string, number>;
  beatAtMs: number;
}

export interface FactVersionRow { id: string; sha256: string; recordCount: number; tagCounts: Record<string, number>; uploadedAt: Date }

/** What every action screen reads: the database's clock, the heartbeat, the active fact version and the owner's caps. */
export interface ActionContext {
  nowMs: number;
  heartbeat: HeartbeatRow | null;
  activeFactVersion: FactVersionRow | null;
  settings: { dailyCapMicros: number; monthlyCapMicros: number } | null;
}

export interface QuoteView {
  id: string; userId: string; action: string; ceilingUsd: string; ceilingMicros: number; breakdown: unknown;
  createdAt: Date; expiresAt: Date; consumedAt: Date | null; runId: string | null;
}

export interface PreflightView {
  id: string; jobId: string; jobState: string; userId: string; action: string; goal: string | null; platforms: string[];
  scopeTags: string[] | null; sourceRunId: string | null; factVersionId: string; createdAt: Date;
  outcome: "quoted" | "refused" | null; refusalClass: string | null; refusalMessage: string | null; revisePlan: unknown;
  quote: QuoteView | null;
}

export type ConfirmResult = { ok: true; runId: string } | ({ ok: false } & Refusal);
export type CancelResult = { ok: true; kind: "queued" | "running" } | ({ ok: false } & Refusal);

export interface SpendView {
  day: string; month: string; dayMicros: number; monthMicros: number;
  settings: { dailyCapMicros: number; monthlyCapMicros: number } | null;
  users: Array<{ id: string; name: string | null; role: string; status: string; dailyCapMicros: number | null; dayMicros: number; monthMicros: number }>;
  overruns: Array<{ runId: string; amountMicros: number; day: string; requestedBy: string; acknowledged: boolean }>;
}

/** Test-only seams of the confirmation transaction (the concurrency check holds a confirmation open). */
export interface ConfirmHooks { beforeCommit?: () => Promise<void> }


const countsOf = (value: unknown): Record<string, number> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isSafeInteger(entry[1]) && entry[1] >= 0));
};

const RUN_LIST_COLUMNS = `r.id::text AS id, r.kind, r.state, r.runner, r.goal, r.verdict, r.blocking_findings,
  r.advisory_findings, r.actual_usd::text AS actual_usd, r.import_tier, r.created_at, r.requested_by::text AS requested_by,
  u.display_name AS requester_name`;
const RUN_COLUMNS = `${RUN_LIST_COLUMNS}, r.source_run_id::text AS source_run_id, r.platforms, r.scope_tags,
  r.fact_version_id::text AS fact_version_id, r.approved_facts_sha256, r.automotive_facts_sha256, r.evidence_pack_sha256,
  r.code_commit, r.reserved_usd::text AS reserved_usd, r.owner_item_findings, r.failure_class, r.failure_message,
  r.started_at, r.finished_at, r.deleted_at`;

const runListRow = (row: Record<string, unknown>): RunListRow => ({
  id: String(row.id), kind: String(row.kind), state: String(row.state), runner: String(row.runner),
  goal: row.goal === null ? null : String(row.goal), verdict: row.verdict === null ? null : String(row.verdict),
  blocking_findings: row.blocking_findings === null ? null : Number(row.blocking_findings),
  advisory_findings: row.advisory_findings === null ? null : Number(row.advisory_findings),
  actual_usd: row.actual_usd === null ? null : String(row.actual_usd),
  import_tier: row.import_tier === null ? null : String(row.import_tier),
  created_at: row.created_at as Date, requested_by: String(row.requested_by),
  requester_name: row.requester_name === null ? null : String(row.requester_name),
});
const textOrNull = (value: unknown) => (value === null || value === undefined ? null : String(value));

export type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

const USER_COLUMNS = "id::text AS id, email, google_sub, display_name, role, status";

function userRow(row: Record<string, unknown>): StudioUserRow {
  return {
    id: String(row.id),
    email: String(row.email),
    google_sub: row.google_sub === null ? null : String(row.google_sub),
    display_name: row.display_name === null ? null : String(row.display_name),
    role: String(row.role) as Role,
    status: String(row.status) as StudioUserRow["status"],
  };
}

/** A user id as PostgreSQL prints a uuid: the only text `declareActor` ever puts in its statement. */
const ACTOR_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Content Studio S7.2 — THE ONE place the web declares an owner edit's actor
 * (migration 0004): `SET LOCAL studio.actor`, inside the edit's own
 * transaction, so it ends with that transaction and a later edit on the same
 * pooled connection can never inherit it. A value that is not a user id is
 * refused before any statement. The offline suite holds every Studio source to
 * this (`SA131`: the actor is never set for the session, by SET or by set_config).
 */
export async function declareActor(db: Queryable, actorId: string): Promise<void> {
  if (!ACTOR_SHAPE.test(actorId)) throw new Error("declareActor: the actor must be a user id");
  await db.query(`SET LOCAL studio.actor = '${actorId}'`);
}

/** The Studio database, through a pool (or, inside a transaction, one client). */
export class PgWebStore implements WebStore {
  constructor(private readonly db: Queryable, private readonly pool: pg.Pool | null = null) {}

  async transaction<T>(fn: (store: WebStore) => Promise<T>): Promise<T> {
    if (!this.pool) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgWebStore(client, null));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async createLoginAttempt(attempt: { stateHash: string; nonceHash: string; verifier: string }): Promise<void> {
    await this.db.query(
      "INSERT INTO studio_login_attempts (state_hash, nonce_hash, pkce_verifier) VALUES ($1, $2, $3)",
      [attempt.stateHash, attempt.nonceHash, attempt.verifier]);
  }

  async consumeLoginAttempt(stateHash: string): Promise<{ nonceHash: string; verifier: string } | null> {
    const { rows } = await this.db.query(
      "SELECT nonce_hash, pkce_verifier FROM studio_consume_login_attempt($1)", [stateHash]);
    if (rows.length !== 1) return null;
    return { nonceHash: String(rows[0]!.nonce_hash), verifier: String(rows[0]!.pkce_verifier) };
  }

  async findUserByEmail(email: string): Promise<StudioUserRow | null> {
    const { rows } = await this.db.query(`SELECT ${USER_COLUMNS} FROM studio_users WHERE email = $1`, [email]);
    return rows.length === 1 ? userRow(rows[0]!) : null;
  }

  async activeOwnerExists(): Promise<boolean> {
    const { rows } = await this.db.query(
      "SELECT EXISTS (SELECT 1 FROM studio_users WHERE role = 'owner' AND status = 'active') AS present");
    return rows[0]?.present === true;
  }

  async createBootstrapOwner(owner: { email: string; sub: string; displayName: string | null }): Promise<StudioUserRow> {
    const { rows } = await this.db.query(
      `INSERT INTO studio_users (email, google_sub, display_name, role, status, created_by)
       VALUES ($1, $2, $3, 'owner', 'active', NULL) RETURNING ${USER_COLUMNS}`,
      [owner.email, owner.sub, owner.displayName]);
    return userRow(rows[0]!);
  }

  async setGoogleSub(userId: string, sub: string): Promise<boolean> {
    const { rows } = await this.db.query(
      "UPDATE studio_users SET google_sub = $2 WHERE id = $1::uuid AND google_sub IS NULL RETURNING id", [userId, sub]);
    return rows.length === 1;
  }

  async createSession(session: {
    idHash: string; userId: string; csrfHash: string; createdAt: Date; idleExpiresAt: Date; absoluteExpiresAt: Date;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO studio_sessions (id_hash, user_id, csrf_token_hash, created_at, last_seen_at, idle_expires_at,
                                    absolute_expires_at)
       VALUES ($1, $2::uuid, $3, $4, $4, $5, $6)`,
      [session.idHash, session.userId, session.csrfHash, session.createdAt, session.idleExpiresAt, session.absoluteExpiresAt]);
  }

  async findSession(idHash: string): Promise<SessionRow | null> {
    const { rows } = await this.db.query(
      `SELECT s.id_hash, s.csrf_token_hash, s.created_at, s.last_seen_at, s.idle_expires_at, s.absolute_expires_at,
              s.revoked_at, u.id::text AS id, u.email, u.google_sub, u.display_name, u.role, u.status
         FROM studio_sessions s JOIN studio_users u ON u.id = s.user_id
        WHERE s.id_hash = $1`,
      [idHash]);
    if (rows.length !== 1) return null;
    const row = rows[0]!;
    return {
      id_hash: String(row.id_hash),
      csrf_token_hash: String(row.csrf_token_hash),
      created_at: row.created_at as Date,
      last_seen_at: row.last_seen_at as Date,
      idle_expires_at: row.idle_expires_at as Date,
      absolute_expires_at: row.absolute_expires_at as Date,
      revoked_at: (row.revoked_at as Date | null) ?? null,
      user: userRow(row),
    };
  }

  async touchSession(idHash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    // A revoked session never changes (the schema's guard), so only a live one is touched.
    await this.db.query(
      "UPDATE studio_sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id_hash = $1 AND revoked_at IS NULL",
      [idHash, lastSeenAt, idleExpiresAt]);
  }

  async revokeSession(idHash: string, at: Date): Promise<void> {
    await this.db.query("UPDATE studio_sessions SET revoked_at = $2 WHERE id_hash = $1 AND revoked_at IS NULL", [idHash, at]);
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
      [entry.actorUserId, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.detail)]);
  }

  async purge(attemptsExpiredBefore: Date, sessionsEndedBefore: Date): Promise<PurgeResult> {
    const attempts = await this.db.query("DELETE FROM studio_login_attempts WHERE expires_at <= $1", [attemptsExpiredBefore]);
    const sessions = await this.db.query(
      `DELETE FROM studio_sessions
        WHERE absolute_expires_at <= $1 OR idle_expires_at <= $1 OR (revoked_at IS NOT NULL AND revoked_at <= $1)`,
      [sessionsEndedBefore]);
    // S6.2 (design §4.7): preflight requests past their 30 days, by the database's own clock, on which no
    // consumed quote depends. Migration 0003's trigger refuses any other deletion. A request whose quote was
    // consumed is kept for ever, so the query leaves it out — otherwise a thousand of them would fill every
    // pass's window — and `preflightPurgeable` decides each candidate again.
    const candidates = (await this.db.query(
      `SELECT r.id::text AS id, r.created_at <= now() - interval '30 days' AS past,
              EXISTS (SELECT 1 FROM studio_quotes q WHERE q.id = r.quote_id AND q.consumed_at IS NOT NULL) AS consumed
         FROM studio_preflight_requests r
        WHERE r.created_at <= now() - interval '30 days'
          AND NOT EXISTS (SELECT 1 FROM studio_quotes q WHERE q.id = r.quote_id AND q.consumed_at IS NOT NULL)
        ORDER BY r.created_at, r.id LIMIT 1000`)).rows;
    const ids = candidates.filter((c) => preflightPurgeable({ pastRetention: c.past === true, quoteConsumed: c.consumed === true }))
      .map((c) => String(c.id));
    const requests = ids.length
      ? (await this.db.query("DELETE FROM studio_preflight_requests WHERE id = ANY($1::uuid[])", [ids])).rowCount ?? 0 : 0;
    // S7.2 (design §4.7): fact checks older than 30 days, by the database's own clock — migration 0004's rule,
    // whose trigger refuses any younger deletion.
    const checks = await this.db.query("DELETE FROM studio_fact_checks WHERE created_at <= now() - interval '30 days'");
    return { loginAttempts: attempts.rowCount ?? 0, sessions: sessions.rowCount ?? 0, preflightRequests: requests,
      factChecks: checks.rowCount ?? 0 };
  }

  async listRuns(filters: Omit<RunFilters, "page">, limit: number, offset: number): Promise<RunListRow[]> {
    const { rows } = await this.db.query(
      `SELECT ${RUN_LIST_COLUMNS} FROM studio_runs r JOIN studio_users u ON u.id = r.requested_by
        WHERE r.deleted_at IS NULL AND ($1::text IS NULL OR r.state = $1) AND ($2::text IS NULL OR r.kind = $2)
          AND ($3::uuid IS NULL OR r.requested_by = $3::uuid)
        ORDER BY r.created_at DESC, r.id DESC LIMIT $4 OFFSET $5`,
      [filters.state, filters.kind, filters.requester, limit, offset]);
    return rows.map(runListRow);
  }

  async findRun(id: string): Promise<RunRow | null> {
    const { rows } = await this.db.query(
      `SELECT ${RUN_COLUMNS} FROM studio_runs r JOIN studio_users u ON u.id = r.requested_by
        WHERE r.id = $1::uuid`, [id]);
    if (rows.length !== 1) return null;
    const row = rows[0]!;
    return {
      ...runListRow(row),
      source_run_id: textOrNull(row.source_run_id), platforms: (row.platforms as string[] | null) ?? null,
      scope_tags: (row.scope_tags as string[] | null) ?? null, fact_version_id: textOrNull(row.fact_version_id),
      approved_facts_sha256: textOrNull(row.approved_facts_sha256), automotive_facts_sha256: textOrNull(row.automotive_facts_sha256),
      evidence_pack_sha256: textOrNull(row.evidence_pack_sha256), code_commit: textOrNull(row.code_commit),
      reserved_usd: textOrNull(row.reserved_usd),
      owner_item_findings: row.owner_item_findings === null ? null : Number(row.owner_item_findings),
      failure_class: textOrNull(row.failure_class), failure_message: textOrNull(row.failure_message),
      started_at: (row.started_at as Date | null) ?? null, finished_at: (row.finished_at as Date | null) ?? null,
      deleted_at: (row.deleted_at as Date | null) ?? null,
    };
  }

  async runLineage(run: Pick<RunRow, "id" | "source_run_id">): Promise<RunLineage> {
    const parent = run.source_run_id === null ? [] : (await this.db.query(
      "SELECT id::text AS id, deleted_at IS NOT NULL AS deleted FROM studio_runs WHERE id = $1::uuid", [run.source_run_id])).rows;
    const children = (await this.db.query(
      `SELECT id::text AS id, kind, state FROM studio_runs WHERE source_run_id = $1::uuid AND deleted_at IS NULL
        ORDER BY created_at, id`, [run.id])).rows;
    return {
      parent: parent.length === 1 ? { id: String(parent[0]!.id), deleted: parent[0]!.deleted === true } : null,
      children: children.map((c) => ({ id: String(c.id), kind: String(c.kind), state: String(c.state) })),
    };
  }

  async listArtifacts(runId: string): Promise<ArtifactMeta[]> {
    const { rows } = await this.db.query(
      "SELECT name, sha256, byte_length FROM studio_run_artifacts WHERE run_id = $1::uuid ORDER BY name", [runId]);
    return rows.map((r) => ({ name: String(r.name), sha256: String(r.sha256), byte_length: Number(r.byte_length) }));
  }

  async readArtifact(runId: string, name: string): Promise<StoredArtifact | null> {
    const { rows } = await this.db.query(
      "SELECT name, content, sha256, byte_length FROM studio_run_artifacts WHERE run_id = $1::uuid AND name = $2", [runId, name]);
    if (rows.length !== 1) return null;
    const r = rows[0]!;
    return { name: String(r.name), content: r.content as Buffer, sha256: String(r.sha256), byte_length: Number(r.byte_length) };
  }

  async listFindings(runId: string): Promise<FindingRow[]> {
    const { rows } = await this.db.query(
      `SELECT idx, lens, severity, category, owner, issue, owner_item FROM studio_findings WHERE run_id = $1::uuid
        ORDER BY idx`, [runId]);
    return rows.map((r) => ({
      idx: Number(r.idx), lens: String(r.lens), severity: String(r.severity), category: String(r.category),
      owner: String(r.owner), issue: String(r.issue), owner_item: r.owner_item === true,
    }));
  }

  async listRequests(runId: string): Promise<RequestRow[]> {
    const { rows } = await this.db.query(
      `SELECT seq, stage, lens, model, ceiling_usd::text AS ceiling_usd, input_tokens, output_tokens,
              cost_usd::text AS cost_usd, charged_usd::text AS charged_usd, outcome
         FROM studio_run_requests WHERE run_id = $1::uuid ORDER BY seq`, [runId]);
    return rows.map((r) => ({
      seq: Number(r.seq), stage: String(r.stage), lens: textOrNull(r.lens), model: String(r.model),
      ceiling_usd: String(r.ceiling_usd), input_tokens: r.input_tokens === null ? null : Number(r.input_tokens),
      output_tokens: r.output_tokens === null ? null : Number(r.output_tokens), cost_usd: textOrNull(r.cost_usd),
      charged_usd: String(r.charged_usd), outcome: String(r.outcome),
    }));
  }

  async health(): Promise<WebHealth> {
    const { rows } = await this.db.query(
      `SELECT (SELECT name FROM studio_schema_migrations ORDER BY name DESC LIMIT 1) AS schema_version,
              (SELECT EXTRACT(EPOCH FROM (now() - beat_at))::float8 FROM studio_worker_heartbeat WHERE singleton) AS age`);
    const age = rows[0]?.age;
    return {
      schemaVersion: rows[0]?.schema_version === null || rows[0]?.schema_version === undefined ? null : String(rows[0].schema_version),
      workerHeartbeatAgeSeconds: typeof age === "number" && Number.isFinite(age) ? Math.max(0, Math.round(age)) : null,
    };
  }

  // --- Content Studio S6.2 -----------------------------------------------------------------------

  /**
   * `fn` in ONE transaction on one pooled client: committed when it asks to,
   * rolled back when it refuses or throws. Inside `transaction()` (no pool) it
   * runs in the caller's transaction.
   */
  private async atomically<T>(fn: (db: Queryable) => Promise<{ result: T; commit: boolean }>): Promise<T> {
    if (!this.pool) return (await fn(this.db)).result;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { result, commit } = await fn(client);
      await client.query(commit ? "COMMIT" : "ROLLBACK");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }


  /**
   * §6.1 step 4, in ONE transaction that first takes `SELECT … FOR UPDATE` on
   * the settings row, which serializes every confirmation: two confirmations
   * against the same headroom cannot both pass the caps. Everything the
   * decision reads is read after that lock; then the run, the quote's
   * consumption, the reserve entry, the paid job and the audit row are
   * written, and committed together — or nothing is.
   */
  async confirmQuote(input: { quoteId: string; userId: string; ceilings: DeploymentCeilings }, hooks: ConfirmHooks = {}):
    Promise<ConfirmResult> {
    return this.atomically<ConfirmResult>(async (db) => {
      // 1. the lock that serializes every confirmation
      const settings = (await db.query(
        `SELECT daily_cap_usd::text AS daily, monthly_cap_usd::text AS monthly, active_fact_version_id::text AS active
           FROM studio_settings WHERE singleton FOR UPDATE`)).rows[0];
      const nowMs = Number((await db.query("SELECT (extract(epoch FROM now()) * 1000)::float8 AS now")).rows[0]!.now);
      const user = (await db.query(
        `SELECT id::text AS id, role, status, daily_cap_usd::text AS cap, (extract(epoch FROM updated_at) * 1000)::float8 AS updated
           FROM studio_users WHERE id = $1::uuid`, [input.userId])).rows[0];
      const quote = (await db.query(
        `SELECT q.id::text AS id, q.user_id::text AS user_id, q.action, q.params_sha256, q.worker_commit, q.approved_facts_sha256,
                q.fact_version_id::text AS fact_version_id, q.price_table_sha256, q.ceiling_usd::text AS ceiling,
                (extract(epoch FROM q.created_at) * 1000)::float8 AS created, (extract(epoch FROM q.expires_at) * 1000)::float8 AS expires,
                q.consumed_at IS NOT NULL AS consumed, v.sha256 AS fact_sha
           FROM studio_quotes q LEFT JOIN studio_fact_versions v ON v.id = q.fact_version_id
          WHERE q.id = $1::uuid FOR UPDATE OF q`, [input.quoteId])).rows[0];
      const request = quote ? (await db.query(
        `SELECT action, goal, platforms, scope_tags, source_run_id::text AS source_run_id, fact_version_id::text AS fact_version_id,
                params_sha256 FROM studio_preflight_requests WHERE quote_id = $1::uuid`, [quote.id])).rows[0] : undefined;
      const source = request?.source_run_id ? (await db.query(
        `SELECT goal, fact_version_id::text AS fact_version_id, deleted_at IS NOT NULL AS deleted FROM studio_runs WHERE id = $1::uuid`,
        [request.source_run_id])).rows[0] : undefined;
      const beat = (await db.query(
        `SELECT commit, approved_facts_sha256, price_table_sha256, (extract(epoch FROM beat_at) * 1000)::float8 AS beat
           FROM studio_worker_heartbeat WHERE singleton`)).rows[0];
      const overruns = (await db.query(UNACKNOWLEDGED_OVERRUNS_SQL)).rows[0]?.n;
      const day = localDay(nowMs);
      const spend = (await db.query(
        `SELECT studio_spend_for_day($1::date)::text AS day, studio_spend_for_month($1::date)::text AS month,
                (SELECT COALESCE(SUM(CASE l.entry WHEN 'release' THEN -l.amount_usd ELSE l.amount_usd END), 0)::text
                   FROM studio_spend_ledger l JOIN studio_runs r ON r.id = l.run_id
                  WHERE r.requested_by = $2::uuid AND l.day_local = $1::date) AS user_day`, [day, input.userId])).rows[0]!;
      const derived = request !== undefined && request.source_run_id !== null;
      const decision = decideConfirm({
        nowMs,
        user: user ? { id: user.id, role: user.role, status: user.status, dailyCapMicros: numericToMicros(user.cap),
          updatedAtMs: Number(user.updated) } : null,
        quote: quote ? { id: quote.id, userId: quote.user_id, action: quote.action, paramsSha256: quote.params_sha256,
          workerCommit: quote.worker_commit, approvedFactsSha256: quote.approved_facts_sha256, factVersionId: quote.fact_version_id,
          priceTableSha256: quote.price_table_sha256, ceilingMicros: numericToMicros(quote.ceiling)!, createdAtMs: Number(quote.created),
          expiresAtMs: Number(quote.expires), consumed: quote.consumed === true } : null,
        request: request ? { action: request.action, paramsSha256: request.params_sha256, factVersionId: request.fact_version_id,
          sourceRunId: request.source_run_id } : null,
        sourceAvailable: source !== undefined && source.deleted !== true,
        heartbeat: beat ? { commit: beat.commit, approvedFactsSha256: beat.approved_facts_sha256,
          priceTableSha256: beat.price_table_sha256, beatAtMs: Number(beat.beat) } : null,
        currentFactVersionId: derived ? (source && source.deleted !== true ? source.fact_version_id : null) : (settings?.active ?? null),
        settings: settings ? { dailyCapMicros: numericToMicros(settings.daily) ?? 0, monthlyCapMicros: numericToMicros(settings.monthly) ?? 0 } : null,
        ceilings: input.ceilings,
        spend: { dayMicros: numericToMicros(spend.day) ?? 0, monthMicros: numericToMicros(spend.month) ?? 0,
          userDayMicros: numericToMicros(spend.user_day) ?? 0 },
        unacknowledgedOverruns: typeof overruns === "number" ? overruns : 1,
      });
      if (!decision.ok) return { result: decision, commit: false };
      // 2. the run, the quote's consumption, the reservation and the job — together
      const runId = String((await db.query(
        `INSERT INTO studio_runs (kind, requested_by, runner, goal, platforms, scope_tags, fact_version_id, automotive_facts_sha256,
                                  source_run_id, quote_id, reserved_usd)
         VALUES ($1, $2::uuid, 'live', $3, $4, $5, $6::uuid, $7, $8::uuid, $9::uuid, $10) RETURNING id::text AS id`,
        [quote.action, input.userId, derived ? source.goal : request.goal, request.platforms, request.scope_tags,
          quote.fact_version_id, quote.fact_sha, request.source_run_id, quote.id, quote.ceiling])).rows[0]!.id);
      await db.query("UPDATE studio_quotes SET consumed_at = now() WHERE id = $1::uuid AND consumed_at IS NULL", [quote.id]);
      await db.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('reserve', $1::uuid, $2)", [runId, quote.ceiling]);
      await db.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1::uuid, 'paid')", [runId]);
      await db.query(
        `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail) VALUES ($1::uuid, 'run.confirm', 'studio_runs', $2, $3::jsonb)`,
        [input.userId, runId, JSON.stringify({ kind: quote.action, quote: quote.id })]);
      await hooks.beforeCommit?.();
      return { result: { ok: true, runId }, commit: true };
    });
  }

  /**
   * Cancellation (design §5.3), in one transaction that locks the run's job,
   * then its run — the order the worker's claim takes them — so a cancel and a
   * claim cannot both win. A queued job is cancelled before it is claimed, its
   * run ends `cancelled` and a live run's whole reservation is released; a
   * running job's cancellation is requested, and the worker stops before its
   * next request.
   */
  async cancelRun(input: { runId: string; user: { id: string; role: string; status: string } }): Promise<CancelResult> {
    return this.atomically<CancelResult>(async (db) => {
      const job = (await db.query(
        `SELECT id::text AS id, state, cancel_requested_at IS NOT NULL AS cancel FROM studio_jobs WHERE run_id = $1::uuid FOR UPDATE`,
        [input.runId])).rows[0];
      const run = (await db.query(
        `SELECT id::text AS id, requested_by::text AS requested_by, state, runner, kind, reserved_usd::text AS reserved,
                deleted_at IS NOT NULL AS deleted FROM studio_runs WHERE id = $1::uuid FOR UPDATE`, [input.runId])).rows[0];
      const plan = decideCancel(input.user, {
        run: run ? { id: run.id, requestedBy: run.requested_by, state: run.state, runner: run.runner, kind: run.kind,
          reservedMicros: numericToMicros(run.reserved), deleted: run.deleted === true } : null,
        job: job ? { state: job.state, cancelRequested: job.cancel === true } : null,
      });
      if (!plan.ok) return { result: plan, commit: false };
      if (plan.kind === "queued") {
        await db.query("UPDATE studio_jobs SET state = 'cancelled', cancel_requested_at = now() WHERE id = $1::uuid", [job.id]);
        await db.query(
          `UPDATE studio_runs SET state = 'cancelled', failure_class = 'job_cancelled',
                  failure_message = 'the job was cancelled before it was claimed', finished_at = now(),
                  actual_usd = CASE WHEN runner = 'live' THEN 0 ELSE NULL END
            WHERE id = $1::uuid`, [run.id]);
        if (plan.releaseMicros !== null) {
          await db.query("INSERT INTO studio_spend_ledger (entry, run_id, amount_usd) VALUES ('release', $1::uuid, $2)",
            [run.id, microsToNumeric(plan.releaseMicros)]);
        }
      } else {
        await db.query("UPDATE studio_jobs SET cancel_requested_at = now() WHERE id = $1::uuid", [job.id]);
      }
      await db.query(
        `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail) VALUES ($1::uuid, 'run.cancel', 'studio_runs', $2, $3::jsonb)`,
        [input.user.id, run.id, JSON.stringify({ was: plan.kind })]);
      return { result: { ok: true, kind: plan.kind }, commit: true };
    });
  }

  async actionContext(): Promise<ActionContext> {
    const { rows } = await this.db.query(
      `SELECT (extract(epoch FROM now()) * 1000)::float8 AS now,
              s.daily_cap_usd::text AS daily, s.monthly_cap_usd::text AS monthly,
              v.id::text AS v_id, v.sha256 AS v_sha, v.record_count AS v_records, v.tag_counts AS v_tags, v.uploaded_at AS v_at,
              h.commit AS h_commit, h.approved_facts_sha256 AS h_approved, h.price_table_sha256 AS h_price,
              h.approved_facts_tag_counts AS h_tags, (extract(epoch FROM h.beat_at) * 1000)::float8 AS h_beat
         FROM (SELECT 1) one
         LEFT JOIN studio_settings s ON s.singleton
         LEFT JOIN studio_fact_versions v ON v.id = s.active_fact_version_id AND v.status = 'active'
         LEFT JOIN studio_worker_heartbeat h ON h.singleton`);
    const r = rows[0]!;
    return {
      nowMs: Number(r.now),
      settings: r.daily === null ? null : { dailyCapMicros: numericToMicros(r.daily) ?? 0, monthlyCapMicros: numericToMicros(r.monthly) ?? 0 },
      activeFactVersion: r.v_id === null ? null : { id: r.v_id, sha256: r.v_sha, recordCount: Number(r.v_records),
        tagCounts: countsOf(r.v_tags), uploadedAt: r.v_at },
      heartbeat: r.h_commit === null ? null : { commit: r.h_commit, approvedFactsSha256: r.h_approved, priceTableSha256: r.h_price,
        tagCounts: countsOf(r.h_tags), beatAtMs: Number(r.h_beat) },
    };
  }

  /** §6.1 step 1: the preflight job and its request, in ONE transaction, with an audit row of classes only. */
  async createPreflightRequest(input: PreflightRequestInput): Promise<{ requestId: string; jobId: string }> {
    return this.atomically(async (db) => {
      const jobId = String((await db.query("INSERT INTO studio_jobs (kind) VALUES ('preflight') RETURNING id::text AS id")).rows[0]!.id);
      const requestId = String((await db.query(
        `INSERT INTO studio_preflight_requests (job_id, user_id, action, goal, platforms, scope_tags, source_run_id, fact_version_id,
                                                params_sha256)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::uuid, $9) RETURNING id::text AS id`,
        [jobId, input.userId, input.action, input.goal, input.platforms, input.scopeTags, input.sourceRunId, input.factVersionId,
          input.paramsSha256])).rows[0]!.id);
      await db.query(
        `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
         VALUES ($1::uuid, 'preflight.request', 'studio_preflight_requests', $2, $3::jsonb)`,
        [input.userId, requestId, JSON.stringify({ action: input.action })]);
      return { result: { requestId, jobId }, commit: true };
    });
  }

  async findPreflightRequest(id: string): Promise<PreflightView | null> {
    const { rows } = await this.db.query(
      `SELECT r.id::text AS id, r.job_id::text AS job_id, j.state AS job_state, r.user_id::text AS user_id, r.action, r.goal, r.platforms,
              r.scope_tags, r.source_run_id::text AS source_run_id, r.fact_version_id::text AS fact_version_id, r.created_at,
              r.outcome, r.refusal_class, r.refusal_message, r.revise_plan,
              q.id::text AS q_id, q.user_id::text AS q_user, q.action AS q_action, q.ceiling_usd::text AS q_ceiling, q.breakdown AS q_breakdown,
              q.created_at AS q_created, q.expires_at AS q_expires, q.consumed_at AS q_consumed, run.id::text AS q_run
         FROM studio_preflight_requests r JOIN studio_jobs j ON j.id = r.job_id
         LEFT JOIN studio_quotes q ON q.id = r.quote_id
         LEFT JOIN studio_runs run ON run.quote_id = q.id
        WHERE r.id = $1::uuid`, [id]);
    if (rows.length !== 1) return null;
    const r = rows[0]!;
    return {
      id: r.id, jobId: r.job_id, jobState: r.job_state, userId: r.user_id, action: r.action, goal: r.goal, platforms: r.platforms,
      scopeTags: r.scope_tags, sourceRunId: r.source_run_id, factVersionId: r.fact_version_id, createdAt: r.created_at,
      outcome: r.outcome, refusalClass: r.refusal_class, refusalMessage: r.refusal_message, revisePlan: r.revise_plan,
      quote: r.q_id === null ? null : {
        id: r.q_id, userId: r.q_user, action: r.q_action, ceilingUsd: r.q_ceiling, ceilingMicros: numericToMicros(r.q_ceiling)!,
        breakdown: r.q_breakdown, createdAt: r.q_created, expiresAt: r.q_expires, consumedAt: r.q_consumed, runId: r.q_run,
      },
    };
  }

  /** §6.3: a fake run — owner only (the schema's trigger refuses anyone else too), no quote, no reservation. */
  async createFakeRun(input: { ownerId: string; goal: string; platforms: string[]; scopeTags: string[] | null;
    factVersionId: string | null }): Promise<{ runId: string; jobId: string }> {
    return this.atomically(async (db) => {
      const runId = String((await db.query(
        `INSERT INTO studio_runs (kind, requested_by, runner, goal, platforms, scope_tags, fact_version_id, automotive_facts_sha256)
         SELECT 'full', $1::uuid, 'fake', $2, $3, $4, v.id, v.sha256
           FROM (SELECT 1) one LEFT JOIN studio_fact_versions v ON v.id = $5::uuid
         RETURNING id::text AS id`,
        [input.ownerId, input.goal, input.platforms, input.scopeTags, input.factVersionId])).rows[0]!.id);
      const jobId = String((await db.query("INSERT INTO studio_jobs (run_id, kind) VALUES ($1::uuid, 'fake') RETURNING id::text AS id", [runId])).rows[0]!.id);
      await db.query(
        `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail) VALUES ($1::uuid, 'run.fake', 'studio_runs', $2, '{}'::jsonb)`,
        [input.ownerId, runId]);
      return { result: { runId, jobId }, commit: true };
    });
  }

  /**
   * §6.2: the owner acknowledges one run's overrun, with the audit row S3
   * defined (`spend.overrun_acknowledged`); once every overrun is acknowledged,
   * confirmations are unlocked. False when the run has no unacknowledged overrun.
   */
  async acknowledgeOverrun(input: { runId: string; ownerId: string }): Promise<boolean> {
    return this.atomically(async (db) => {
      const open = (await db.query(
        `SELECT 1 FROM studio_spend_ledger l WHERE l.run_id = $1::uuid AND l.entry = 'overrun' AND NOT EXISTS (
           SELECT 1 FROM studio_audit_log a JOIN studio_users u ON u.id = a.actor_user_id AND u.role = 'owner'
            WHERE a.action = '${OVERRUN_ACKNOWLEDGED}' AND a.target_type = 'studio_runs' AND a.target_id = l.run_id::text)`,
        [input.runId])).rows.length === 1;
      if (!open) return { result: false, commit: false };
      await db.query(
        `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
         VALUES ($1::uuid, '${OVERRUN_ACKNOWLEDGED}', 'studio_runs', $2, '{}'::jsonb)`, [input.ownerId, input.runId]);
      return { result: true, commit: true };
    });
  }

  // --- Content Studio S7.2 -----------------------------------------------------------------------

  /** An owner edit: ONE transaction whose first statement declares its actor (`declareActor`). */
  private ownerEdit<T>(actorId: string, fn: (db: Queryable) => Promise<{ result: T; commit: boolean }>): Promise<T> {
    return this.atomically(async (db) => {
      await declareActor(db, actorId);
      return fn(db);
    });
  }

  /**
   * §8.5 step 1, in ONE transaction: refused while another fact check is
   * pending (queued and unexpired, or running), since the staging row is a
   * singleton; a check that expired unclaimed is closed here, so the sweep can
   * never delete these bytes as its own; then the staged bytes replace any stale
   * staging row, and the fact_check job, its check and an audit row are written.
   */
  async stageFactUpload(input: { ownerId: string; content: Buffer; sha256: string }): Promise<StageResult> {
    return this.ownerEdit<StageResult>(input.ownerId, async (db) => {
      const pending = (await db.query(
        `SELECT 1 FROM studio_jobs WHERE kind = 'fact_check'
            AND (state = 'running' OR (state = 'queued' AND expires_at > now())) LIMIT 1`)).rows.length === 1;
      if (pending) {
        return { result: { ok: false, refusal: "check_pending",
          message: "a fact check is still waiting for the worker or running; wait for its result, then upload again" }, commit: false };
      }
      await db.query("UPDATE studio_jobs SET state = 'expired' WHERE kind = 'fact_check' AND state = 'queued' AND expires_at <= now()");
      await db.query("DELETE FROM studio_fact_uploads");
      await db.query("INSERT INTO studio_fact_uploads (content, sha256, byte_length, uploaded_by) VALUES ($1, $2, $3, $4::uuid)",
        [input.content, input.sha256, input.content.length, input.ownerId]);
      const jobId = String((await db.query("INSERT INTO studio_jobs (kind) VALUES ('fact_check') RETURNING id::text AS id")).rows[0]!.id);
      const checkId = String((await db.query(
        `INSERT INTO studio_fact_checks (job_id, requested_by, sha256, byte_length) VALUES ($1::uuid, $2::uuid, $3, $4)
         RETURNING id::text AS id`, [jobId, input.ownerId, input.sha256, input.content.length])).rows[0]!.id);
      await db.query(
        `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
         VALUES ($1::uuid, 'fact.upload', 'studio_fact_checks', $2, $3::jsonb)`,
        [input.ownerId, checkId, JSON.stringify({ byte_length: input.content.length })]);
      return { result: { ok: true, checkId, jobId }, commit: true };
    });
  }

  async findFactCheck(id: string): Promise<FactCheckView | null> {
    const { rows } = await this.db.query(
      `SELECT c.id::text AS id, j.state AS job_state, c.requested_by::text AS requested_by, c.sha256, c.byte_length, c.created_at,
              c.outcome, c.refusal_class, c.refusal_message, c.unknown_fields,
              v.id::text AS v_id, v.record_count AS v_records, v.tag_counts AS v_tags, v.status AS v_status,
              (SELECT a.detail FROM studio_audit_log a WHERE a.action = 'fact_check.outcome' AND a.target_type = 'studio_fact_checks'
                  AND a.target_id = c.id::text ORDER BY a.at DESC LIMIT 1) AS detail
         FROM studio_fact_checks c JOIN studio_jobs j ON j.id = c.job_id
         LEFT JOIN studio_fact_versions v ON v.sha256 = c.sha256 AND c.outcome = 'accepted'
        WHERE c.id = $1::uuid`, [id]);
    if (rows.length !== 1) return null;
    const r = rows[0]!;
    const detail = (r.detail ?? {}) as Record<string, unknown>;
    return {
      id: r.id, jobState: r.job_state, requestedBy: r.requested_by, sha256: r.sha256, byteLength: Number(r.byte_length),
      createdAt: r.created_at, outcome: r.outcome, refusalClass: r.refusal_class, refusalMessage: r.refusal_message,
      unknownFields: Array.isArray(r.unknown_fields) ? r.unknown_fields.map(String) : null,
      version: r.v_id === null ? null : { id: r.v_id, recordCount: Number(r.v_records), tagCounts: countsOf(r.v_tags), status: r.v_status },
      existing: detail.existing === true, overCap: detail.over_cap === true,
    };
  }

  async listFactVersions(): Promise<FactVersionListRow[]> {
    const { rows } = await this.db.query(
      `SELECT v.id::text AS id, v.sha256, v.byte_length, v.record_count, v.tag_counts, v.uploaded_at, u.display_name, v.status,
              v.status_changed_at, COALESCE(s.active_fact_version_id = v.id, false) AS is_active
         FROM studio_fact_versions v JOIN studio_users u ON u.id = v.uploaded_by LEFT JOIN studio_settings s ON s.singleton
        ORDER BY v.uploaded_at DESC, v.id`);
    return rows.map((r) => ({
      id: r.id, sha256: r.sha256, byteLength: Number(r.byte_length), recordCount: Number(r.record_count), tagCounts: countsOf(r.tag_counts),
      uploadedAt: r.uploaded_at, uploaderName: textOrNull(r.display_name), status: r.status, isActive: r.is_active === true,
      statusChangedAt: (r.status_changed_at as Date | null) ?? null,
    }));
  }

  async readFactVersion(id: string): Promise<{ sha256: string; content: Buffer } | null> {
    const { rows } = await this.db.query("SELECT sha256, content FROM studio_fact_versions WHERE id = $1::uuid", [id]);
    return rows.length === 1 ? { sha256: String(rows[0]!.sha256), content: rows[0]!.content as Buffer } : null;
  }

  /** The settings' pointer, in ONE owner edit; the schema audits it (`settings.update`, by its actor) and refuses a retired version. */
  async activateFactVersion(input: { ownerId: string; versionId: string }): Promise<EditResult> {
    return this.ownerEdit<EditResult>(input.ownerId, async (db) => {
      const version = (await db.query("SELECT status FROM studio_fact_versions WHERE id = $1::uuid", [input.versionId])).rows[0];
      if (!version) return { result: { ok: false, refusal: "no_version", message: "no such fact version" }, commit: false };
      if (version.status !== "active") {
        return { result: { ok: false, refusal: "version_retired", message: "a retired version is restored before it is made active" },
          commit: false };
      }
      const updated = await db.query(
        "UPDATE studio_settings SET active_fact_version_id = $1::uuid, updated_by = $2::uuid WHERE singleton",
        [input.versionId, input.ownerId]);
      if (updated.rowCount !== 1) return { result: { ok: false, refusal: "no_settings", message: "the settings row does not exist" }, commit: false };
      return { result: { ok: true }, commit: true };
    });
  }

  /** A retirement or restoration, in ONE owner edit; the schema audits it (`fact_version.status`) and refuses retiring the active one. */
  async setFactVersionStatus(input: { ownerId: string; versionId: string; status: "active" | "retired" }): Promise<EditResult> {
    return this.ownerEdit<EditResult>(input.ownerId, async (db) => {
      const updated = await db.query(
        "UPDATE studio_fact_versions SET status = $2, status_changed_by = $3::uuid WHERE id = $1::uuid AND status <> $2",
        [input.versionId, input.status, input.ownerId]);
      if (updated.rowCount !== 1) {
        return { result: { ok: false, refusal: "no_change", message: `no such fact version that is not already ${input.status}` }, commit: false };
      }
      return { result: { ok: true }, commit: true };
    });
  }

  /**
   * §8.6, in ONE owner edit: the lineage (a source only when exactly one
   * non-deleted import's run-meta.json and 06-final-critic.json are this
   * folder's run-meta.json and round-1-06-final-critic.json, byte for byte —
   * the child then pins the source's fact version), the import's run, its
   * files, its import job and an audit row of counts. Migration 0004 checks at
   * commit that the import has its job and its files.
   */
  async createImport(input: { ownerId: string; runner: "live" | "fake"; files: readonly BundleFile[];
    lineage: { runMeta: Buffer; roundOneCritic: Buffer } | null }): Promise<{ runId: string; jobId: string; sourceRunId: string | null }> {
    return this.ownerEdit(input.ownerId, async (db) => {
      const source = input.lineage === null ? null : decideLineage((await db.query(
        `SELECT r.id::text AS id, r.fact_version_id::text AS fact_version_id FROM studio_runs r
          WHERE r.kind = 'imported' AND r.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM studio_run_artifacts a WHERE a.run_id = r.id AND a.name = 'run-meta.json' AND a.content = $1)
            AND EXISTS (SELECT 1 FROM studio_run_artifacts a WHERE a.run_id = r.id AND a.name = '06-final-critic.json' AND a.content = $2)
          ORDER BY r.created_at, r.id LIMIT 2`, [input.lineage.runMeta, input.lineage.roundOneCritic])).rows as Array<{
        id: string; fact_version_id: string | null }>);
      const runId = String((await db.query(
        `INSERT INTO studio_runs (kind, requested_by, runner, source_run_id, fact_version_id)
         VALUES ('imported', $1::uuid, $2, $3::uuid, $4::uuid) RETURNING id::text AS id`,
        [input.ownerId, input.runner, source?.id ?? null, source?.fact_version_id ?? null])).rows[0]!.id);
      for (const file of input.files) {
        await db.query(
          "INSERT INTO studio_run_artifacts (run_id, name, content, sha256, byte_length) VALUES ($1::uuid, $2, $3, $4, $5)",
          [runId, file.name, file.content, file.sha256, file.content.length]);
      }
      const jobId = String((await db.query(
        "INSERT INTO studio_jobs (run_id, kind) VALUES ($1::uuid, 'import') RETURNING id::text AS id", [runId])).rows[0]!.id);
      await db.query(
        `INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
         VALUES ($1::uuid, 'import.create', 'studio_runs', $2, $3::jsonb)`,
        [input.ownerId, runId, JSON.stringify({ files: input.files.length, bytes: input.files.reduce((n, f) => n + f.content.length, 0),
          runner: input.runner, lineage: source !== null })]);
      return { result: { runId, jobId, sourceRunId: source?.id ?? null }, commit: true };
    });
  }

  /** §6.4: the day's and the month's spend, per user, and every overrun — the ledger formula, by the schema's own functions. */
  async spendView(day: string): Promise<SpendView> {
    const totals = (await this.db.query(
      `SELECT studio_spend_for_day($1::date)::text AS day, studio_spend_for_month($1::date)::text AS month,
              studio_month_of($1::date)::text AS month_start,
              (SELECT daily_cap_usd::text FROM studio_settings WHERE singleton) AS daily,
              (SELECT monthly_cap_usd::text FROM studio_settings WHERE singleton) AS monthly`, [day])).rows[0]!;
    const users = (await this.db.query(
      `SELECT u.id::text AS id, u.display_name, u.role, u.status, u.daily_cap_usd::text AS cap,
              COALESCE(SUM(CASE l.entry WHEN 'release' THEN -l.amount_usd ELSE l.amount_usd END) FILTER (WHERE l.day_local = $1::date), 0)::text AS day,
              COALESCE(SUM(CASE l.entry WHEN 'release' THEN -l.amount_usd ELSE l.amount_usd END)
                FILTER (WHERE l.month_local = studio_month_of($1::date)), 0)::text AS month
         FROM studio_users u LEFT JOIN studio_runs r ON r.requested_by = u.id LEFT JOIN studio_spend_ledger l ON l.run_id = r.id
        GROUP BY u.id ORDER BY u.role, u.display_name NULLS LAST, u.id`, [day])).rows;
    const overruns = (await this.db.query(
      `SELECT l.run_id::text AS run_id, l.amount_usd::text AS amount, l.day_local::text AS day, r.requested_by::text AS requested_by,
              EXISTS (SELECT 1 FROM studio_audit_log a JOIN studio_users o ON o.id = a.actor_user_id AND o.role = 'owner'
                       WHERE a.action = '${OVERRUN_ACKNOWLEDGED}' AND a.target_type = 'studio_runs' AND a.target_id = l.run_id::text) AS acknowledged
         FROM studio_spend_ledger l JOIN studio_runs r ON r.id = l.run_id WHERE l.entry = 'overrun'
        ORDER BY l.day_local DESC, l.created_at DESC`)).rows;
    return {
      day, month: totals.month_start, dayMicros: numericToMicros(totals.day) ?? 0, monthMicros: numericToMicros(totals.month) ?? 0,
      settings: totals.daily === null ? null : { dailyCapMicros: numericToMicros(totals.daily) ?? 0, monthlyCapMicros: numericToMicros(totals.monthly) ?? 0 },
      users: users.map((u) => ({ id: u.id, name: u.display_name, role: u.role, status: u.status, dailyCapMicros: numericToMicros(u.cap),
        dayMicros: numericToMicros(u.day) ?? 0, monthMicros: numericToMicros(u.month) ?? 0 })),
      overruns: overruns.map((o) => ({ runId: o.run_id, amountMicros: numericToMicros(o.amount)!, day: o.day, requestedBy: o.requested_by,
        acknowledged: o.acknowledged === true })),
    };
  }
}
