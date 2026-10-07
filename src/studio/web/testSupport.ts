/**
 * Test support for the Studio web service's suites — never loaded by
 * `main.js` (the CS10 walk proves it unreachable from the entry point).
 *
 * - `FakeIssuer`: a local OpenID provider on `node:http` at 127.0.0.1:0, with
 *   RSA keys generated when it starts. It serves an authorization endpoint (which
 *   redirects straight back with a one-time code), a token endpoint (which checks
 *   the client secret, the redirect URI and the PKCE S256 verifier) and a JWKS.
 *   No test ever contacts Google.
 * - `MemoryWebStore`: the `WebStore` contract over memory, with the S2 schema's
 *   own rules (single-use, expiring login attempts; the bootstrap-owner rule;
 *   the immutable `google_sub`; the session guard; a disabled user's sessions
 *   revoked with it). The PostgreSQL suite proves the real schema does the same.
 *   For S5 it also holds runs, artifacts, findings and request rows, which a
 *   test adds directly (`addRun`, `addArtifact`) — including, test-only, an
 *   artifact whose bytes no longer match its stored sha256.
 *
 * Every address it makes is assembled at run time, and every host is `.test`.
 */

import { createHash, createHmac, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SignJWT, exportJWK, type JWK, type JWTPayload } from "jose";

import { microsToNumeric, numericToMicros } from "../db/runner.js";
import {
  decideCancel, decideConfirm, localDay, monthOf, PREFLIGHT_RETENTION_MS, preflightPurgeable, type DeploymentCeilings,
  type PreflightRequestInput,
} from "./actions.js";
import type { OidcProvider } from "./oidc.js";
import type {
  ArtifactMeta, FindingRow, RequestRow, RunFilters, RunLineage, RunListRow, RunRow, StoredArtifact,
} from "./runs.js";
import type { SessionRow, StudioUserRow } from "./sessions.js";
import type {
  ActionContext, AuditEntry, AuditListRow, CancelResult, ConfirmHooks, ConfirmResult, EditResult, FactCheckView, FactVersionListRow,
  PreflightView, PurgeResult, RevokeResult, SpendView, StageResult, UserEditResult, UserListRow, WebHealth, WebStore,
} from "./store.js";
import { decideUserChange, losesOwnSeat, type UserChange } from "./users.js";
import { decideLineage, type BundleFile } from "./bundle.js";

export const STUDIO_DOMAIN = ["germancardepot", "com"].join(".");
/** A synthetic Studio address: `<local>.<random>` at the Studio's domain, assembled at run time. */
export const syntheticEmail = (local: string): string => `${local}.${randomBytes(3).toString("hex")}${"@"}${STUDIO_DOMAIN}`;
const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// --- The fake issuer ---------------------------------------------------------

export interface IssuedIdentity {
  email: string;
  sub: string;
  name?: string;
}

/** How the next ID token is built: claims edited, and how it is signed. */
export interface TokenPlan {
  claims?: (claims: JWTPayload) => JWTPayload;
  sign?: (claims: JWTPayload, issuer: FakeIssuer) => Promise<string>;
}

export class FakeIssuer {
  url = "";
  provider!: OidcProvider;
  private server: Server | undefined;
  private readonly hanging = new Set<ServerResponse>();
  readonly kid = `kid-${randomBytes(4).toString("hex")}`;
  readonly primary = generateKeyPairSync("rsa", { modulusLength: 2048 });
  /** Another key, published nowhere, used to sign under the primary key's kid. */
  readonly other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  private publicJwk!: JWK;
  /** The identity the next token names. */
  identity: IssuedIdentity = { email: "", sub: "" };
  plan: TokenPlan = {};
  tokenMode: "ok" | "error" | "hang" = "ok";
  /** The clock its tokens' `iat` and `exp` follow (the app's, in the suites). */
  clock: () => number = Date.now;
  readonly codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; clientId: string; used: boolean }>();
  /** Every value it issued or received that must never be logged: codes, states, nonces, verifiers, tokens. */
  readonly secrets = new Set<string>();
  tokenRequests = 0;
  lastAuthorization: URLSearchParams | null = null;
  lastTokenRequest: URLSearchParams | null = null;

  constructor(readonly clientId: string, readonly clientSecret: string) {}

  async start(): Promise<this> {
    this.publicJwk = { ...(await exportJWK(this.primary.publicKey)), kid: this.kid, use: "sig" };
    this.server = createServer((req, res) => { void this.serve(req, res); });
    await new Promise<void>((settle) => this.server!.listen(0, "127.0.0.1", settle));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    this.provider = Object.freeze({
      authorizationEndpoint: `${this.url}/authorize`,
      tokenEndpoint: `${this.url}/token`,
      jwksUri: `${this.url}/jwks`,
      issuers: Object.freeze([this.url]),
    });
    return this;
  }

  async stop(): Promise<void> {
    for (const res of this.hanging) res.destroy();
    this.server?.closeAllConnections();
    await new Promise<void>((settle) => (this.server ? this.server.close(() => settle()) : settle()));
  }

  /** The claims of a well-formed token for `identity`. */
  baseClaims(nonce: string, now = Date.now()): JWTPayload {
    const iat = Math.floor(now / 1000);
    return {
      iss: this.url, aud: this.clientId, sub: this.identity.sub, email: this.identity.email, email_verified: true,
      hd: STUDIO_DOMAIN, nonce, iat, exp: iat + 3_600, ...(this.identity.name === undefined ? {} : { name: this.identity.name }),
    };
  }

  /** RS256 with the published key. */
  signRs256(claims: JWTPayload, key: KeyObject = this.primary.privateKey, alg = "RS256"): Promise<string> {
    return new SignJWT(claims).setProtectedHeader({ alg, kid: this.kid, typ: "JWT" }).sign(key);
  }
  /** An unsigned token: `alg: none`. */
  signNone(claims: JWTPayload): string {
    return `${b64(JSON.stringify({ alg: "none", kid: this.kid, typ: "JWT" }))}.${b64(JSON.stringify(claims))}.`;
  }
  /** HS256, keyed with the published public key's bytes (the RS/HS confusion). */
  signHs256WithPublicKey(claims: JWTPayload): string {
    const secret = this.primary.publicKey.export({ type: "spki", format: "pem" });
    const input = `${b64(JSON.stringify({ alg: "HS256", kid: this.kid, typ: "JWT" }))}.${b64(JSON.stringify(claims))}`;
    return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url);
    if (req.method === "GET" && url.pathname === "/jwks") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: [this.publicJwk] }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/authorize") {
      this.lastAuthorization = url.searchParams;
      const q = url.searchParams;
      const code = randomBytes(24).toString("base64url");
      for (const value of [code, q.get("state"), q.get("nonce"), q.get("code_challenge")]) if (value) this.secrets.add(value);
      this.codes.set(code, {
        nonce: q.get("nonce") ?? "", challenge: q.get("code_challenge") ?? "", redirectUri: q.get("redirect_uri") ?? "",
        clientId: q.get("client_id") ?? "", used: false,
      });
      const back = new URL(q.get("redirect_uri") ?? "https://studio.test/auth/callback");
      back.searchParams.set("state", q.get("state") ?? "");
      back.searchParams.set("code", code);
      res.statusCode = 302;
      res.setHeader("location", back.toString());
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/token") {
      this.tokenRequests += 1;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      this.lastTokenRequest = form;
      const verifier = form.get("code_verifier") ?? "";
      if (verifier) this.secrets.add(verifier);
      if (this.tokenMode === "hang") { this.hanging.add(res); return; }
      const record = this.codes.get(form.get("code") ?? "");
      const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
      const valid = this.tokenMode === "ok" && record !== undefined && !record.used
        && form.get("grant_type") === "authorization_code" && form.get("client_id") === this.clientId
        && form.get("client_secret") === this.clientSecret && form.get("redirect_uri") === record.redirectUri
        && record.clientId === this.clientId && challenge === record.challenge;
      res.setHeader("content-type", "application/json");
      if (!valid) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_grant" }));
        return;
      }
      record!.used = true;
      const claims = (this.plan.claims ?? ((c) => c))(this.baseClaims(record!.nonce, this.clock()));
      const idToken = await (this.plan.sign ?? ((c, issuer) => issuer.signRs256(c)))(claims, this);
      this.secrets.add(idToken);
      res.end(JSON.stringify({ access_token: "fake-access-token", token_type: "Bearer", expires_in: 3_600, id_token: idToken }));
      return;
    }
    res.statusCode = 404;
    res.end();
  }
}

