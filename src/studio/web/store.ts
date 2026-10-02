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
}

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
