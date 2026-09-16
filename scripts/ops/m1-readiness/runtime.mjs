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

/**
 * How a stop ended, as a fixed vocabulary rather than a boolean.
 *
 * A boolean could only ever say "the promise settled", which is not the same
 * question as "did the work observe cancellation and stop". An operation that
 * ignores its signal and finishes normally a second later has settled, but
 * nothing was cancelled, and reporting that as a confirmed stop is how an
 * operator comes to believe a deadline contained something it did not.
 */
export const STOP_OUTCOME = Object.freeze({
  /** Finished on its own, before any deadline or interrupt. */
  COMPLETED_BEFORE_DEADLINE: "completed_before_deadline",
  /** A stop was requested; the outcome below says what came of it. */
  STOP_REQUESTED: "stop_requested",
  /** The operation observed the signal and ended BECAUSE of it. */
  CANCELLATION_ACKNOWLEDGED: "cancellation_acknowledged",
  /** An external resource (socket, session, child) was independently confirmed closed. */
  EXTERNAL_CLEANUP_CONFIRMED: "external_cleanup_confirmed",
  /** It ignored cancellation and then completed normally. Nothing was cancelled. */
  SETTLED_WITHOUT_CANCELLATION: "settled_without_cancellation",
  /** It never settled within the allowance: something may still be running. */
  STOP_UNCONFIRMED: "stop_unconfirmed",
});

/**
 * Did `error` indicate that the operation ended *because* it observed `signal`?
 *
 * This is the acknowledgement channel. A cooperative operation propagates the
 * abort — as an `AbortError`, as the signal's own abort reason, or as a
 * categorized interruption/deadline error. An operation that returns a value,
 * or throws something unrelated, has not acknowledged anything.
 *
 * @param {{ ok: boolean, value?: unknown, error?: any }} settlement
 * @param {AbortSignal} signal
 */
export const acknowledgedCancellation = (settlement, signal) => {
  if (settlement.ok) return false;
  const error = settlement.error;
  if (error === undefined || error === null) return false;
  if (signal.aborted && error === signal.reason) return true;
  if (error.name === "AbortError" || error.code === "ABORT_ERR") return true;
  // `CategorizedError` carries its category as `gcdCategory`; reading `.category`
  // would silently never match and quietly downgrade every acknowledgement.
  if (
    error.gcdCategory === LOCAL_ERROR_CATEGORIES.INTERRUPTED ||
    error.gcdCategory === LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED
  ) {
    return true;
  }
  const cause = error.cause;
  if (cause && (cause.name === "AbortError" || cause.code === "ABORT_ERR")) return true;
  return false;
};

export class Runtime {
  constructor() {
    this.controller = new AbortController();
    /**
     * The total-run deadline, kept separate from the operator's interrupt so
     * the two can be told apart in the reported category and in evidence.
     */
    this.totalController = new AbortController();
    /** @type {AbortSignal | null} */
    this.composite = null;
    /** @type {string | null} */
    this.deadlineExpiredLabel = null;
    /** @type {Set<() => Promise<void>>} */
    this.cleanups = new Set();
    /** @type {string | null} */
    this.interruptedBy = null;
    /** @type {Array<[NodeJS.Signals, () => void]>} */
    this.installed = [];
    this.shuttingDown = null;
  }

  /**
   * The signal EVERY cancellable operation observes.
   *
   * It composes the operator's interrupt with the total-run deadline, so a
   * total deadline reaches every nested `withDeadline` — every phase, every
   * GitHub request, every database statement — without each call site having
   * to thread it through by hand. Built once; both sources live for the whole
   * run, so there is no listener growth.
   */
  get signal() {
    if (this.composite === null) {
      this.composite = AbortSignal.any([this.controller.signal, this.totalController.signal]);
    }
    return this.composite;
  }

  get interrupted() {
    return this.interruptedBy !== null;
  }

  /** True once the TOTAL deadline has expired, which is not an interrupt. */
  get deadlineExpired() {
    return this.deadlineExpiredLabel !== null;
  }

  /** True when work must stop, for either reason. */
  get stopping() {
    return this.interrupted || this.deadlineExpired;
  }

