/**
 * Shared fixtures for the Studio worker's two suites. Synthetic only: a
 * clearly fake automotive-facts fixture, in-memory sinks, and a replaying fake
 * stage runner. No customer data, no facts-file content, no booking link
 * beyond what `config/approved-facts.json` already holds (which the library
 * reads, and these helpers never copy).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as lib from "../../harness/contentRun/index.js";
import type { FactFile, RecordedRequest, RunIo, RunSink } from "../../harness/contentRun/index.js";
import type { PaidStageRunner } from "./execute.js";

/** Four synthetic records, plainly labelled as such. */
export function syntheticFactsBytes(): Buffer {
  return Buffer.from(JSON.stringify({
    facts: [0, 1, 2, 3].map((i) => ({
      id: `synthetic-worker-fact-${i}`,
      claim: `SYNTHETIC WORKER TEST FIXTURE ${i} - not a real automotive fact.`,
      subject: "synthetic-worker-subject",
      attribute: `synthetic-worker-attr-${i}`,
      tags: i < 2 ? ["worker-scope", "synthetic-worker"] : ["synthetic-worker"],
      sourceType: "repository_config",
      sourceRef: "synthetic://worker-test-fixture",
      provenance: "synthetic worker test fixture; not a real source",
      reviewedAt: "2026-09-01T00:00:00.000Z",
    })),
  }, null, 2), "utf8");
}

export function memoryFact(bytes: Buffer | null, displayPath: string): FactFile {
  return {
    path: `memory:${displayPath}`, displayPath,
    exists: () => bytes !== null,
    read: async () => { if (!bytes) throw new Error("absent"); return new Uint8Array(bytes); },
  };
}

export function repoFacts(repoRoot: string, automotive: Buffer | null = syntheticFactsBytes()) {
  return {
    approvedFacts: memoryFact(readFileSync(resolve(repoRoot, "config/approved-facts.json")), "config/approved-facts.json"),
    automotiveFacts: memoryFact(automotive, "config/automotive-facts.local.json"),
  };
}

/** An in-memory run sink that keeps every artifact and every recorded response. */
export function memorySink(label = "memory-run"): RunSink & { files: Map<string, Buffer>; recorded: RecordedRequest[] } {
  const files = new Map<string, Buffer>();
  const recorded: RecordedRequest[] = [];
  return {
    label, files, recorded,
    writeArtifact: (name, bytes) => { files.set(name, typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)); },
    recordRequest: (entry) => { recorded.push(entry); },
  };
}

export function memoryIo(sink: RunSink, extra: Partial<RunIo> = {}): RunIo {
  return {
    reporter: { log: () => {}, warn: () => {} },
    consent: async () => {},
    confirmUnproven: lib.refuseUnprovenAutomotiveFacts,
    outputs: { openFullRun: () => sink, openDerivedRun: () => sink },
    ...extra,
  };
}

/**
 * The raw texts a fake full run's stages return, in request order (stages 1-5)
 * and by lens (the critic panel): what a replaying runner serves.
 */
export async function fakeTranscript(repoRoot: string, goal: string): Promise<{ stages: string[]; lenses: Map<string, string> }> {
  const sink = memorySink();
  await lib.runFullPipeline(lib.loadRuntime(), {
    runner: "fake", facts: repoFacts(repoRoot), goal, reviewedAt: new Date().toISOString(), reviewedAtExplicit: false,
  }, memoryIo(sink));
  return {
    stages: sink.recorded.filter((r) => !r.lens).map((r) => String(r.text)),
    lenses: new Map(sink.recorded.filter((r) => r.lens).map((r) => [String(r.lens), String(r.text)])),
  };
}

export interface ReplayCall { index: number; lens: string | undefined; model: string }

/**
 * A fake stage runner standing in for the provider on a paid path: it replays
 * a fake run's texts, records every call, and lets a test act during a call
 * (cancel, measure, hang) and choose each response's cost.
 */
export function replayRunner(
  transcript: { stages: string[]; lenses: Map<string, string> },
  hooks: {
    during?: (call: ReplayCall) => Promise<void> | void;
    costUsd?: (call: ReplayCall) => number | undefined;
    fail?: (call: ReplayCall) => boolean;
  } = {},
): PaidStageRunner & { calls: ReplayCall[] } {
  const calls: ReplayCall[] = [];
  let next = 0;
  const runner = (async (request: { lens?: string; model: string }) => {
    const call: ReplayCall = { index: calls.length, lens: request.lens, model: request.model };
    calls.push(call);
    const text = request.lens ? transcript.lenses.get(request.lens) : transcript.stages[next++];
    await hooks.during?.(call);
    if (hooks.fail?.(call)) throw new Error("replay runner: a simulated network failure with no response");
    const costUsd = hooks.costUsd ? hooks.costUsd(call) : 0.01;
    return { text: text ?? "{}", ...(costUsd === undefined ? {} : { totalCostUsd: costUsd }), usage: { input_tokens: 10, output_tokens: 20 } };
  }) as unknown as PaidStageRunner & { calls: ReplayCall[] };
  runner.calls = calls;
  return runner;
}
