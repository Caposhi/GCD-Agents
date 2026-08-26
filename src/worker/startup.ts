export interface WorkerStartupSteps<State, Ownership> {
  initializeState: () => Promise<State>;
  /**
   * Blocks until this process holds exclusive worker ownership.
   *
   * Render zero-downtime deploys keep the OLD worker alive while the NEW one
   * starts, so process start does not imply the old worker is finished. Every
   * step below depends on being the only owner and must not run before this
   * resolves.
   */
  acquireOwnership: (state: State) => Promise<Ownership>;
  /** Starts ownership-loss detection before any recovery write happens. */
  startOwnershipMonitoring: (ownership: Ownership) => void;
  /** Terminalizes work abandoned by a previous owner. Never runs without ownership. */
  reconcileAbandonedWork: (state: State, ownership: Ownership) => Promise<void>;
  initializeRequiredServices: (state: State) => Promise<void>;
  buildReadiness: (state: State) => string;
  startRecurringServices: (state: State) => void;
  emitReadiness: (marker: string) => void;
  consumeQueue: (state: State) => Promise<void>;
}

/**
 * Keep the readiness boundary explicit and independently testable.
 *
 * Readiness asserts four things at once: durable state is initialized, this
 * process holds exclusive worker ownership, work abandoned by a previous owner
 * has been reconciled, and mandatory initialization finished. Anything less
 * would let the deployment controller accept a worker that is not actually
 * consuming, or one racing a predecessor.
 *
 * Ordering notes:
 *  - ownership precedes reconciliation because reconciliation is destructive;
 *  - monitoring starts before reconciliation so ownership lost mid-recovery is
 *    caught rather than written through;
 *  - reconciliation precedes required-service initialization so durable
 *    recovery never depends on an external provider being reachable.
 */
export async function runWorkerStartup<State, Ownership>(
  steps: WorkerStartupSteps<State, Ownership>,
): Promise<void> {
  const state = await steps.initializeState();
  const ownership = await steps.acquireOwnership(state);
  steps.startOwnershipMonitoring(ownership);
  await steps.reconcileAbandonedWork(state, ownership);
  await steps.initializeRequiredServices(state);
  const marker = steps.buildReadiness(state);
  steps.startRecurringServices(state);
  steps.emitReadiness(marker);
  await steps.consumeQueue(state);
}