  /**
   * Bind a total-run deadline to this runtime.
   *
   * Until this is called the runtime knows only about operator interrupts, and
   * a total deadline would be a number in a report rather than a bound on the
   * program. Returns an unlink for the success path.
   *
   * @param {AbortSignal} signal @param {string} label
   */
  linkTotalDeadline(signal, label) {
    const onExpire = () => {
      if (this.deadlineExpiredLabel !== null) return;
      this.deadlineExpiredLabel = label;
      this.totalController.abort(
        new CategorizedError(LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED, `${label} deadline expired`),
      );
    };
    if (signal.aborted) {
      onExpire();
      return () => {};
    }
    signal.addEventListener("abort", onExpire, { once: true });
    return () => signal.removeEventListener("abort", onExpire);
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
  /** @type {{ ok: boolean, value?: unknown, error?: unknown } | null} */
  let settlement = null;
  // Never rejects: the outcome is carried as a value so the operation can be
  // awaited after a stop without producing an unhandled rejection. The
  // settlement itself is retained, because HOW it ended is what distinguishes
  // an acknowledged cancellation from a late normal completion.
  const operation = (async () => fn(signal))().then(
    (value) => {
      settled = true;
      settlement = { ok: true, value };
      return settlement;
    },
    (error) => {
      settled = true;
      settlement = { ok: false, error };
      return settlement;
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

  const unlinkTotal = options.linkAsTotal ? runtime.linkTotalDeadline(deadline.signal, label) : null;

  try {
    const first = await Promise.race([operation, stopped]);
    if (first !== STOPPED) {
      if (first.ok) return first.value;
      throw first.error;
    }

    // Cancellation is best effort; the confirmation below is not.
    let externalCleanupConfirmed = false;
    try {
      const confirmed = await options.onCancel?.();
      // A cleanup that returns `true` is asserting it INDEPENDENTLY established
      // the resource is gone (a socket `close` event seen, a child reaped) —
      // not merely that it asked. Anything else is left unconfirmed.
      externalCleanupConfirmed = confirmed === true;
    } catch {
      /* the categorized outcome below is what actually reports what happened */
    }
    if (options.confirmCleanup) {
      try {
        externalCleanupConfirmed = (await options.confirmCleanup()) === true;
      } catch {
        externalCleanupConfirmed = false;
      }
    }
    await settleWithin(operation, options.settleMs ?? CANCELLATION_SETTLE_MS);

    // --- the truthful part -------------------------------------------------
    //
    // `settled` alone only says the promise finished. It cannot distinguish an
    // operation that observed the signal and stopped from one that ignored it
    // and happened to finish. Those are different facts and an operator acts on
    // them differently, so they are reported as different outcomes.
    let stopOutcome;
    if (!settled) {
      stopOutcome = STOP_OUTCOME.STOP_UNCONFIRMED;
    } else if (acknowledgedCancellation(/** @type {any} */ (settlement), signal)) {
      stopOutcome = STOP_OUTCOME.CANCELLATION_ACKNOWLEDGED;
    } else if (externalCleanupConfirmed) {
      stopOutcome = STOP_OUTCOME.EXTERNAL_CLEANUP_CONFIRMED;
    } else {
      stopOutcome = STOP_OUTCOME.SETTLED_WITHOUT_CANCELLATION;
    }

    const wording = {
      [STOP_OUTCOME.CANCELLATION_ACKNOWLEDGED]: "was cancelled and acknowledged the cancellation",
      [STOP_OUTCOME.EXTERNAL_CLEANUP_CONFIRMED]:
        "did not acknowledge cancellation, but its external resources were confirmed released",
      [STOP_OUTCOME.SETTLED_WITHOUT_CANCELLATION]:
        "ignored cancellation and then completed normally; nothing was cancelled",
      [STOP_OUTCOME.STOP_UNCONFIRMED]: "was told to stop but never confirmed it finished",
    }[stopOutcome];

    const error = new CategorizedError(
      runtime.interrupted
        ? LOCAL_ERROR_CATEGORIES.INTERRUPTED
        : LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED,
      `${label} ${wording}`,
    );
    // The operation's own failure is preserved, so an operator can see WHICH
    // phase refused to start rather than only that the run was stopped.
    if (settlement && settlement.ok === false) error.cause = settlement.error;
    error.stopOutcome = stopOutcome;
    error.externalCleanupConfirmed = externalCleanupConfirmed;
    error.settledAfterStop = settled;
    error.stoppedBy = runtime.interrupted ? "operator" : "deadline";
    // Deliberately narrow: true ONLY for an acknowledged cancellation. A late
    // normal completion is not a cancellation, however tidy it looked.
    error.confirmedStopped = stopOutcome === STOP_OUTCOME.CANCELLATION_ACKNOWLEDGED;
    throw error;
  } finally {
    deadline.cancel();
    removeAbortListener?.();
    unlinkTotal?.();
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
export const checkpoint = (runtime, label, signal = null) => {
  if (runtime.interrupted) {
    throw new CategorizedError(LOCAL_ERROR_CATEGORIES.INTERRUPTED, `${label} not started`);
  }
  // The total deadline is NOT an interrupt, and saying so matters: an operator
  // who reads "interrupted" concludes a person stopped the run.
  if (runtime.deadlineExpired) {
    throw new CategorizedError(
      LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED,
      `${label} not started: the total deadline expired`,
    );
  }
  if (signal?.aborted) {
    throw new CategorizedError(
      LOCAL_ERROR_CATEGORIES.DEADLINE_EXCEEDED,
      `${label} not started: the run was stopped`,
    );
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
