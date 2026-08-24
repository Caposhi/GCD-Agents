import { createHash, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";

export const MAX_REQUEST_BODY_BYTES = 16 * 1024;
export const MAX_TRIGGER_GOAL_CHARS = 2_000;
export const REQUEST_BODY_TIMEOUT_MS = 10_000;

type HeaderValue = string | string[] | undefined;

export interface AuthHeaders {
  authorization?: HeaderValue;
  sharedToken?: HeaderValue;
}

export type AuthDecision =
  | { ok: true }
  | { ok: false; status: 401 | 503; code: "unauthorized" | "auth_not_configured" };

/**
 * Transitional shared-secret authentication. The existing CONSOLE_TOKEN is used
 * for console, trigger, and diagnostic routes until those surfaces receive
 * separate credentials. Query-string credentials are deliberately unsupported.
 */
export function authorizeSharedSecret(configuredSecret: string | undefined, headers: AuthHeaders): AuthDecision {
  if (!configuredSecret) return { ok: false, status: 503, code: "auth_not_configured" };

  const supplied: string[] = [];
  if (headers.authorization !== undefined) {
    if (Array.isArray(headers.authorization)) return { ok: false, status: 401, code: "unauthorized" };
    const match = headers.authorization.match(/^Bearer[ \t]+([^\s]+)$/i);
    if (!match?.[1]) return { ok: false, status: 401, code: "unauthorized" };
    supplied.push(match[1]);
  }
  if (headers.sharedToken !== undefined) {
    if (Array.isArray(headers.sharedToken)) return { ok: false, status: 401, code: "unauthorized" };
    const token = headers.sharedToken.trim();
    if (!token) return { ok: false, status: 401, code: "unauthorized" };
    supplied.push(token);
  }

  if (supplied.length === 0 || supplied.some((token) => !constantTimeEqual(token, configuredSecret))) {
    return { ok: false, status: 401, code: "unauthorized" };
  }
  return { ok: true };
}

function constantTimeEqual(a: string, b: string): boolean {
  // Hash first so token length is not exposed through timingSafeEqual's required
  // equal-length precondition.
  const ah = createHash("sha256").update(a, "utf8").digest();
  const bh = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ah, bh);
}

export interface TriggerBrief {
  goal: string;
}

export type TriggerParseResult =
  | { ok: true; brief: TriggerBrief }
  | { ok: false; code: "invalid_json" | "invalid_shape" | "invalid_goal" | "goal_too_long" | "unexpected_fields" };

/** Parse the intentionally narrow Phase-0A manual-trigger contract. */
export function parseTriggerBody(raw: string): TriggerParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json" };
  }

  if (!isPlainObject(value)) return { ok: false, code: "invalid_shape" };
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "goal")) return { ok: false, code: "unexpected_fields" };
  if (typeof value.goal !== "string") return { ok: false, code: "invalid_goal" };

  const goal = value.goal.trim();
  if (!goal) return { ok: false, code: "invalid_goal" };
  if (goal.length > MAX_TRIGGER_GOAL_CHARS) return { ok: false, code: "goal_too_long" };
  return { ok: true, brief: { goal } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isJsonContentType(value: HeaderValue): boolean {
  if (typeof value !== "string") return false;
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export interface MediaPath {
  id: string;
  contentSha256?: string;
}

/** Strict internal media route; digestless form remains read-only legacy compatibility. */
export function parseMediaPath(pathname: string): MediaPath | undefined {
  const match = pathname.match(
    /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:-([0-9a-f]{64}))?\.jpg$/i,
  );
  if (!match) return undefined;
  return { id: match[1]!.toLowerCase(), contentSha256: match[2]?.toLowerCase() };
}

/**
 * Validate a credential-bearing diagnostic endpoint before fetch. Callers
 * supply the exact provider hosts appropriate to that diagnostic; suffix and
 * redirect-derived lookalikes are never accepted.
 */
export function isAllowedCredentialEndpoint(
  raw: string,
  allowedHosts: ReadonlySet<string>,
): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.hash === ""
      && allowedHosts.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export class RequestBodyError extends Error {
  constructor(
    readonly status: 400 | 408 | 413,
    readonly code: "body_read_failed" | "body_timeout" | "body_too_large",
  ) {
    super(code);
    this.name = "RequestBodyError";
  }
}

/** Read a request body with hard byte and wall-clock bounds. */
export function readBoundedBody(
  stream: Readable,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<string> {
  const maxBytes = opts.maxBytes ?? MAX_REQUEST_BODY_BYTES;
  const timeoutMs = opts.timeoutMs ?? REQUEST_BODY_TIMEOUT_MS;

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onError);
      stream.removeListener("aborted", onAborted);
    };
    const fail = (err: RequestBodyError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      stream.pause();
      reject(err);
    };
    const onData = (chunk: Buffer | string): void => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        fail(new RequestBodyError(413, "body_too_large"));
        return;
      }
      chunks.push(buf);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, total).toString("utf8"));
    };
    const onError = (): void => fail(new RequestBodyError(400, "body_read_failed"));
    const onAborted = (): void => fail(new RequestBodyError(400, "body_read_failed"));
    const timer = setTimeout(() => fail(new RequestBodyError(408, "body_timeout")), timeoutMs);

    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
    stream.once("aborted", onAborted);
  });
}

export class OperationTimeoutError extends Error {
  constructor() {
    super("operation timed out");
    this.name = "OperationTimeoutError";
  }
}

/** Bound an operation and invoke the supplied cancellation hook at the deadline. */
export function withOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void = () => {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { onTimeout(); } catch { /* cancellation is best-effort; deadline still rejects */ }
      reject(new OperationTimeoutError());
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

interface WindowEntry {
  count: number;
  startedAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Fixed-window limiter with deterministic eviction and a hard memory bound. */
export class BoundedRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly maxEntries = 2_048,
  ) {
    if (limit <= 0 || windowMs <= 0 || maxEntries <= 0) throw new Error("rate-limit bounds must be positive");
  }

  check(key: string, nowMs = Date.now()): RateLimitDecision {
    let entry = this.entries.get(key);
    if (entry && nowMs - entry.startedAt >= this.windowMs) {
      this.entries.delete(key);
      entry = undefined;
    }

    if (!entry) {
      this.makeRoom(nowMs);
      entry = { count: 0, startedAt: nowMs };
      this.entries.set(key, entry);
    }

    const elapsed = Math.max(0, nowMs - entry.startedAt);
    const retryAfterSeconds = Math.max(1, Math.ceil((this.windowMs - elapsed) / 1_000));
    if (entry.count >= this.limit) return { allowed: false, remaining: 0, retryAfterSeconds };

    entry.count += 1;
    return { allowed: true, remaining: Math.max(0, this.limit - entry.count), retryAfterSeconds };
  }

  get size(): number {
    return this.entries.size;
  }

  private makeRoom(nowMs: number): void {
    if (this.entries.size < this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (nowMs - entry.startedAt >= this.windowMs) this.entries.delete(key);
    }
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
