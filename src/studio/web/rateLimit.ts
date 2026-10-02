/**
 * In-process, per-client-address rate limits for the sign-in routes
 * (docs/CONTENT_STUDIO_DESIGN.md §7.3: the web is one instance). A fixed
 * window per key, with a bounded number of keys so a flood of addresses
 * cannot grow memory without limit.
 */

export class WindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(readonly limit: number, readonly windowMs: number, readonly maxKeys: number = 10_000) {}

  private current(key: string, now: number): { start: number; count: number } | undefined {
    const window = this.windows.get(key);
    if (window && now - window.start >= this.windowMs) {
      this.windows.delete(key);
      return undefined;
    }
    return window;
  }

  /** Whether `key` is already at its limit, without counting this call. */
  exhausted(key: string, now: number): boolean {
    return (this.current(key, now)?.count ?? 0) >= this.limit;
  }

  /** Counts one event for `key`; false when it is over the limit. */
  hit(key: string, now: number): boolean {
    let window = this.current(key, now);
    if (!window) {
      if (this.windows.size >= this.maxKeys) {
        for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
        // Still full: the oldest key's window is dropped, never the new caller's limit.
        if (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value!);
      }
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return window.count <= this.limit;
  }
}

/** `GET /auth/login`: 20 a minute per address. */
export const LOGIN_LIMIT = { limit: 20, windowMs: 60_000 } as const;
/** `GET /auth/callback`: 20 a minute per address. */
export const CALLBACK_LIMIT = { limit: 20, windowMs: 60_000 } as const;
/** Failed sign-ins: 10 per 15 minutes per address; past that, the callback refuses before any work. */
export const FAILED_SIGN_IN_LIMIT = { limit: 10, windowMs: 15 * 60_000 } as const;
