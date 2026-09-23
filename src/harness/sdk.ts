/**
 * Subagent execution via the Anthropic Messages API (single-shot prompt → text).
 *
 * Our subagents are single-turn "produce JSON per your contract" calls, so we
 * use the Messages API directly rather than the agentic Claude Agent SDK (which
 * spawns the Claude Code CLI runtime — heavy, and hangs in a headless worker).
 * No tools are registered here; tool use (image gen, posting) is orchestrated
 * deterministically in code, not delegated to the model.
 */

import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import {
  ModelPolicyError,
  thinkingEffortViolation,
  type StageEffortLevel,
  type StageThinkingPolicy,
} from "./agents/modelPolicy.js";
import {
  STAGE_REQUEST_MAX_RETRIES,
  STAGE_REQUEST_SETUP_TIMEOUT_MS,
  stageStreamDeadlineMs,
} from "./agents/payloadContract.js";

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

// Rough USD per 1M tokens, for the cost meter (not billing-accurate).
const PRICE: Record<string, { in: number; out: number }> = {
  // Phase 0B.1 resolves the "reasoning-heavy" policy to Opus 5; without a row
  // here its cost meter would silently report undefined. Additive only — no
  // existing model's price and no existing call site changes.
  "claude-opus-5": { in: 5, out: 25 },
  // The Content Intelligence `critic` policy resolves to Opus 5.5. Additive
  // only, like the Opus 5 row above — no legacy call site sends this id.
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  // The canonical Haiku 4.5 id carries no date suffix. The dated snapshot id
  // stays priced because it remains a valid, still-served pin an operator could
  // restore; both name the same model at the same published rate.
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};
/**
 * The published rate a model id is metered at, or `undefined` if it has none.
 *
 * Exported so an offline regression can prove every id this module can send
 * carries a price row. Without one, `costUsd` returns `undefined` and a run's
 * spend stops being counted silently rather than failing.
 */
export function legacyModelPriceUsdPerMTok(
  model: string,
): { in: number; out: number } | undefined {
  return PRICE[model];
}