// --- The memory store --------------------------------------------------------

interface MemorySession {
  id_hash: string; user_id: string; csrf_token_hash: string; created_at: Date; last_seen_at: Date; idle_expires_at: Date;
  absolute_expires_at: Date; revoked_at: Date | null;
}

/** A refused write, shaped as PostgreSQL's (`code` 23514 check_violation, 23505 unique_violation). */
class RefusedWrite extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "error"; }
}

export class MemoryWebStore implements WebStore {
  readonly users = new Map<string, StudioUserRow & { created_by: string | null }>();
  readonly attempts = new Map<string, { nonceHash: string; verifier: string; createdAt: number; expiresAt: number }>();
  readonly sessions = new Map<string, MemorySession>();
  readonly auditLog: AuditEntry[] = [];
  readonly calls: string[] = [];
  heartbeatAt: number | null = null;
  failHealth = false;
  failSessions = false;
  /** S5: runs (with their tombstone), artifacts, findings and request rows, by run id. */
  readonly runs = new Map<string, RunRow>();
  readonly artifacts = new Map<string, Map<string, StoredArtifact>>();
  readonly findings = new Map<string, FindingRow[]>();
  readonly requests = new Map<string, RequestRow[]>();
  /** Every runs-list query's arguments, as the store received them. */
  readonly runQueries: Array<{ filters: Omit<RunFilters, "page">; limit: number; offset: number }> = [];

  constructor(private readonly clock: () => number) {}

  async transaction<T>(fn: (store: WebStore) => Promise<T>): Promise<T> {
    const snapshot = { users: structuredClone([...this.users]), sessions: structuredClone([...this.sessions]), audit: this.auditLog.length };
    try {
      return await fn(this);
    } catch (error) {
      this.users.clear(); for (const [k, v] of snapshot.users) this.users.set(k, v);
      this.sessions.clear(); for (const [k, v] of snapshot.sessions) this.sessions.set(k, v);
      this.auditLog.length = snapshot.audit;
      throw error;
    }
  }

  async createLoginAttempt(a: { stateHash: string; nonceHash: string; verifier: string }): Promise<void> {
    this.calls.push("createLoginAttempt");
    const now = this.clock();
    this.attempts.set(a.stateHash, { nonceHash: a.nonceHash, verifier: a.verifier, createdAt: now, expiresAt: now + 10 * 60_000 });
  }

  /** As `studio_consume_login_attempt`: deletes the attempt, and returns it only if it had not expired. */
  async consumeLoginAttempt(stateHash: string): Promise<{ nonceHash: string; verifier: string } | null> {
    this.calls.push("consumeLoginAttempt");
    const attempt = this.attempts.get(stateHash);
    this.attempts.delete(stateHash);
    return attempt && attempt.expiresAt > this.clock() ? { nonceHash: attempt.nonceHash, verifier: attempt.verifier } : null;
  }

  async findUserByEmail(email: string): Promise<StudioUserRow | null> {
    const user = [...this.users.values()].find((u) => u.email === email);
    return user ? this.publicRow(user) : null;
  }

  async activeOwnerExists(): Promise<boolean> {
    return [...this.users.values()].some((u) => u.role === "owner" && u.status === "active");
  }

  /** As the users trigger: while no active owner exists, only the bootstrap owner; after, only an owner creates users. */
  insertUser(row: { email: string; role: StudioUserRow["role"]; google_sub?: string | null; display_name?: string | null;
    status?: StudioUserRow["status"]; created_by?: string | null }): StudioUserRow {
    const owners = [...this.users.values()].filter((u) => u.role === "owner" && u.status === "active");
    const created_by = row.created_by ?? null;
    const google_sub = row.google_sub ?? null;
    const status = row.status ?? "active";
    if (owners.length === 0) {
      if (row.role !== "owner" || status !== "active" || created_by !== null || google_sub === null) {
        throw new RefusedWrite("23514", "while no owner exists, only the bootstrap owner may be created");
      }
    } else if (!owners.some((o) => o.id === created_by)) {
      throw new RefusedWrite("23514", "a user can be created only by an active owner");
    }
    if (row.email !== row.email.toLowerCase() || !row.email.endsWith(`@${STUDIO_DOMAIN}`)) throw new RefusedWrite("23514", "email");
    if ([...this.users.values()].some((u) => u.email === row.email || (google_sub !== null && u.google_sub === google_sub))) {
      throw new RefusedWrite("23505", "unique");
    }
    const user = { id: crypto.randomUUID(), email: row.email, google_sub, display_name: row.display_name ?? null, role: row.role,
      status, created_by };
    this.users.set(user.id, user);
    return this.publicRow(user);
  }

  async createBootstrapOwner(owner: { email: string; sub: string; displayName: string | null }): Promise<StudioUserRow> {
    this.calls.push("createBootstrapOwner");
    return this.insertUser({ email: owner.email, role: "owner", google_sub: owner.sub, display_name: owner.displayName });
  }

