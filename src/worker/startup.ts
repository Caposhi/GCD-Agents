export interface WorkerStartupSteps<State> {
  initializeState: () => Promise<State>;
  initializeRequiredServices: (state: State) => Promise<void>;
  buildReadiness: (state: State) => string;
  startRecurringServices: (state: State) => void;
  emitReadiness: (marker: string) => void;
  consumeQueue: (state: State) => Promise<void>;
}

/**
 * Keep the readiness boundary explicit and independently testable. The marker
 * is built only after awaited initialization, emitted only after recurring
 * services are installed, and queue consumption begins only after emission.
 */
export async function runWorkerStartup<State>(steps: WorkerStartupSteps<State>): Promise<void> {
  const state = await steps.initializeState();
  await steps.initializeRequiredServices(state);
  const marker = steps.buildReadiness(state);
  steps.startRecurringServices(state);
  steps.emitReadiness(marker);
  await steps.consumeQueue(state);
}