function costUsd(model: string, usage: any): number | undefined {
  const p = PRICE[model];
  if (!p || !usage) return undefined;
  return ((usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out) / 1e6;
}

export interface AgentRunResult {
  text: string;
  totalCostUsd: number | undefined;
  usage: Record<string, number> | undefined;
}

export interface AgentRunOptions {
  systemPrompt: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  /** Omitted for legacy calls; Content Intelligence stages set this explicitly. */
  thinking?: StageThinkingPolicy;
  /**
   * JSON Schema constraining the response, sent as `output_config.format`.
   *
   * Structured outputs make a non-JSON response impossible at generation time
   * rather than merely forbidden in prose. Every stage prompt already says "no
   * markdown fence"; on 2026-09-21 a stage-3 response arrived fenced anyway and
   * a paid call was discarded for it. An instruction the model may disregard is
   * replaced here by a constraint it cannot.
   *
   * Note what this does NOT do: Anthropic's structured outputs support
   * `type`, `properties`, `required`, `additionalProperties`, `enum`, `const`
   * and string formats, but **not** `maxLength`, `maxItems`, `minimum` or
   * `pattern`. Size ceilings therefore remain the prompt's and the validator's
   * job; the schema carries them in `description` only, as guidance.
   */
  responseFormatSchema?: Record<string, unknown>;
}

/**
 * The complete set of SDK request options this module sends.
 *
 * Typed exhaustively on purpose. The retry policy used to be absent from this
 * type and therefore absent from every regression that inspected a request,
 * which is how the SDK's default of two retries survived unnoticed underneath a
 * documented "exactly one model request" guarantee.
 */
export interface LegacyRequestOptions {
  /** Milliseconds. The TypeScript SDK measures timeouts in milliseconds. */
  timeout: number;
  /** Wire-level retries the SDK may take. `undefined` means the SDK default. */
  maxRetries: number | undefined;
}

export type AgentMessageCreator = (
  request: Anthropic.MessageCreateParamsNonStreaming,
  options: LegacyRequestOptions,
) => Promise<Anthropic.Message>;

/**
 * The legacy, non-streaming request options.
 *
 * `maxRetries: undefined` keeps the SDK default of two retries for the legacy
 * agent and vision paths, which are unchanged by the Content Intelligence
 * request policy and are not covered by any one-request guarantee.
 */
const LEGACY_REQUEST_OPTIONS: LegacyRequestOptions = { timeout: 90_000, maxRetries: undefined };

/**
 * The model id a legacy caller gets when it declares none.
 *
 * Still `claude-sonnet-4-6` on purpose. This is the "no model pinned" path, not
 * an agent's routing decision, and `agents/brand-compliance-critic.md` still
 * pins this id — so the fallback continues to match a live pin rather than
 * naming a model nothing uses. Moving it is deliberately left to the change
 * that routes that agent.
 */
const LEGACY_DEFAULT_MODEL = "claude-sonnet-4-6";

/**
 * The ids **this legacy path routes** on which omitting `thinking` runs
 * adaptive thinking, and which are therefore pinned thinking-off here.
 *
 * Whether an omitted `thinking` means adaptive thinking or none at all is a
 * property of the model id — `claude-sonnet-5` thinks, `claude-haiku-4-5` and
 * `claude-sonnet-4-6` do not — so the distinction is recorded once here rather
 * than rediscovered at each call site. This set is not a complete catalogue of
 * every model with that property; see the exclusion below.
 *
 * Why it matters on the legacy path specifically: these requests are
 * non-streaming, default to `max_tokens: 3000`, and run under a 90-second
 * timeout. `max_tokens` is a hard ceiling on *total* output — thinking tokens
 * and visible text share it — and `collect()` accumulates only `text` blocks.
 * So a silently thinking legacy request spends part of a small budget on
 * tokens the caller never sees, and `parseAgentJson` degrades a truncated
 * reply to `{_raw: ...}` instead of throwing. Every legacy agent must return
 * strict JSON, so that failure would be quiet and downstream.
 *
 * **`claude-opus-5` is deliberately absent**, though it also thinks by
 * omission. The only caller that sends it through this path is the dormant
 * manager in `agentLoop.ts`, whose thinking behaviour is owned separately
 * (PR #75) and recorded as a deliberately open consequence in
 * `docs/ENVIRONMENT.md` under `MANAGER_MODEL`. Adding it here would silently
 * close that open decision from outside its scope, so the id a reviver of that
 * path must handle stays that path's to handle.
 */
const THINKING_ON_OMISSION = new Set<string>(["claude-sonnet-5"]);

/**
 * The thinking configuration a legacy request actually sends.
 *
 * An explicit caller value always wins — Content Intelligence stages set their
 * thinking themselves, through `modelPolicy.ts`, and are unaffected by this rule. Otherwise a
 * model that would think by omission is pinned thinking-off, which preserves
 * the behaviour every legacy caller has today, and a model that would not think
 * by omission still sends no `thinking` key at all, which keeps those requests
 * byte-identical to what they send today.
 */
export function resolveLegacyThinking(
  model: string,
  explicit: StageThinkingPolicy | undefined,
): StageThinkingPolicy | undefined {
  if (explicit) return explicit;
  return THINKING_ON_OMISSION.has(model) ? { type: "disabled" } : undefined;
}

function buildRequest(opts: AgentRunOptions): {
  model: string;
  request: Anthropic.MessageCreateParamsNonStreaming;
} {
  const model = opts.model || LEGACY_DEFAULT_MODEL;
  const thinking = resolveLegacyThinking(model, opts.thinking);
  return {
    model,
    request: {
      model,
      max_tokens: opts.maxTokens ?? 3000,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.prompt }],
      ...(thinking ? { thinking } : {}),
      ...(opts.responseFormatSchema
        ? {
          output_config: {
            format: { type: "json_schema" as const, schema: opts.responseFormatSchema },
          },
        }
        : {}),
    },
  };
}

/**
 * Execute the exact production text request through an injectable Messages
 * creator. The seam exists so an offline regression can inspect every byte of
 * the SDK request without a credential or provider call.
 *
 * **Legacy path.** Non-streaming, SDK-default retries, 90-second timeout —
 * unchanged. Content Intelligence stages use `runStageAgent` instead.
 */
export async function runAgentWithMessageCreator(
  opts: AgentRunOptions,
  createMessage: AgentMessageCreator,
): Promise<AgentRunResult> {
  const { model, request } = buildRequest(opts);
  const res = await createMessage(request, LEGACY_REQUEST_OPTIONS);
  return collect(res, model);
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  return runAgentWithMessageCreator(
    opts,
    (request, options) => getClient().messages.create(request, {
      timeout: options.timeout,
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    }),
  );
}

