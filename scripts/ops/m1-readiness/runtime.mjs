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
 * Reject when `signal` aborts, distinguishing a deadline from an interrupt.
 *
 * @param {AbortSignal} signal
 * @param {string} label the operation name, chosen in source
 * @param {number} ms the deadline, for the message
 * @param {Runtime} runtime
 */
const rejectOnAbort = (signal, label, ms, runtime) =>
  new Promise((_resolve, reject) => {
    const fire = () => {
      if (runtime.interrupted) {
        reject(new CategorizedError(LOCAL_ERROR_CATEGORIES.INTERRUPTED, `${label} interrupted`));
      } else {
        reject(
          new CategorizedError(
            LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED,
            `${label} exceeded its fixed ${ms}ms deadline`,
          ),
        );
      }
    };
    if (signal.aborted) {
      fire();
      return;
    }
    signal.addEventListener("abort", fire, { once: true });
  });

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
 * Run `fn` under a fixed deadline and the runtime's interrupt signal.
 *
 * The deadline is passed in by the caller from `deadlines.mjs`; this function
 * has no default and reads no environment, so there is no path by which a
 * deployment could acquire a longer one.
 *
 * `fn` receives the combined signal so a cancellable operation (an HTTP fetch)
 * really is cancelled. For an operation that cannot observe a signal, the race
 * bounds the WAIT, and the caller's `finally` is what destroys the resource —
 * which is why every such caller in this runner tears down in a `finally` and
 * awaits it.
 *
 * @template T
 * @param {Runtime} runtime
 * @param {string} label
 * @param {number} ms
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export const withDeadline = async (runtime, label, ms, fn) => {
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error(`${label}: deadline must be a positive integer`);
  const deadline = deadlineSignal(ms);
  const signal = AbortSignal.any([runtime.signal, deadline.signal]);
  try {
    return await Promise.race([fn(signal), rejectOnAbort(signal, label, ms, runtime)]);
  } finally {
    deadline.cancel();
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
