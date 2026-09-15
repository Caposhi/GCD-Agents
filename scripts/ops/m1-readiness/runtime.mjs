/**
 * Interruption and deadline plumbing.
 *
 * One `Runtime` is created per run. It owns:
 *
 *   - the abort signal every cancellable operation observes;
 *   - the ordered set of cleanups that must complete before the process exits;
 *   - the INT / TERM / HUP handlers.
 *
 * On a signal the runtime stops new work, aborts in-flight GitHub and database
 * operations, awaits every registered cleanup, and the caller then exits
 * nonzero. What it does NOT do is claim more than it can establish: it does not
 * read `/proc`, it does not match process names, and it makes no assertion
 * about descendants of a child it did not create. The containment it does
 * offer is concrete — every child process it spawned is signalled and AWAITED,
 * and every database socket it opened is destroyed and awaited — and that is
 * exactly what the evidence records.
 */

import { setTimeout as delay } from "node:timers/promises";
import { CategorizedError, LOCAL_ERROR_CATEGORIES } from "../lib/errorCategories.mjs";
import { CANCELLATION_SETTLE_MS } from "./deadlines.mjs";

/** The signals an operator uses to stop an evidence run. */
export const HANDLED_SIGNALS = Object.freeze(["SIGINT", "SIGTERM", "SIGHUP"]);

export class Runtime {
  constructor() {
    this.controller = new AbortController();
    /** @type {Set<() => Promise<void>>} */
    this.cleanups = new Set();
    /** @type {string | null} */
    this.interruptedBy = null;
    /** @type {Array<[NodeJS.Signals, () => void]>} */
    this.installed = [];
    this.shuttingDown = null;
  }

  get signal() {
    return this.controller.signal;
  }

  get interrupted() {
    return this.interruptedBy !== null;
  }

  /**
   * Install the INT / TERM / HUP handlers.
   *
   * @param {(signal: string) => void} onSignal invoked once, synchronously, so
   *   the caller can begin its own shutdown; the runtime has already aborted.
   */
  installSignalHandlers(onSignal) {
    for (const name of HANDLED_SIGNALS) {
      const handler = () => {
        if (this.interruptedBy !== null) return;
        this.interruptedBy = name;
        this.controller.abort(new CategorizedError(LOCAL_ERROR_CATEGORIES.INTERRUPTED, name));
        onSignal(name);
      };
      process.on(name, handler);
      this.installed.push([name, handler]);
    }
  }

  removeSignalHandlers() {
    for (const [name, handler] of this.installed) process.off(name, handler);
    this.installed = [];
  }

  /**
   * Register a cleanup that must complete before the process exits.
   *
   * @param {() => Promise<void>} fn
   * @returns {() => void} unregister, for the ordinary success path
   */
  registerCleanup(fn) {
    this.cleanups.add(fn);
    return () => this.cleanups.delete(fn);
  }

  /**
   * Run every registered cleanup and await all of them, whatever they throw.
   * Idempotent: concurrent callers share one shutdown.
   */
  async shutdown() {
    if (this.shuttingDown) return this.shuttingDown;
    this.shuttingDown = (async () => {
      const pending = [...this.cleanups];
      this.cleanups.clear();
      const results = await Promise.allSettled(pending.map((fn) => fn()));
      return results.filter((r) => r.status === "rejected").length;
    })();
    return this.shuttingDown;
  }
}

/**
 * A deadline as an abort signal, backed by a timer that KEEPS THE EVENT LOOP
 * ALIVE.
 *
 * `AbortSignal.timeout` is deliberately not used: its timer is unref'd, so a
 * run whose only pending work is the deadline itself would let Node exit before
 * the deadline could fire, and the operation would appear to vanish rather than
 * to time out. The returned `cancel` MUST be called on the success path, or the
 * process would linger until the deadline elapsed.
 *
 * @param {number} ms
 */
export const deadlineSignal = (ms) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
};