/**
 * The Content Intelligence stage request boundary.
 *
 * Four things differ from the legacy path, and each is a correction rather
 * than a preference:
 *
 *  - **Retries are disabled** (`STAGE_REQUEST_MAX_RETRIES`). The SDK default of
 *    two meant one wrapper call was up to three wire requests, so neither the
 *    "exactly one model request" guarantee nor the `modelRequests: 1` metadata
 *    described what actually reached a provider.
 *  - **The request streams.** A stage's derived `max_tokens` budget is tens of
 *    thousands of tokens; the Anthropic SDKs require streaming at that size
 *    precisely because a non-streaming request cannot hold an HTTP connection
 *    open long enough to receive it. `finalMessage()` reassembles the complete
 *    response, so callers see the same `Anthropic.Message` either way and no
 *    stage handles stream events.
 *  - **Two separate bounds, because the SDK only implements one of them.**
 *    `requestSetupTimeoutMs` is the SDK's `timeout` option, and in the pinned
 *    SDK that timer is armed around the underlying `fetch` and cleared in a
 *    `finally` the moment it resolves — which for a streaming request is when
 *    response *headers* arrive. Everything after that is `MessageStream`
 *    consuming events with no timer at all, so a stalled stream would hang
 *    indefinitely. `streamDeadlineMs` is therefore enforced here: a timer armed
 *    before the stream is consumed, aborting it if the deadline passes, cleared
 *    in a `finally` on both success and failure.
 *
 *  - **A response must finish its turn.** `stop_reason` is checked before any
 *    content is read: `max_tokens`, `refusal` and every other reason but
 *    `end_turn` raise a named error carrying the complete provider message.
 *    There is no fallback to another model. `collect()`, which the legacy path
 *    shares, is unchanged.
 *
 * A streaming request is still exactly one request: `messages.stream` opens one
 * HTTP connection and, with retries disabled, never opens a second. The
 * deadline aborts that one connection; it never opens another.
 */

/**
 * A stage request's options: the legacy text options plus a declared effort.
 *
 * `effort` exists **only here**, not on `AgentRunOptions`, so no legacy caller
 * can set it and the legacy request stays byte-identical. Stage callers take it
 * from `resolveModelPolicy`, which reads it from `POLICY_EFFORT` — the one
 * place an effort is declared — and `buildStageRequest` re-checks the same
 * thinking/effort invariant where the request is actually built.
 */
export interface StageRunOptions extends AgentRunOptions {
  /** Sent as `output_config.effort`. Omitted: no `effort` key is sent at all. */
  effort?: StageEffortLevel;
}

/**
 * The exact stage request: the legacy request, plus `output_config.effort` when
 * the stage declares one.
 *
 * Built on top of `buildRequest` rather than inside it, so the shared builder —
 * and with it every legacy request — is untouched. Throws the same
 * `ModelPolicyError` `resolveModelPolicy` throws for a pairing the model
 * rejects, before any stream is opened: a caller that bypassed the policy table
 * still cannot send a knowable 400.
 */
function buildStageRequest(opts: StageRunOptions): {
  model: string;
  request: Anthropic.MessageCreateParamsNonStreaming;
} {
  const { model, request } = buildRequest(opts);
  if (request.thinking && (request.thinking.type === "disabled" || request.thinking.type === "adaptive")) {
    const violation = thinkingEffortViolation(model, request.thinking, opts.effort);
    if (violation) throw new ModelPolicyError(`stage request: ${violation}`);
  }
  if (opts.effort === undefined) return { model, request };
  return {
    model,
    request: {
      ...request,
      output_config: { ...(request.output_config ?? {}), effort: opts.effort },
    },
  };
}

/**
 * A stage response truncated at `max_tokens`.
 *
 * Structured output cut off mid-object cannot validate, so without this the
 * failure would surface as "output was not strict JSON" — true, and useless.
 * Named here with the model, the budget and the usage, so the operator can see
 * whether thinking or the answer consumed the budget.
 */
export class StageOutputTruncatedError extends Error {
  readonly model: string;
  readonly maxTokens: number;
  readonly usage: Record<string, number> | undefined;
  /** The provider's complete response, kept so the caller can save what it paid for. */
  readonly response: Anthropic.Message;
  constructor(model: string, maxTokens: number, response: Anthropic.Message) {
    const usage = usageOf(response);
    super(
      `stage response from ${model} stopped at max_tokens (${maxTokens}) before completing; `
      + `usage ${JSON.stringify(usage ?? {})}`,
    );
    this.name = "StageOutputTruncatedError";
    this.model = model;
    this.maxTokens = maxTokens;
    this.usage = usage;
    this.response = response;
  }
}

