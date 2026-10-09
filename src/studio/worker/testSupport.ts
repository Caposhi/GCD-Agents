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
import { legacyModelPriceUsdPerMTok, runStageAgentWithStreamOpener, type StageTimers } from "../../harness/sdk.js";
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

/** How one scripted provider response ends (Content Studio S6b). */
export type ProviderOutcome = "end_turn" | "refusal" | "max_tokens" | "error" | "deadline";

/** One provider request the stub's scripted stream was opened for: what the real request builder sent. */
export interface ProviderOpen {
  index: number;
  model: string;
  maxTokens: number;
  /** The SDK option the real stage path passes: always 0 (no retry). */
  maxRetries: number;
  lens: string | undefined;
  outcome: ProviderOutcome;
  usage: { input_tokens: number; output_tokens: number };
}

/** Distinct token counts per request, so a charge that is not usage × price cannot match by accident. */
export const syntheticUsage = (index: number) => ({ input_tokens: 1_200 + 37 * index, output_tokens: 800 + 13 * index });

/**
 * The micro-dollars the repository's price table charges for a usage: tokens × USD per million tokens is
 * exactly micro-dollars. Undefined for a model with no price row.
 */
export function usageMicros(model: string, usage: { input_tokens: number; output_tokens: number }): number | undefined {
  const price = legacyModelPriceUsdPerMTok(model);
  return price ? usage.input_tokens * price.in + usage.output_tokens * price.out : undefined;
}

/**
 * Content Studio S6b: the REAL provider runner with only the network replaced. Each call goes through the
 * library's own `createAnthropicStageRunner` (what `main.ts` constructs) and sdk.ts's own
 * `runStageAgentWithStreamOpener` (what it delegates to) — the real request builder, the real `stop_reason`
 * checks, the real usage and cost — and the one thing injected is the stream: a scripted
 * `Anthropic.Message` built from a fake run's texts (by lens for the critic panel, else in stage order), with
 * synthetic usage. A response can instead end in a refusal or at max_tokens, fail with a provider error and no
 * response, or hang until the stage's own stream deadline fires (the timers are injected for that one call).
 * No client is built, no key is read and no request leaves the process.
 */
export function providerShapedRunner(
  transcript: { stages: string[]; lenses: Map<string, string> },
  hooks: {
    outcome?: (open: { index: number; lens: string | undefined }) => ProviderOutcome;
    onOpen?: (open: ProviderOpen) => void;
    during?: (open: ProviderOpen) => Promise<void> | void;
  } = {},
): PaidStageRunner & { opens: ProviderOpen[] } {
  const opens: ProviderOpen[] = [];
  let next = 0;
  const factory = lib.loadRuntime().stageExecution.createAnthropicStageRunner;
  const runner = (async (request: { lens?: string }) => {
    const lens = request.lens;
    const text = (lens ? transcript.lenses.get(lens) : transcript.stages[next++]) ?? "{}";
    let deadline = false;
    const timers: StageTimers = {
      setTimeout: (callback, ms) => setTimeout(callback, deadline ? 0 : ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    const real = factory((opts) => runStageAgentWithStreamOpener(opts, (params, options) => {
      const index = opens.length;
      const outcome = hooks.outcome?.({ index, lens }) ?? "end_turn";
      const open: ProviderOpen = { index, model: params.model, maxTokens: params.max_tokens, maxRetries: options.maxRetries, lens,
        outcome, usage: syntheticUsage(index) };
      opens.push(open);
      hooks.onOpen?.(open);
      deadline = outcome === "deadline";
      let abort: () => void = () => {};
      const aborted = new Promise<never>((_settle, fail) => {
        abort = () => fail(Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" }));
      });
      aborted.catch(() => undefined);
      return {
        finalMessage: async () => {
          await hooks.during?.(open);
          if (outcome === "deadline") return aborted;
          if (outcome === "error") {
            throw Object.assign(new Error('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded (synthetic)"}}'),
              { name: "InternalServerError", status: 529 });
          }
          return {
            id: `msg_synthetic_${index}`, type: "message", role: "assistant", model: params.model,
            content: [{ type: "text", text: outcome === "end_turn" ? text : text.slice(0, 16), citations: null }],
            stop_reason: outcome, stop_sequence: null,
            stop_details: outcome === "refusal" ? { type: "refusal", category: null, explanation: "synthetic refusal" } : null,
            usage: { ...open.usage, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } as never;
        },
        abort: () => abort(),
      };
    }, timers));
    return real(request as never);
  }) as unknown as PaidStageRunner & { opens: ProviderOpen[] };
  runner.opens = opens;
  return runner;
}