  async setGoogleSub(userId: string, sub: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user || user.google_sub !== null) return false;
    if ([...this.users.values()].some((u) => u.google_sub === sub)) throw new RefusedWrite("23505", "unique");
    user.google_sub = sub;
    return true;
  }

  /** As the status trigger: disabling a user revokes their sessions in the same change. */
  setStatus(userId: string, status: StudioUserRow["status"]): void {
    const user = this.users.get(userId)!;
    if (user.status === "active" && status === "disabled") {
      for (const s of this.sessions.values()) if (s.user_id === userId && s.revoked_at === null) s.revoked_at = new Date(this.clock());
    }
    user.status = status;
  }

  async createSession(s: { idHash: string; userId: string; csrfHash: string; createdAt: Date; idleExpiresAt: Date;
    absoluteExpiresAt: Date }): Promise<void> {
    this.calls.push("createSession");
    const user = this.users.get(s.userId);
    if (!user || user.status !== "active") throw new RefusedWrite("23514", "a session can be created only for an active user");
    if (s.absoluteExpiresAt.getTime() > s.createdAt.getTime() + 7 * 86_400_000
      || s.idleExpiresAt.getTime() > s.createdAt.getTime() + 12 * 3_600_000 || s.idleExpiresAt > s.absoluteExpiresAt) {
      throw new RefusedWrite("23514", "session lifetime");
    }
    this.sessions.set(s.idHash, {
      id_hash: s.idHash, user_id: s.userId, csrf_token_hash: s.csrfHash, created_at: s.createdAt, last_seen_at: s.createdAt,
      idle_expires_at: s.idleExpiresAt, absolute_expires_at: s.absoluteExpiresAt, revoked_at: null,
    });
  }

  async findSession(idHash: string): Promise<SessionRow | null> {
    this.calls.push("findSession");
    if (this.failSessions) throw new Error("store unavailable");
    const s = this.sessions.get(idHash);
    if (!s) return null;
    const { user_id, ...session } = s;
    return { ...structuredClone(session), user: this.publicRow(this.users.get(user_id)!) };
  }

  async touchSession(idHash: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    const s = this.sessions.get(idHash);
    if (!s || s.revoked_at !== null) return;
    if (idleExpiresAt.getTime() > lastSeenAt.getTime() + 12 * 3_600_000 || idleExpiresAt > s.absolute_expires_at) {
      throw new RefusedWrite("23514", "session lifetime");
    }
    s.last_seen_at = lastSeenAt;
    s.idle_expires_at = idleExpiresAt;
  }

  async revokeSession(idHash: string, at: Date): Promise<void> {
    const s = this.sessions.get(idHash);
    if (s && s.revoked_at === null) s.revoked_at = at;
  }

  async audit(entry: AuditEntry): Promise<void> {
    this.auditLog.push(structuredClone(entry));
  }

  async purge(attemptsExpiredBefore: Date, sessionsEndedBefore: Date): Promise<PurgeResult> {
    let loginAttempts = 0;
    let sessions = 0;
    for (const [k, a] of this.attempts) {
      if (a.expiresAt <= attemptsExpiredBefore.getTime()) { this.attempts.delete(k); loginAttempts += 1; }
    }
    for (const [k, s] of this.sessions) {
      const ended = sessionsEndedBefore;
      if (s.absolute_expires_at <= ended || s.idle_expires_at <= ended || (s.revoked_at !== null && s.revoked_at <= ended)) {
        this.sessions.delete(k);
        sessions += 1;
      }
    }
    // S6.2: the preflight requests past their 30 days on which no consumed quote depends.
    let preflightRequests = 0;
    for (const [id, r] of this.preflight) {
      const consumed = r.quoteId !== null && this.quotes.get(r.quoteId)?.consumedAtMs !== null;
      if (preflightPurgeable({ pastRetention: r.createdAtMs <= this.clock() - PREFLIGHT_RETENTION_MS, quoteConsumed: consumed })) {
        this.deletePreflight(id);
        preflightRequests += 1;
      }
    }
    // S7.2: fact checks past their 30 days (0004's rule).
    let factChecks = 0;
    for (const [id, c] of this.factChecks) {
      if (c.createdAtMs <= this.clock() - PREFLIGHT_RETENTION_MS) { this.factChecks.delete(id); factChecks += 1; }
    }
    return { loginAttempts, sessions, preflightRequests, factChecks };
  }

  async health(): Promise<WebHealth> {
    if (this.failHealth) throw new Error("store unavailable");
    return {
      schemaVersion: "0004_studio_fact_checks_and_imports.sql",
      workerHeartbeatAgeSeconds: this.heartbeatAt === null ? null : Math.round((this.clock() - this.heartbeatAt) / 1000),
    };
  }

  // --- S5 -------------------------------------------------------------------

  /** A run row with defaults: a finished fake full run, requested by `requestedBy`. */
  addRun(requestedBy: StudioUserRow, row: Partial<RunRow> = {}): RunRow {
    const id = row.id ?? crypto.randomUUID();
    const created = row.created_at ?? new Date(this.clock() - this.runs.size * 1_000);
    const run: RunRow = {
      id, kind: "full", state: "succeeded", runner: "fake", goal: "Synthetic goal", verdict: "provisional_pass",
      blocking_findings: null, advisory_findings: null, actual_usd: null, import_tier: null, created_at: created,
      requested_by: requestedBy.id, requester_name: requestedBy.display_name, source_run_id: null, platforms: ["instagram"],
      scope_tags: null, fact_version_id: null, approved_facts_sha256: null, automotive_facts_sha256: null,
      evidence_pack_sha256: null, code_commit: null, reserved_usd: null, owner_item_findings: null, failure_class: null,
      failure_message: null, started_at: created, finished_at: created, deleted_at: null, ...row,
    };
    this.runs.set(id, run);
    return run;
  }

  /** Stores bytes as the sink does (sha256 and length of the bytes), or — `tamper`, test-only — with other bytes. */
  addArtifact(runId: string, name: string, bytes: string | Buffer, tamper?: Buffer): void {
    const content = Buffer.from(bytes);
    const stored: StoredArtifact = {
      name, content: tamper ?? content, sha256: createHash("sha256").update(content).digest("hex"), byte_length: content.length,
    };
    if (!this.artifacts.has(runId)) this.artifacts.set(runId, new Map());
    this.artifacts.get(runId)!.set(name, stored);
  }

  async listRuns(filters: Omit<RunFilters, "page">, limit: number, offset: number): Promise<RunListRow[]> {
    this.calls.push("listRuns");
    this.runQueries.push({ filters: { ...filters }, limit, offset });
    return [...this.runs.values()]
      .filter((r) => r.deleted_at === null && (filters.state === null || r.state === filters.state)
        && (filters.kind === null || r.kind === filters.kind) && (filters.requester === null || r.requested_by === filters.requester))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1))
      .slice(offset, offset + limit)
      .map((r) => structuredClone(r));
  }

  /** As the PostgreSQL store: the run as stored, deleted or not. */
  async findRun(id: string): Promise<RunRow | null> {
    this.calls.push("findRun");
    const run = this.runs.get(id);
    return run ? structuredClone(run) : null;
  }

  async runLineage(run: Pick<RunRow, "id" | "source_run_id">): Promise<RunLineage> {
    const parent = run.source_run_id === null ? undefined : this.runs.get(run.source_run_id);
    return {
      parent: parent ? { id: parent.id, deleted: parent.deleted_at !== null } : null,
      children: [...this.runs.values()].filter((r) => r.source_run_id === run.id && r.deleted_at === null)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map((r) => ({ id: r.id, kind: r.kind, state: r.state })),
    };
  }

  async listArtifacts(runId: string): Promise<ArtifactMeta[]> {
    return [...(this.artifacts.get(runId)?.values() ?? [])].sort((a, b) => (a.name < b.name ? -1 : 1))
      .map(({ name, sha256, byte_length }) => ({ name, sha256, byte_length }));
  }

  async readArtifact(runId: string, name: string): Promise<StoredArtifact | null> {
    this.calls.push("readArtifact");
    const stored = this.artifacts.get(runId)?.get(name);
    return stored ? { ...stored, content: Buffer.from(stored.content) } : null;
  }

  async listFindings(runId: string): Promise<FindingRow[]> {
    return structuredClone(this.findings.get(runId) ?? []).sort((a, b) => a.idx - b.idx);
  }

  async listRequests(runId: string): Promise<RequestRow[]> {
    return structuredClone(this.requests.get(runId) ?? []).sort((a, b) => a.seq - b.seq);
  }

  // --- S6.2: the actions, over memory, with the schema's own rules ---------------------------------

  readonly factVersions = new Map<string, { id: string; sha256: string; recordCount: number; tagCounts: Record<string, number>;
    uploadedAt: Date; status: "active" | "retired" }>();
  settings: { dailyCapMicros: number; monthlyCapMicros: number; activeFactVersionId: string | null } | null =
    { dailyCapMicros: 50_000_000, monthlyCapMicros: 200_000_000, activeFactVersionId: null };
  heartbeat: { commit: string; approvedFactsSha256: string; priceTableSha256: string; tagCounts: Record<string, number>;
    beatAtMs: number } | null = null;
  readonly jobs = new Map<string, { id: string; runId: string | null; kind: "preflight" | "paid" | "fake" | "fact_check" | "import";
    state: string; cancelRequested: boolean }>();
  readonly preflight = new Map<string, PreflightRequestInput & { id: string; jobId: string; createdAtMs: number;
    outcome: "quoted" | "refused" | null; refusalClass: string | null; refusalMessage: string | null; revisePlan: unknown;
    quoteId: string | null }>();
  readonly quotes = new Map<string, { id: string; userId: string; action: string; paramsSha256: string; workerCommit: string;
    approvedFactsSha256: string; factVersionId: string; priceTableSha256: string; ceilingMicros: number; breakdown: unknown;
    createdAtMs: number; expiresAtMs: number; consumedAtMs: number | null }>();
  readonly ledger: Array<{ entry: "reserve" | "release" | "overrun"; runId: string; amountMicros: number; day: string }> = [];
  /** The users rows' daily caps and update times (the S4 rows carry neither). */
  readonly userCaps = new Map<string, number | null>();
  readonly userUpdatedAt = new Map<string, number>();
  /** Each live run's quote. */
  readonly runQuote = new Map<string, string>();
  private confirmTail: Promise<unknown> = Promise.resolve();

  async actionContext(): Promise<ActionContext> {
    const v = this.settings?.activeFactVersionId ? this.factVersions.get(this.settings.activeFactVersionId) : undefined;
    return {
      nowMs: this.clock(),
      settings: this.settings ? { dailyCapMicros: this.settings.dailyCapMicros, monthlyCapMicros: this.settings.monthlyCapMicros } : null,
      activeFactVersion: v && v.status === "active" ? { id: v.id, sha256: v.sha256, recordCount: v.recordCount, tagCounts: { ...v.tagCounts },
        uploadedAt: v.uploadedAt } : null,
      heartbeat: this.heartbeat ? { ...this.heartbeat, tagCounts: { ...this.heartbeat.tagCounts } } : null,
    };
  }

  /** As 0003's trigger: an active owner or runner, a source that is not deleted, a fact version that exists. */
  async createPreflightRequest(input: PreflightRequestInput): Promise<{ requestId: string; jobId: string }> {
    this.calls.push("createPreflightRequest");
    const user = this.users.get(input.userId);
    if (!user || user.status !== "active" || !["owner", "runner"].includes(user.role)) {
      throw new RefusedWrite("23514", "a preflight is requested only by an active owner or runner");
    }
    if (input.sourceRunId !== null && this.runs.get(input.sourceRunId)?.deleted_at !== null) {
      throw new RefusedWrite("23514", "a deleted run cannot be a preflight's source");
    }
    if (!this.factVersions.has(input.factVersionId)) throw new RefusedWrite("23503", "fact version");
    const jobId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    this.jobs.set(jobId, { id: jobId, runId: null, kind: "preflight", state: "queued", cancelRequested: false });
    this.preflight.set(requestId, { ...structuredClone(input), id: requestId, jobId, createdAtMs: this.clock(), outcome: null,
      refusalClass: null, refusalMessage: null, revisePlan: null, quoteId: null });
    this.auditLog.push({ action: "preflight.request", actorUserId: input.userId, targetType: "studio_preflight_requests",
      targetId: requestId, detail: { action: input.action } });
    return { requestId, jobId };
  }

  /** Test-only: the worker's answer, as `writePreflightOutcome` writes it (a quote, or a refusal), and the job's end. */
  answerPreflight(requestId: string, answer: { refused: { refusalClass: string; message: string } } | {
    quote: { ceilingMicros: number; breakdown?: unknown; workerCommit?: string; approvedFactsSha256?: string; priceTableSha256?: string;
      createdAtMs?: number; expiresAtMs?: number };
  }, revisePlan: unknown = null): string | null {
    const r = this.preflight.get(requestId)!;
    if (r.outcome !== null) throw new RefusedWrite("23514", "written once");
    this.jobs.get(r.jobId)!.state = "finished";
    r.revisePlan = revisePlan;
    if ("refused" in answer) {
      Object.assign(r, { outcome: "refused", refusalClass: answer.refused.refusalClass, refusalMessage: answer.refused.message });
      return null;
    }
    const hb = this.heartbeat;
    const created = answer.quote.createdAtMs ?? this.clock();
    const id = crypto.randomUUID();
    this.quotes.set(id, {
      id, userId: r.userId, action: r.action, paramsSha256: r.paramsSha256, factVersionId: r.factVersionId,
      workerCommit: answer.quote.workerCommit ?? hb?.commit ?? "0".repeat(40),
      approvedFactsSha256: answer.quote.approvedFactsSha256 ?? hb?.approvedFactsSha256 ?? "0".repeat(64),
      priceTableSha256: answer.quote.priceTableSha256 ?? hb?.priceTableSha256 ?? "0".repeat(64),
      ceilingMicros: answer.quote.ceilingMicros, breakdown: answer.quote.breakdown ?? [],
      createdAtMs: created, expiresAtMs: answer.quote.expiresAtMs ?? created + 10 * 60_000, consumedAtMs: null,
    });
    Object.assign(r, { outcome: "quoted", quoteId: id });
    return id;
  }

  async findPreflightRequest(id: string): Promise<PreflightView | null> {
    const r = this.preflight.get(id);
    if (!r) return null;
    const q = r.quoteId === null ? undefined : this.quotes.get(r.quoteId);
    const runId = q ? [...this.runQuote].find(([, quote]) => quote === q.id)?.[0] ?? null : null;
    return {
      id: r.id, jobId: r.jobId, jobState: this.jobs.get(r.jobId)!.state, userId: r.userId, action: r.action, goal: r.goal,
      platforms: [...r.platforms], scopeTags: r.scopeTags ? [...r.scopeTags] : null, sourceRunId: r.sourceRunId,
      factVersionId: r.factVersionId, createdAt: new Date(r.createdAtMs), outcome: r.outcome, refusalClass: r.refusalClass,
      refusalMessage: r.refusalMessage, revisePlan: structuredClone(r.revisePlan),
      quote: q ? { id: q.id, userId: q.userId, action: q.action, ceilingUsd: microsToNumeric(q.ceilingMicros), ceilingMicros: q.ceilingMicros,
        breakdown: structuredClone(q.breakdown), createdAt: new Date(q.createdAtMs), expiresAt: new Date(q.expiresAtMs),
        consumedAt: q.consumedAtMs === null ? null : new Date(q.consumedAtMs), runId } : null,
    };
  }

  /** Σreserve − Σrelease + Σoverrun, as `studio_spend_for_day`, over the entries `match` keeps. */
  spendMicros(match: (row: MemoryWebStore["ledger"][number]) => boolean): number {
    return this.ledger.filter(match).reduce((sum, row) => sum + (row.entry === "release" ? -row.amountMicros : row.amountMicros), 0);
  }

  unacknowledgedOverruns(): string[] {
    // S7.3: any acknowledgement with an actor counts, whatever the acknowledger's role is now (OVERRUN_ACKNOWLEDGEMENTS_SQL).
    return this.ledger.filter((row) => row.entry === "overrun" && !this.auditLog.some((a) => a.action === "spend.overrun_acknowledged"
      && a.actorUserId !== null && a.targetType === "studio_runs" && a.targetId === row.runId)).map((row) => row.runId);
  }

  /** As the PostgreSQL store: serialized (the settings-row lock), decided by `decideConfirm`, then written together. */
  async confirmQuote(input: { quoteId: string; userId: string; ceilings: DeploymentCeilings }, hooks: ConfirmHooks = {}): Promise<ConfirmResult> {
    const next = this.confirmTail.then(async (): Promise<ConfirmResult> => {
      const now = this.clock();
      const user = this.users.get(input.userId);
      const q = this.quotes.get(input.quoteId);
      const r = q ? [...this.preflight.values()].find((x) => x.quoteId === q.id) : undefined;
      const source = r?.sourceRunId ? this.runs.get(r.sourceRunId) : undefined;
      const day = localDay(now);
      const derived = r !== undefined && r.sourceRunId !== null;
      const decision = decideConfirm({
        nowMs: now,
        user: user ? { id: user.id, role: user.role, status: user.status, dailyCapMicros: this.userCaps.get(user.id) ?? null,
          updatedAtMs: this.userUpdatedAt.get(user.id) ?? 0 } : null,
        quote: q ? { ...q, consumed: q.consumedAtMs !== null } : null,
        request: r ? { action: r.action, paramsSha256: r.paramsSha256, factVersionId: r.factVersionId, sourceRunId: r.sourceRunId } : null,
        sourceAvailable: source !== undefined && source.deleted_at === null,
        heartbeat: this.heartbeat,
        currentFactVersionId: derived ? (source && source.deleted_at === null ? source.fact_version_id : null)
          : this.settings?.activeFactVersionId ?? null,
        settings: this.settings,
        ceilings: input.ceilings,
        spend: {
          dayMicros: this.spendMicros((row) => row.day === day),
          monthMicros: this.spendMicros((row) => monthOf(row.day) === monthOf(day)),
          userDayMicros: this.spendMicros((row) => row.day === day && this.runs.get(row.runId)?.requested_by === input.userId),
        },
        unacknowledgedOverruns: this.unacknowledgedOverruns().length,
      });
      if (!decision.ok) return decision;
      const version = this.factVersions.get(q!.factVersionId);
      const run = this.addRun(user!, {
        kind: q!.action, state: "queued", runner: "live", goal: derived ? source!.goal : r!.goal, platforms: [...r!.platforms],
        scope_tags: r!.scopeTags ? [...r!.scopeTags] : null, fact_version_id: q!.factVersionId, automotive_facts_sha256: version?.sha256 ?? null,
        source_run_id: r!.sourceRunId, reserved_usd: microsToNumeric(q!.ceilingMicros), verdict: null, created_at: new Date(now),
        started_at: null, finished_at: null,
      });
      q!.consumedAtMs = now;
      this.runQuote.set(run.id, q!.id);
      this.ledger.push({ entry: "reserve", runId: run.id, amountMicros: q!.ceilingMicros, day });
      const jobId = crypto.randomUUID();
      this.jobs.set(jobId, { id: jobId, runId: run.id, kind: "paid", state: "queued", cancelRequested: false });
      this.auditLog.push({ action: "run.confirm", actorUserId: input.userId, targetType: "studio_runs", targetId: run.id,
        detail: { kind: q!.action, quote: q!.id } });
      await hooks.beforeCommit?.();
      return { ok: true, runId: run.id };
    });
    this.confirmTail = next.catch(() => undefined);
    return next;
  }

  /** As the PostgreSQL store: `decideCancel`, then the queued cancellation (with its release) or the running request. */
  async cancelRun(input: { runId: string; user: { id: string; role: string; status: string } }): Promise<CancelResult> {
    const run = this.runs.get(input.runId);
    const job = [...this.jobs.values()].find((j) => j.runId === input.runId);
    const plan = decideCancel(input.user, {
      run: run ? { id: run.id, requestedBy: run.requested_by, state: run.state, runner: run.runner, kind: run.kind,
        reservedMicros: numericToMicros(run.reserved_usd), deleted: run.deleted_at !== null } : null,
      job: job ? { state: job.state, cancelRequested: job.cancelRequested } : null,
    });
    if (!plan.ok) return plan;
    if (plan.kind === "queued") {
      job!.state = "cancelled";
      job!.cancelRequested = true;
      Object.assign(run!, { state: "cancelled", failure_class: "job_cancelled", failure_message: "the job was cancelled before it was claimed",
        finished_at: new Date(this.clock()), actual_usd: run!.runner === "live" ? "0.000000" : null });
      if (plan.releaseMicros !== null) {
        const reserve = this.ledger.find((row) => row.runId === run!.id && row.entry === "reserve")!;
        this.ledger.push({ entry: "release", runId: run!.id, amountMicros: plan.releaseMicros, day: reserve.day });
      }
    } else {
      job!.cancelRequested = true;
    }
    this.auditLog.push({ action: "run.cancel", actorUserId: input.user.id, targetType: "studio_runs", targetId: input.runId,
      detail: { was: plan.kind } });
    return { ok: true, kind: plan.kind };
  }

  /** As the runs trigger: a fake run is created only by an active owner. */
  async createFakeRun(input: { ownerId: string; goal: string; platforms: string[]; scopeTags: string[] | null;
    factVersionId: string | null }): Promise<{ runId: string; jobId: string }> {
    const owner = this.users.get(input.ownerId);
    if (!owner || owner.status !== "active" || owner.role !== "owner") throw new RefusedWrite("23514", "fake runs and imports are owner-only");
    const version = input.factVersionId ? this.factVersions.get(input.factVersionId) : undefined;
    const run = this.addRun(owner, { kind: "full", state: "queued", runner: "fake", goal: input.goal, platforms: [...input.platforms],
      scope_tags: input.scopeTags ? [...input.scopeTags] : null, fact_version_id: version?.id ?? null,
      automotive_facts_sha256: version?.sha256 ?? null, verdict: null, created_at: new Date(this.clock()), started_at: null, finished_at: null });
    const jobId = crypto.randomUUID();
    this.jobs.set(jobId, { id: jobId, runId: run.id, kind: "fake", state: "queued", cancelRequested: false });
    this.auditLog.push({ action: "run.fake", actorUserId: owner.id, targetType: "studio_runs", targetId: run.id, detail: {} });
    return { runId: run.id, jobId };
  }

  async acknowledgeOverrun(input: { runId: string; ownerId: string }): Promise<boolean> {
    const owner = this.users.get(input.ownerId);
    if (!owner || owner.role !== "owner" || owner.status !== "active") return false;
    if (!this.unacknowledgedOverruns().includes(input.runId)) return false;
    this.auditLog.push({ action: "spend.overrun_acknowledged", actorUserId: input.ownerId, targetType: "studio_runs",
      targetId: input.runId, detail: {} });
    return true;
  }

  async spendView(day: string): Promise<SpendView> {
    const acknowledged = (runId: string) => !this.unacknowledgedOverruns().includes(runId);
    return {
      day, month: monthOf(day),
      dayMicros: this.spendMicros((row) => row.day === day),
      monthMicros: this.spendMicros((row) => monthOf(row.day) === monthOf(day)),
      settings: this.settings ? { dailyCapMicros: this.settings.dailyCapMicros, monthlyCapMicros: this.settings.monthlyCapMicros } : null,
      users: [...this.users.values()].map((u) => ({
        id: u.id, name: u.display_name, role: u.role, status: u.status, dailyCapMicros: this.userCaps.get(u.id) ?? null,
        dayMicros: this.spendMicros((row) => row.day === day && this.runs.get(row.runId)?.requested_by === u.id),
        monthMicros: this.spendMicros((row) => monthOf(row.day) === monthOf(day) && this.runs.get(row.runId)?.requested_by === u.id),
      })),
      overruns: this.ledger.filter((row) => row.entry === "overrun").map((row) => ({ runId: row.runId, amountMicros: row.amountMicros,
        day: row.day, requestedBy: this.runs.get(row.runId)?.requested_by ?? "", acknowledged: acknowledged(row.runId) })),
    };
  }

  /** As 0003's DELETE rule: 30 days, and never one a consumed quote depends on. */
  private deletePreflight(id: string): void {
    const r = this.preflight.get(id)!;
    if (r.quoteId !== null && this.quotes.get(r.quoteId)?.consumedAtMs !== null) {
      throw new RefusedWrite("23514", "a preflight request whose quote was consumed is never deleted");
    }
    if (r.createdAtMs > this.clock() - PREFLIGHT_RETENTION_MS) throw new RefusedWrite("23514", "kept for 30 days");
    this.preflight.delete(id);
  }

  /** Test-only: an active fact version, as the owner's upload (S7) and the settings row would make it. */
  addFactVersion(tagCounts: Record<string, number> = {}, active = true): string {
    const id = crypto.randomUUID();
    this.factVersions.set(id, { id, sha256: createHash("sha256").update(id).digest("hex"), recordCount: 4, tagCounts,
      uploadedAt: new Date(this.clock()), status: "active" });
    if (active && this.settings) this.settings.activeFactVersionId = id;
    return id;
  }

  // --- S7.2: fact versions and imports, over memory, with the schema's own rules -------------------------

  /** The staging row (a singleton), each check, each version's bytes and uploader, and every declared actor, in order. */
  staged: { content: Buffer; sha256: string; uploadedBy: string } | null = null;
  readonly factChecks = new Map<string, { id: string; jobId: string; requestedBy: string; sha256: string; byteLength: number;
    createdAtMs: number; outcome: "accepted" | "refused" | null; refusalClass: string | null; refusalMessage: string | null;
    unknownFields: string[] | null; existing: boolean; overCap: boolean }>();
  readonly versionBytes = new Map<string, { content: Buffer; uploadedBy: string; statusChangedAt: Date | null }>();
  readonly declaredActors: Array<{ actor: string; edit: string }> = [];

  private requireOwner(userId: string, edit: string): void {
    const user = this.users.get(userId);
    if (!user || user.status !== "active" || user.role !== "owner") {
      throw new RefusedWrite("23514", `${edit}: the transaction's actor is not an active owner`);
    }
    this.declaredActors.push({ actor: userId, edit });
  }

  async stageFactUpload(input: { ownerId: string; content: Buffer; sha256: string }): Promise<StageResult> {
    this.calls.push("stageFactUpload");
    this.requireOwner(input.ownerId, "stageFactUpload");
    if ([...this.jobs.values()].some((j) => j.kind === "fact_check" && (j.state === "queued" || j.state === "running"))) {
      return { ok: false, refusal: "check_pending", message: "a fact check is still waiting for the worker or running; wait for its result, then upload again" };
    }
    this.staged = { content: Buffer.from(input.content), sha256: input.sha256, uploadedBy: input.ownerId };
    const jobId = crypto.randomUUID();
    const checkId = crypto.randomUUID();
    this.jobs.set(jobId, { id: jobId, runId: null, kind: "fact_check", state: "queued", cancelRequested: false });
    this.factChecks.set(checkId, { id: checkId, jobId, requestedBy: input.ownerId, sha256: input.sha256, byteLength: input.content.length,
      createdAtMs: this.clock(), outcome: null, refusalClass: null, refusalMessage: null, unknownFields: null, existing: false, overCap: false });
    this.auditLog.push({ action: "fact.upload", actorUserId: input.ownerId, targetType: "studio_fact_checks", targetId: checkId,
      detail: { byte_length: input.content.length } });
    return { ok: true, checkId, jobId };
  }

  /** Test-only: the worker's outcome, as `writeFactCheckOutcome` writes it: the version, the outcome, the staging row gone, the job ended. */
  answerFactCheck(checkId: string, answer: { accepted: { recordCount: number; tagCounts: Record<string, number>; existing?: boolean;
    overCap?: boolean } } | { refused: { refusalClass: string; message: string } }, unknownFields: string[] | null = null): string | null {
    const c = this.factChecks.get(checkId)!;
    if (c.outcome !== null) throw new RefusedWrite("23514", "written once");
    let versionId: string | null = null;
    if ("accepted" in answer) {
      const existing = [...this.factVersions.values()].find((v) => v.sha256 === c.sha256);
      versionId = existing?.id ?? crypto.randomUUID();
      if (!existing) {
        this.factVersions.set(versionId, { id: versionId, sha256: c.sha256, recordCount: answer.accepted.recordCount,
          tagCounts: answer.accepted.tagCounts, uploadedAt: new Date(this.clock()), status: "active" });
        this.versionBytes.set(versionId, { content: Buffer.from(this.staged?.content ?? Buffer.alloc(0)), uploadedBy: c.requestedBy,
          statusChangedAt: null });
      }
      Object.assign(c, { outcome: "accepted", unknownFields, existing: answer.accepted.existing ?? Boolean(existing),
        overCap: answer.accepted.overCap ?? false });
    } else {
      Object.assign(c, { outcome: "refused", refusalClass: answer.refused.refusalClass, refusalMessage: answer.refused.message, unknownFields });
    }
    if (this.staged?.sha256 === c.sha256) this.staged = null;
    this.jobs.get(c.jobId)!.state = "finished";
    return versionId;
  }

  async findFactCheck(id: string): Promise<FactCheckView | null> {
    const c = this.factChecks.get(id);
    if (!c) return null;
    const v = c.outcome === "accepted" ? [...this.factVersions.values()].find((x) => x.sha256 === c.sha256) : undefined;
    return {
      id: c.id, jobState: this.jobs.get(c.jobId)?.state ?? "finished", requestedBy: c.requestedBy, sha256: c.sha256, byteLength: c.byteLength,
      createdAt: new Date(c.createdAtMs), outcome: c.outcome, refusalClass: c.refusalClass, refusalMessage: c.refusalMessage,
      unknownFields: c.unknownFields ? [...c.unknownFields] : null,
      version: v ? { id: v.id, recordCount: v.recordCount, tagCounts: { ...v.tagCounts }, status: v.status } : null,
      existing: c.existing, overCap: c.overCap,
    };
  }

  async listFactVersions(): Promise<FactVersionListRow[]> {
    return [...this.factVersions.values()].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((v) => {
        const bytes = this.versionBytes.get(v.id);
        const uploader = bytes ? this.users.get(bytes.uploadedBy) : [...this.users.values()].find((u) => u.role === "owner");
        return { id: v.id, sha256: v.sha256, byteLength: bytes?.content.length ?? 0, recordCount: v.recordCount, tagCounts: { ...v.tagCounts },
          uploadedAt: v.uploadedAt, uploaderName: uploader?.display_name ?? null, status: v.status,
          isActive: this.settings?.activeFactVersionId === v.id, statusChangedAt: bytes?.statusChangedAt ?? null };
      });
  }

  async readFactVersion(id: string): Promise<{ sha256: string; content: Buffer } | null> {
    this.calls.push("readFactVersion");
    const v = this.factVersions.get(id);
    return v ? { sha256: v.sha256, content: Buffer.from(this.versionBytes.get(id)?.content ?? Buffer.alloc(0)) } : null;
  }

  async activateFactVersion(input: { ownerId: string; versionId: string }): Promise<EditResult> {
    this.requireOwner(input.ownerId, "activateFactVersion");
    const v = this.factVersions.get(input.versionId);
    if (!v) return { ok: false, refusal: "no_version", message: "no such fact version" };
    if (v.status !== "active") return { ok: false, refusal: "version_retired", message: "a retired version is restored before it is made active" };
    if (!this.settings) return { ok: false, refusal: "no_settings", message: "the settings row does not exist" };
    this.settings.activeFactVersionId = v.id;
    this.auditLog.push({ action: "settings.update", actorUserId: input.ownerId, targetType: "studio_settings", targetId: "singleton", detail: {} });
    return { ok: true };
  }

  async setFactVersionStatus(input: { ownerId: string; versionId: string; status: "active" | "retired" }): Promise<EditResult> {
    this.requireOwner(input.ownerId, "setFactVersionStatus");
    const v = this.factVersions.get(input.versionId);
    if (!v || v.status === input.status) {
      return { ok: false, refusal: "no_change", message: `no such fact version that is not already ${input.status}` };
    }
    if (input.status === "retired" && this.settings?.activeFactVersionId === v.id) {
      throw new RefusedWrite("23514", "the active fact version is retired only after the settings point elsewhere");
    }
    const before = v.status;
    v.status = input.status;
    const bytes = this.versionBytes.get(v.id);
    if (bytes) bytes.statusChangedAt = new Date(this.clock());
    this.auditLog.push({ action: "fact_version.status", actorUserId: input.ownerId, targetType: "studio_fact_versions", targetId: v.id,
      detail: { before, after: input.status } });
    return { ok: true };
  }

  async createImport(input: { ownerId: string; runner: "live" | "fake"; files: readonly BundleFile[];
    lineage: { runMeta: Buffer; roundOneCritic: Buffer } | null }): Promise<{ runId: string; jobId: string; sourceRunId: string | null }> {
    this.calls.push("createImport");
    this.requireOwner(input.ownerId, "createImport");
    const same = (runId: string, name: string, bytes: Buffer) => this.artifacts.get(runId)?.get(name)?.content.equals(bytes) === true;
    const lineage = input.lineage;
    const source = lineage === null ? null : decideLineage([...this.runs.values()]
      .filter((r) => r.kind === "imported" && r.deleted_at === null && same(r.id, "run-meta.json", lineage.runMeta)
        && same(r.id, "06-final-critic.json", lineage.roundOneCritic))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).slice(0, 2));
    const owner = this.users.get(input.ownerId)!;
    const run = this.addRun(owner, { kind: "imported", state: "queued", runner: input.runner, goal: null, verdict: null, platforms: null,
      source_run_id: source?.id ?? null, fact_version_id: source?.fact_version_id ?? null, created_at: new Date(this.clock()),
      started_at: null, finished_at: null });
    for (const file of input.files) this.addArtifact(run.id, file.name, file.content);
    const jobId = crypto.randomUUID();
    this.jobs.set(jobId, { id: jobId, runId: run.id, kind: "import", state: "queued", cancelRequested: false });
    this.auditLog.push({ action: "import.create", actorUserId: input.ownerId, targetType: "studio_runs", targetId: run.id,
      detail: { files: input.files.length, runner: input.runner, lineage: source !== null } });
    return { runId: run.id, jobId, sourceRunId: source?.id ?? null };
  }

  // --- S7.3: users, caps and the audit view, over memory, with the schema's own rules ------------------------

  /** Each audit row's time, by its index in `auditLog` (rows pushed without one are stamped when first listed). */
  readonly auditAt: number[] = [];

  async listUsers(): Promise<UserListRow[]> {
    this.calls.push("listUsers");
    const now = this.clock();
    return [...this.users.values()].sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : a.email < b.email ? -1 : 1)).map((u) => {
      const sessions = [...this.sessions.values()].filter((x) => x.user_id === u.id);
      const signIns = sessions.map((x) => x.created_at.getTime());
      return {
        id: u.id, email: u.email, displayName: u.display_name, role: u.role, status: u.status, dailyCapMicros: this.userCaps.get(u.id) ?? null,
        googleBound: u.google_sub !== null, createdAt: new Date(this.createdAt.get(u.id) ?? now),
        lastSignInAt: signIns.length ? new Date(Math.max(...signIns)) : null,
        liveSessions: sessions.filter((x) => x.revoked_at === null && x.idle_expires_at.getTime() > now && x.absolute_expires_at.getTime() > now).length,
      };
    });
  }

  readonly createdAt = new Map<string, number>();

  /** As the users triggers: created by an active owner, the address lower-cased at the domain and unique; `user.create` audited. */
  async createUser(input: { ownerId: string; email: string; role: StudioUserRow["role"]; dailyCapMicros: number | null }): Promise<{ userId: string }> {
    this.calls.push("createUser");
    this.requireOwner(input.ownerId, "createUser");
    const user = this.insertUser({ email: input.email, role: input.role, created_by: input.ownerId });
    this.userCaps.set(user.id, input.dailyCapMicros);
    this.userUpdatedAt.set(user.id, this.clock());
    this.createdAt.set(user.id, this.clock());
    this.auditLog.push({ action: "user.create", actorUserId: input.ownerId, targetType: "studio_users", targetId: user.id,
      detail: { role: input.role, status: "active", daily_cap_usd: input.dailyCapMicros === null ? "null" : microsToNumeric(input.dailyCapMicros) } });
    return { userId: user.id };
  }

  /** `user.update`, as 0004's trigger writes it: the before and after of role, status and cap, never an address or a name. */
  private auditUserUpdate(actor: string, id: string, before: { role: string; status: string; cap: number | null }): void {
    const u = this.users.get(id)!;
    const cap = (micros: number | null) => (micros === null ? "null" : microsToNumeric(micros));
    this.auditLog.push({ action: "user.update", actorUserId: actor, targetType: "studio_users", targetId: id,
      detail: { before: JSON.stringify({ role: before.role, status: before.status, daily_cap_usd: cap(before.cap) }),
        after: JSON.stringify({ role: u.role, status: u.status, daily_cap_usd: cap(this.userCaps.get(id) ?? null) }),
        email_changed: false, display_name_changed: false } });
  }

  async changeUser(input: { ownerId: string; userId: string; change: UserChange }): Promise<UserEditResult> {
    this.calls.push("changeUser");
    this.requireOwner(input.ownerId, "changeUser");
    const target = this.users.get(input.userId) ?? null;
    const owners = [...this.users.values()].filter((u) => u.role === "owner" && u.status === "active").map((u) => u.id);
    const decision = decideUserChange({ target, change: input.change, activeOwnerIds: owners });
    if (!decision.ok) return decision;
    const before = { role: target!.role, status: target!.status, cap: this.userCaps.get(target!.id) ?? null };
    if (input.change.kind === "role") target!.role = input.change.role;
    else this.setStatus(target!.id, input.change.status);
    // As 0002's trigger: at least one active owner always remains.
    if (![...this.users.values()].some((u) => u.role === "owner" && u.status === "active")) {
      Object.assign(target!, { role: before.role, status: before.status });
      throw new RefusedWrite("23514", "studio: the last active owner cannot be removed, demoted or disabled");
    }
    this.userUpdatedAt.set(target!.id, this.clock());
    this.auditUserUpdate(input.ownerId, target!.id, before);
    const signedOut = losesOwnSeat(input.ownerId, input.userId, input.change);
    if (signedOut) for (const x of this.sessions.values()) if (x.user_id === input.userId && x.revoked_at === null) x.revoked_at = new Date(this.clock());
    return { ok: true, signedOut };
  }

  async setUserCap(input: { ownerId: string; userId: string; dailyCapMicros: number | null }): Promise<EditResult> {
    this.calls.push("setUserCap");
    this.requireOwner(input.ownerId, "setUserCap");
    const target = this.users.get(input.userId);
    if (!target) return { ok: false, refusal: "no_user", message: "there is no such user" };
    const before = this.userCaps.get(target.id) ?? null;
    if (before === input.dailyCapMicros) return { ok: false, refusal: "no_change", message: "the user already has that cap" };
    if (input.dailyCapMicros !== null && input.dailyCapMicros < 0) throw new RefusedWrite("23514", "cap");
    this.userCaps.set(target.id, input.dailyCapMicros);
    this.userUpdatedAt.set(target.id, this.clock());
    this.auditUserUpdate(input.ownerId, target.id, { role: target.role, status: target.status, cap: before });
    return { ok: true };
  }

  async revokeUserSessions(input: { ownerId: string; userId: string }): Promise<RevokeResult> {
    this.calls.push("revokeUserSessions");
    this.requireOwner(input.ownerId, "revokeUserSessions");
    if (!this.users.has(input.userId)) return { ok: false, refusal: "no_user", message: "there is no such user" };
    let revoked = 0;
    for (const x of this.sessions.values()) {
      if (x.user_id === input.userId && x.revoked_at === null) { x.revoked_at = new Date(this.clock()); revoked += 1; }
    }
    this.auditLog.push({ action: "user.sessions_revoked", actorUserId: input.ownerId, targetType: "studio_users", targetId: input.userId,
      detail: { sessions: revoked } });
    return { ok: true, revoked };
  }

  async setCaps(input: { ownerId: string; dailyCapMicros: number; monthlyCapMicros: number }): Promise<EditResult> {
    this.calls.push("setCaps");
    this.requireOwner(input.ownerId, "setCaps");
    if (!this.settings) return { ok: false, refusal: "no_settings", message: "the settings row does not exist" };
    if (input.dailyCapMicros < 0 || input.monthlyCapMicros < 0) throw new RefusedWrite("23514", "cap");
    const before = { daily_cap_usd: microsToNumeric(this.settings.dailyCapMicros), monthly_cap_usd: microsToNumeric(this.settings.monthlyCapMicros) };
    this.settings.dailyCapMicros = input.dailyCapMicros;
    this.settings.monthlyCapMicros = input.monthlyCapMicros;
    this.auditLog.push({ action: "settings.update", actorUserId: input.ownerId, targetType: "studio_settings", targetId: "singleton",
      detail: { before: JSON.stringify(before), after: JSON.stringify({ daily_cap_usd: microsToNumeric(input.dailyCapMicros),
        monthly_cap_usd: microsToNumeric(input.monthlyCapMicros) }) } });
    return { ok: true };
  }

  async listAudit(action: string | null, limit: number, offset: number): Promise<AuditListRow[]> {
    this.calls.push("listAudit");
    for (let i = this.auditAt.length; i < this.auditLog.length; i += 1) this.auditAt.push(this.clock());
    return this.auditLog.map((entry, index) => ({ entry, index })).filter(({ entry }) => action === null || entry.action === action)
      .reverse().slice(offset, offset + limit).map(({ entry, index }) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, at: new Date(this.auditAt[index]!),
        actorId: entry.actorUserId, actorName: entry.actorUserId === null ? null : this.users.get(entry.actorUserId)?.display_name ?? null,
        action: entry.action, targetType: entry.targetType, targetId: entry.targetId, detail: JSON.stringify(entry.detail),
      }));
  }

  async auditActions(): Promise<string[]> {
    this.calls.push("auditActions");
    return [...new Set(this.auditLog.map((a) => a.action))].sort();
  }

  /** Everything stored, as text: for proving no cookie value or token is ever kept. */
  dump(): string {
    return JSON.stringify({ users: [...this.users.values()], attempts: [...this.attempts], sessions: [...this.sessions],
      audit: this.auditLog });
  }

  private publicRow(user: StudioUserRow & { created_by?: string | null }): StudioUserRow {
    return { id: user.id, email: user.email, google_sub: user.google_sub, display_name: user.display_name, role: user.role,
      status: user.status };
  }
}