/**
 * A stage request the model declined (`stop_reason: "refusal"`).
 *
 * **A visible failure, never a fallback.** No `fallbacks` parameter and no
 * fallback middleware is used anywhere in the stage path: a fallback answers
 * silently with a different model, and a stage whose model identity is recorded
 * in its metadata must not be served by another. `stop_details` is guarded
 * because it may be `null`.
 */
export class StageRefusalError extends Error {
  readonly model: string;
  readonly category: string | null;
  readonly explanation: string | null;
  readonly response: Anthropic.Message;
  constructor(model: string, response: Anthropic.Message) {
    const details = response.stop_details ?? null;
    const category = details?.category ?? null;
    const explanation = details?.explanation ?? null;
    super(
      `stage request to ${model} was refused (stop_reason "refusal"; category `
      + `${category === null ? "not reported" : `"${category}"`}; explanation `
      + `${explanation === null ? "not reported" : JSON.stringify(explanation)})`,
    );
    this.name = "StageRefusalError";
    this.model = model;
    this.category = category;
    this.explanation = explanation;
    this.response = response;
  }
}

/**
 * A stage response that ended for any reason other than `end_turn`, `max_tokens`
 * or `refusal` — `stop_sequence`, `tool_use`, `pause_turn`, or a value this SDK
 * does not know. A stage sends no stop sequence and registers no tool, so none
 * of those is a completed answer, and none is treated as one.
 */
export class StageUnexpectedStopError extends Error {
  readonly model: string;
  readonly stopReason: string | null;
  readonly response: Anthropic.Message;
  constructor(model: string, response: Anthropic.Message) {
    const stopReason = (response.stop_reason as string | null | undefined) ?? null;
    super(
      `stage response from ${model} ended with stop_reason `
      + `${stopReason === null ? "null" : `"${stopReason}"`}, not "end_turn"`,
    );
    this.name = "StageUnexpectedStopError";
    this.model = model;
    this.stopReason = stopReason;
    this.response = response;
  }
}

/**
 * Refuse a stage response that did not finish its turn.
 *
 * Stage path only. `collect()` is shared with the deployed legacy path and is
 * deliberately not changed: a legacy response is still collected exactly as
 * before, whatever its stop reason.
 */
function assertStageResponseComplete(
  response: Anthropic.Message,
  model: string,
  maxTokens: number,
): void {
  switch (response.stop_reason) {
    case "end_turn":
      return;
    case "max_tokens":
      throw new StageOutputTruncatedError(model, maxTokens, response);
    case "refusal":
      throw new StageRefusalError(model, response);
    default:
      throw new StageUnexpectedStopError(model, response);
  }
}

/** The complete set of SDK request options a stage request sends. */
export interface StageRequestOptions {
  /**
   * Bounds request **setup** only — the fetch up to streaming response headers.
   * This is what the SDK's `timeout` option actually covers.
   */
  requestSetupTimeoutMs: number;
  /**
   * Bounds the **entire** streaming lifecycle, including event consumption
   * after headers. Enforced by this module, not by the SDK.
   */
  streamDeadlineMs: number;
  /** Wire-level retries the SDK may take. Zero for every stage request. */
  maxRetries: number;
}

/**
 * The stream surface this module needs, and nothing more.
 *
 * Narrow on purpose: an offline test can supply a stream that never finishes,
 * or one that finishes immediately, without a credential, a provider, or a
 * real `MessageStream`.
 */
export interface StageStream {
  finalMessage(): Promise<Anthropic.Message>;
  abort(): void;
}

export type StageStreamOpener = (
  request: Anthropic.MessageCreateParamsNonStreaming,
  options: StageRequestOptions,
) => StageStream;

/**
 * The timer surface, injectable so a test can prove the deadline fires and the
 * timer is cleared without waiting the real 35–67 minutes.
 */
export interface StageTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const REAL_TIMERS: StageTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * A stage stream aborted for exceeding its total deadline.
 *
 * Distinct from a request-setup timeout, which the SDK raises as its own abort
 * error: this one means headers arrived and then the stream stopped producing.
 * `invokeStage` wraps whatever a runner throws in a `StageExecutionError`, so
 * this reaches a caller as the same fail-closed stage error as every other
 * model-request failure, with its message preserved.
 */
