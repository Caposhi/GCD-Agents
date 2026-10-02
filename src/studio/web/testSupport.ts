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
 *
 * Every address it makes is assembled at run time, and every host is `.test`.
 */

import { createHash, createHmac, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { SignJWT, exportJWK, type JWK, type JWTPayload } from "jose";

import type { OidcProvider } from "./oidc.js";
import type { SessionRow, StudioUserRow } from "./sessions.js";
import type { AuditEntry, WebHealth, WebStore } from "./store.js";

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

  async purge(attemptsExpiredBefore: Date, sessionsEndedBefore: Date): Promise<{ loginAttempts: number; sessions: number }> {
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
    return { loginAttempts, sessions };
  }

  async health(): Promise<WebHealth> {
    if (this.failHealth) throw new Error("store unavailable");
    return {
      schemaVersion: "0002_studio_schema.sql",
      workerHeartbeatAgeSeconds: this.heartbeatAt === null ? null : Math.round((this.clock() - this.heartbeatAt) / 1000),
    };
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