/**
 * Run `fn` under a fixed deadline and the runtime's interrupt signal, and —
 * when the deadline or an interrupt wins — CANCEL the underlying work and AWAIT
 * its confirmed stop before returning.
 *
 * A bare `Promise.race` is deliberately not used. `race` only decides which
 * promise to report; the loser keeps running, keeps its socket open, and can
 * still write its output minutes later. A deadline that abandons work rather
 * than stopping it is not a deadline, it is a reporting delay.
 *
 * So the sequence on a stop is always: observe the abort, invoke
 * `options.onCancel` (destroy the socket, signal and reap the child), then wait
 * for the operation itself to settle. If it does not settle within
 * {@link CANCELLATION_SETTLE_MS} the thrown error says so via
 * `confirmedStopped === false`, rather than the caller being told a clean
 * timeout that did not happen.
 *
 * The deadline is passed in by the caller from `deadlines.mjs`; this function
 * has no default and reads no environment, so there is no path by which a
 * deployment could acquire a longer one.
 *
 * @template T
 * @param {Runtime} runtime
 * @param {string} label
 * @param {number} ms
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @param {{ onCancel?: () => Promise<void> | void, settleMs?: number }} [options]
 * @returns {Promise<T>}
 */
export const withDeadline = async (runtime, label, ms, fn, options = {}) => {
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new Error(`${label}: deadline must be a positive integer`);
  }
  const deadline = deadlineSignal(ms);
  const signal = AbortSignal.any([runtime.signal, deadline.signal]);
  const STOPPED = Symbol("stopped");

  let settled = false;
  // Never rejects: the outcome is carried as a value so the operation can be
  // awaited after a stop without producing an unhandled rejection.
  const operation = (async () => fn(signal))().then(
    (value) => {
      settled = true;
      return { ok: true, value };
    },
    (error) => {
      settled = true;
      return { ok: false, error };
    },
  );

  /** @type {(() => void) | null} */
  let removeAbortListener = null;
  const stopped = new Promise((resolve) => {
    if (signal.aborted) {
      resolve(STOPPED);
      return;
    }
    const onAbort = () => resolve(STOPPED);
    signal.addEventListener("abort", onAbort, { once: true });
    // Removed on every exit path, so a completed call leaves no listener behind.
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    const first = await Promise.race([operation, stopped]);
    if (first !== STOPPED) {
      if (first.ok) return first.value;
      throw first.error;
    }

    // Cancellation is best effort; the confirmation below is not.
    try {
      await options.onCancel?.();
    } catch {
      /* the wait for confirmed settlement is what actually reports the outcome */
    }
    await settleWithin(operation, options.settleMs ?? CANCELLATION_SETTLE_MS);

    const error = new CategorizedError(
      runtime.interrupted ? LOCAL_ERROR_CATEGORIES.INTERRUPTED : LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED,
      settled
        ? `${label} was stopped and confirmed finished`
        : `${label} was stopped but did not confirm it finished`,
    );
    error.confirmedStopped = settled;
    throw error;
  } finally {
    deadline.cancel();
    removeAbortListener?.();
  }
};

/**
 * Throw if the runner has already been told to stop.
 *
 * Called at every phase boundary so an interrupt or an expired deadline is
 * observed BEFORE the next phase starts, rather than after it has run.
 *
 * @param {Runtime} runtime @param {string} label
 */
export const checkpoint = (runtime, label) => {
  if (runtime.interrupted) {
    throw new CategorizedError(LOCAL_ERROR_CATEGORIES.INTERRUPTED, `${label} not started`);
  }
};

/**
 * Await a promise but never longer than `ms`, resolving either way.
 *
 * Used only for teardown, where a hung close must not become a hung process and
 * where the follow-up (destroying the socket, SIGKILLing the child) is
 * unconditional.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 */
export const settleWithin = async (promise, ms) => {
  await Promise.race([promise.then(() => undefined, () => undefined), delay(ms)]);
};