// --- S5: synthetic run artifacts -----------------------------------------------

/** The synthetic contact values every fixture uses: a `.invalid` booking host and a 555 number. */
export const SYNTHETIC_SHOP = "Synthetic Shop";
export const SYNTHETIC_PHONE = "555-0100";
export const SYNTHETIC_BOOKING_URL = "https://booking.invalid/synthetic";

/**
 * The stored files of one finished run, in the shapes the CLI writes (stage
 * results `{ output, metadata }`, `05b-contact-lines.json`), with every
 * displayed field marked `<mark>[field]` so a test can find each one. `mark`
 * is the text a hostile-content test puts in every field.
 */
export function syntheticRunArtifacts(mark = "", platforms: readonly string[] = ["instagram", "facebook", "google_business_profile"]):
  Record<string, string> {
  const f = (field: string) => `${mark}[${field}]`;
  const stage = (output: unknown) => JSON.stringify({ output, metadata: { synthetic: true } }, null, 2);
  const contact = (platform: string) => platform === "instagram"
    ? { kind: "deterministic_contact", text: `${f("contact-instagram")}Call ${SYNTHETIC_SHOP}: ${SYNTHETIC_PHONE}`,
      sourceFactIds: ["approved-facts:shop", "approved-facts:phone"] }
    : platform === "facebook"
      ? { kind: "deterministic_contact",
        text: `${f("contact-facebook")}Call ${SYNTHETIC_SHOP}: ${SYNTHETIC_PHONE} · Book online: ${SYNTHETIC_BOOKING_URL}`,
        sourceFactIds: ["approved-facts:shop", "approved-facts:phone", "approved-facts:bookingurl"] }
      : { kind: "deterministic_contact", text: null, gbpCta: { actionType: "BOOK", url: `${SYNTHETIC_BOOKING_URL}?${f("cta")}` },
        sourceFactIds: ["approved-facts:bookingurl"] };
  return {
    "run-meta.json": JSON.stringify({ schema: "gcd-content-run-meta/1", goal: f("goal"), runner: "fake", platforms }, null, 2),
    "03-hook-story-script.json": stage({
      provisional: { kind: "provisional_model_prose", hook: f("hook"),
        storyBeats: [{ beat: f("beat-1"), role: "setup" }, { beat: f("beat-2"), role: "payoff" }], script: f("script"),
        openQuestions: [] },
      claimUse: { kind: "typed_claim_use", used: [] },
    }),
    "04-production-direction.json": stage({
      provisional: {
        visualApproach: f("visual-approach"),
        shots: [0, 1].map((i) => ({ purpose: "hook", subject: f(`shot-${i}-subject`), framing: "close", movement: "static",
          action: f(`shot-${i}-action`), composition: f(`shot-${i}-composition`), continuityNote: f(`shot-${i}-continuity`) })),
        overlayText: [{ text: f("overlay"), shotIndex: 1, role: "headline", wordingVerified: false }],
        productionRequirements: [{ requirement: f("requirement"), category: "location", availabilityVerified: false }],
        openQuestions: [],
      },
      claimVisuals: { kind: "typed_visual_claim_use", used: [] },
    }),
    "05-packaging-adaptation.json": stage({
      provisional: {
        kind: "provisional_model_prose", publishable: false, verified: false, executable: false,
        packages: platforms.map((platform) => ({
          platform, caption: `${f(`caption-${platform}`)}\nSecond line.\r\nThird line.`, captionVerified: false,
          hashtags: platform === "google_business_profile" ? [] : [`#${f(`tag-${platform}`)}`, "#Synthetic"],
          localKeywords: [f(`keyword-${platform}`)], selectionVerified: false, recommendedTime: "09:00 ET", timingVerified: false,
          schedulable: false, openQuestions: [],
        })),
      },
      claimUse: { kind: "typed_packaging_claim_use", used: [] },
    }),
    "05b-contact-lines.json": JSON.stringify({
      schema: "gcd-content-contact-lines/1", note: "Attached by code from approved-facts records after stage 5 validated. Not model-written.",
      packages: platforms.map((platform) => ({ platform, contact: contact(platform) })),
    }, null, 2),
    "06-final-critic.json": stage({ provisional: { verdict: "needs_revision", findings: [], lenses: [] } }),
    "summary.md": `# Content Intelligence local run\n\n- Goal: ${f("goal")}\n`,
  };
}
