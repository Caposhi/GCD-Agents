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
   * or absolute) or were revoked — before `sessionsEndedBefore`.
   */
  purge(attemptsExpiredBefore: Date, sessionsEndedBefore: Date): Promise<{ loginAttempts: number; sessions: number }>;
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
}

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

type Queryable = Pick<pg.Pool, "query"> | Pick<pg.PoolClient, "query">;

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

  async purge(attemptsExpiredBefore: Date, sessionsEndedBefore: Date): Promise<{ loginAttempts: number; sessions: number }> {
    const attempts = await this.db.query("DELETE FROM studio_login_attempts WHERE expires_at <= $1", [attemptsExpiredBefore]);
    const sessions = await this.db.query(
      `DELETE FROM studio_sessions
        WHERE absolute_expires_at <= $1 OR idle_expires_at <= $1 OR (revoked_at IS NOT NULL AND revoked_at <= $1)`,
      [sessionsEndedBefore]);
    return { loginAttempts: attempts.rowCount ?? 0, sessions: sessions.rowCount ?? 0 };
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
}