export class StageStreamDeadlineError extends Error {
  readonly deadlineMs: number;
  readonly maxOutputTokens: number;
  constructor(deadlineMs: number, maxOutputTokens: number) {
    super(
      `stage stream exceeded its ${deadlineMs}ms total deadline for ${maxOutputTokens} `
      + "max output tokens and was aborted",
    );
    this.name = "StageStreamDeadlineError";
    this.deadlineMs = deadlineMs;
    this.maxOutputTokens = maxOutputTokens;
  }
}

export function stageRequestOptionsFor(maxOutputTokens: number): StageRequestOptions {
  return {
    requestSetupTimeoutMs: STAGE_REQUEST_SETUP_TIMEOUT_MS,
    streamDeadlineMs: stageStreamDeadlineMs(maxOutputTokens),
    maxRetries: STAGE_REQUEST_MAX_RETRIES,
  };
}

export async function runStageAgentWithStreamOpener(
  opts: StageRunOptions,
  openStream: StageStreamOpener,
  timers: StageTimers = REAL_TIMERS,
): Promise<AgentRunResult> {
  const { model, request } = buildStageRequest(opts);
  const options = stageRequestOptionsFor(request.max_tokens);

  // Opened once. The deadline aborts this stream; it never opens another.
  const stream = openStream(request, options);
  let deadlineExpired = false;
  const handle = timers.setTimeout(() => {
    deadlineExpired = true;
    stream.abort();
  }, options.streamDeadlineMs);

  try {
    const response = await stream.finalMessage();
    // Checked before `collect()` reads any content: a truncated, refused or
    // otherwise unfinished response is a named failure, never stage output.
    assertStageResponseComplete(response, model, request.max_tokens);
    return collect(response, model);
  } catch (error) {
    // A deadline abort surfaces from the SDK as a generic user-abort error.
    // Naming it here is what makes the failure legible instead of looking like
    // an unexplained cancellation.
    if (deadlineExpired) {
      throw new StageStreamDeadlineError(options.streamDeadlineMs, request.max_tokens);
    }
    throw error;
  } finally {
    timers.clearTimeout(handle);
  }
}

export async function runStageAgent(opts: StageRunOptions): Promise<AgentRunResult> {
  return runStageAgentWithStreamOpener(opts, (request, options) => {
    const stream = getClient().messages.stream(request, {
      timeout: options.requestSetupTimeoutMs,
      maxRetries: options.maxRetries,
    });
    return {
      finalMessage: () => stream.finalMessage(),
      abort: () => stream.abort(),
    };
  });
}

export interface VisionRunOptions {
  systemPrompt: string;
  prompt: string;
  jpegBase64: string;
  model?: string;
  maxTokens?: number;
  /**
   * Omitted keeps whatever the model does by default. `runVision` builds its
   * own request rather than going through `buildRequest`, so without this field
   * a vision model that thinks by omission could not be pinned thinking-off at
   * all — and this path's `max_tokens` budget is smaller than the legacy text
   * path's, not larger.
   */
  thinking?: StageThinkingPolicy;
}

/** Single-shot vision call: inspect a JPEG and return the model's text. */
export async function runVision(opts: VisionRunOptions): Promise<AgentRunResult> {
  const model = opts.model || LEGACY_DEFAULT_MODEL;
  const thinking = resolveLegacyThinking(model, opts.thinking);
  const res = await getClient().messages.create(
    {
      model,
      max_tokens: opts.maxTokens ?? 1000,
      ...(thinking ? { thinking } : {}),
      system: opts.systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: opts.jpegBase64 } },
            { type: "text", text: opts.prompt },
          ],
        },
      ],
    },
    LEGACY_REQUEST_OPTIONS,
  );
  return collect(res, model);
}

/** Usage in the shape `collect()` reports it, for the stage error classes. */
function usageOf(res: Anthropic.Message): Record<string, number> | undefined {
  const u = res.usage;
  return u
    ? {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: (u as any).cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: (u as any).cache_creation_input_tokens ?? 0,
      }
    : undefined;
}

function collect(res: Anthropic.Message, model: string): AgentRunResult {
  let text = "";
  for (const block of res.content) {
    if (block.type === "text") text += block.text;
  }
  const u = res.usage;
  const usage = u
    ? {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: (u as any).cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: (u as any).cache_creation_input_tokens ?? 0,
      }
    : undefined;
  return { text, totalCostUsd: costUsd(model, u), usage };
}
