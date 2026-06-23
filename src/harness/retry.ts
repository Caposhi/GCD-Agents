/**
 * Error/retry with exponential backoff. Used for transient failures (network,
 * rate limits). Posting retries are governed separately by posting-workflow and
 * never bypass the approval gate.
 */

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return true to retry the given error; default retries everything. */
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 2000;
  const max = opts.maxDelayMs ?? 16000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !shouldRetry(err)) break;
      const delay = Math.min(max, base * 2 ** attempt);
      opts.onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }
  throw lastErr;
}
