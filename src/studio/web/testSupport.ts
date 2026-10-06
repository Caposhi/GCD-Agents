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
  ActionContext, AuditEntry, CancelResult, ConfirmHooks, ConfirmResult, PreflightView, PurgeResult, SpendView, WebHealth, WebStore,
} from "./store.js";

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
    return { loginAttempts, sessions, preflightRequests };
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
  readonly jobs = new Map<string, { id: string; runId: string | null; kind: "preflight" | "paid" | "fake"; state: string;
    cancelRequested: boolean }>();
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
    return this.ledger.filter((row) => row.entry === "overrun" && !this.auditLog.some((a) => a.action === "spend.overrun_acknowledged"
      && a.targetType === "studio_runs" && a.targetId === row.runId
      && [...this.users.values()].some((u) => u.id === a.actorUserId && u.role === "owner"))).map((row) => row.runId);
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
