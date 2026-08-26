/**
 * How the worker stops, and with what exit code.
 *
 * There are exactly two ways a running worker ends, and they are not the same
 * shutdown:
 *
 *  - SHUTDOWN: an expected SIGTERM while ownership is still held. The active
 *    brief unwinds through its own path and writes its own terminal state; the
 *    process exits 0. Ownership is handed over explicitly ONLY if that unwind
 *    actually completed — releasing the lock while this process might still be
 *    executing side-effecting code would create the dual-owner state ownership
 *    exists to prevent. On drain timeout the lock is instead left to die with
 *    the session at process exit.
 *
 *  - OWNERSHIP_LOST: this process is no longer authorized to write anything,
 *    and a successor may already be reconciling its row. It performs no
 *    reconciliation, never releases (the lock is already gone with the session),
 *    and exits NONZERO so the platform restarts it into the ordinary
 *    acquisition path. Exiting is the point: recurring timers and pooled
 *    connections keep the event loop alive, so simply stopping the queue loop
 *    would leave a healthy-looking process that never consumes again.
 */

export type WorkerExitMode = "shutdown" | "ownership_lost";

export const SHUTDOWN_DRAIN_MS = 20_000;
/**
 * Shorter than the shutdown drain: after ownership loss nothing this process
 * does can be written, so the wait is only about letting the active brief stop
 * touching providers before the process dies.
 */
export const OWNERSHIP_LOSS_DRAIN_MS = 10_000;
export const OWNERSHIP_LOSS_EXIT_CODE = 1;
export const SHUTDOWN_EXIT_CODE = 0;
/** Neither the escalation nor the pool teardown may delay exit indefinitely. */
export const EXIT_STEP_TIMEOUT_MS = 5_000;

export interface WorkerExitSteps {
  /** Resolves true when the active brief finished, false on timeout. */
  drainActiveWork(timeoutMs: number): Promise<boolean>;
  stopRecurringServices(): void;
  /** Best effort; the database may be the thing that failed. */
  escalate(reason: string): Promise<void>;
  closeState(): Promise<void>;
  releaseOwnership(): Promise<void>;
  log(message: string): void;
}

export interface WorkerExitResult {
  code: number;
  drained: boolean;
  releasedOwnership: boolean;
  /** Ordered step names, so tests can assert the sequence itself. */
  steps: string[];
}

export async function finalizeWorkerExit(
  mode: WorkerExitMode,
  steps: WorkerExitSteps,
  options: { reason?: string; drainMs?: number } = {},
): Promise<WorkerExitResult> {
  const executed: string[] = [];
  const record = async (name: string, run: () => Promise<void> | void): Promise<void> => {
    executed.push(name);
    try {
      await run();
    } catch {
      // No cleanup step may prevent the process from exiting.
    }
  };

  const drainMs = options.drainMs
    ?? (mode === "ownership_lost" ? OWNERSHIP_LOSS_DRAIN_MS : SHUTDOWN_DRAIN_MS);

  executed.push("drain");
  let drained = false;
  try {
    drained = await steps.drainActiveWork(drainMs);
  } catch {
    drained = false;
  }

  await record("stopRecurringServices", () => steps.stopRecurringServices());

  if (mode === "ownership_lost") {
    await record("escalate", () => steps.escalate(
      options.reason
      ?? "Worker lost exclusive ownership and is exiting for restart. "
        + "Any in-flight brief is left for the next exclusive owner to reconcile.",
    ));
  }

  await record("closeState", () => steps.closeState());

  let releasedOwnership = false;
  if (mode === "shutdown" && drained) {
    await record("releaseOwnership", () => steps.releaseOwnership());
    releasedOwnership = true;
  } else if (mode === "shutdown") {
    steps.log(
      "[worker] active brief did not finish within the drain window; exiting without releasing "
      + "ownership so the lock dies with this session and no successor can start while this "
      + "process may still be running",
    );
  }

  const code = mode === "ownership_lost" ? OWNERSHIP_LOSS_EXIT_CODE : SHUTDOWN_EXIT_CODE;
  steps.log(`[worker] exiting ${code} after ${mode}`);
  return { code, drained, releasedOwnership, steps: executed };
}
