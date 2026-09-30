/**
 * The run's record-keeping: a transcript of every raw provider response, and
 * the field measurements written beside every run, passing or failing. Moved
 * from `scripts/local/content-run.mjs` (Content Studio S1); every file goes
 * through the run's `RunSink`.
 */

import type { ContentRunRuntime } from "./runtime.js";
import type { MeasurementRow, MeasurementWrite, RecordedRequest, RunSink } from "./types.js";

/** Settle a sink's results: nothing to wait for from a synchronous sink. */
export function settled(results: Array<void | Promise<void>>): void | Promise<void> {
  const pending = results.filter((r): r is Promise<void> => r instanceof Promise);
  return pending.length ? Promise.all(pending).then(() => undefined) : undefined;
}

/**
 * The run's record-keeping: a transcript of every raw provider response, and
 * the field measurements. Shared by the full run and the replay.
 */
export function createRunRecorder(rt: Pick<ContentRunRuntime, "payloadContract" | "packaging">, sink: RunSink) {
  const { OUTPUT_FIELD_BOUNDS, statedCeiling } = rt.payloadContract;
  const {
    PLATFORM_PACKAGING_POLICY, PACKAGING_LIMITS, proposedProviderText, effectiveLocalKeywordMax,
    effectiveCaptionBudget, statedCaptionBudget,
  } = rt.packaging;
  const policyFor = (platform: string) =>
    (PLATFORM_PACKAGING_POLICY as Record<string, { hashtagMax?: number } | undefined>)[platform];
  // Validation runs after the provider returns, and one rejection ends the run
  // with no retry — so a response that fails a size ceiling is a response the
  // operator has already paid for. Record every raw response as it arrives; on
  // failure the catch handler writes them next to the run. This changes no
  // validation outcome: a rejected payload is still rejected, and nothing
  // recorded here is ever read back as stage output.
  const transcript: RecordedRequest[] = [];
  // Every run, fake or live, passing or failing, measures what it received, so
  // the next field that outgrows its limit arrives as data rather than as
  // another paid round trip.
  const writeMeasurements = (): MeasurementWrite => {
    const rows = measureFields(transcript, {
      bounds: OUTPUT_FIELD_BOUNDS, statedCeiling, providerText: proposedProviderText,
      // The same caps the stage 5 validator applies: the caption budget is the
      // smaller of the provider and pipeline limits, less the contact-line
      // reserve that the deterministic contact line is appended into. The
      // prompt states a target below it (`statedCaptionBudget`), so the row
      // reports both.
      platformCaps: (platform: string) => ({
        caption: policyFor(platform) ? effectiveCaptionBudget(platform as never) : 0,
        captionStated: policyFor(platform) ? statedCaptionBudget(platform as never) : 0,
        hashtags: Math.min(policyFor(platform)?.hashtagMax ?? 0, PACKAGING_LIMITS.maxHashtags),
        localKeywords: policyFor(platform) ? effectiveLocalKeywordMax(platform as never) : 0,
      }),
    });
    const written = settled([
      sink.writeArtifact("field-measurements.json", JSON.stringify(rows, null, 2)),
      sink.writeArtifact("field-measurements.md", measurementTable(rows)),
    ]);
    return { rows, written };
  };
  return { transcript, writeMeasurements };
}

/**
 * Wrap a stage runner so every response — and every response a stop-reason
 * error carries — is recorded before anything else happens to it.
 *
 * The stage boundary refuses a response that stopped at `max_tokens`, was
 * refused, or ended for any other reason than `end_turn`, and raises a named
 * error carrying the provider's complete message. That message was billed, so
 * it is saved exactly like a response a validator rejected.
 */
export function recordingRunner(
  transcript: RecordedRequest[], stage: string, inner: (...callArgs: any[]) => Promise<any>, sink: RunSink,
) {
  return async (...callArgs: any[]) => {
    // The critic panel labels each request with its lens; every saved response
    // and every measurement row carries it, so four lens responses stay apart.
    const lens = typeof callArgs[0]?.lens === "string" ? callArgs[0].lens : undefined;
    let response;
    try {
      response = await inner(...callArgs);
    } catch (error: any) {
      const message = error?.response;
      if (message && typeof message === "object") {
        const text = Array.isArray(message.content)
          ? message.content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
          : null;
        transcript.push({
          stage,
          ...(lens ? { lens } : {}),
          receivedAt: new Date().toISOString(),
          failure: error?.name ?? "Error",
          stopReason: message.stop_reason ?? null,
          stopDetails: message.stop_details ?? null,
          chars: typeof text === "string" ? text.length : null,
          usage: message.usage ?? null,
          text,
          rawResponse: message,
        });
        const recorded = sink.recordRequest(transcript[transcript.length - 1]!);
        if (recorded) await recorded;
      }
      throw error;
    }
    transcript.push({
      stage,
      ...(lens ? { lens } : {}),
      receivedAt: new Date().toISOString(),
      chars: typeof response?.text === "string" ? response.text.length : null,
      usage: response?.usage ?? null,
      totalCostUsd: response?.totalCostUsd ?? null,
      text: response?.text ?? null,
    });
    const recorded = sink.recordRequest(transcript[transcript.length - 1]!);
    if (recorded) await recorded;
    return response;
  };
}

/**
 * Every output field's observed size against its limit, for every response the
 * run received — accepted or rejected, fake or live.
 *
 * Measured from the raw provider text, not the validated output, so a response
 * that failed a ceiling is measured too: that is the one that matters. Keys are
 * `OUTPUT_FIELD_BOUNDS`' own `<stage>.<field token>` — `final-critic:<lens>.<field
 * token>` for a critic lens response — so each row carries the
 * enforced limit, the figure the prompt states, and the field's class. The
 * binding size is UTF-8 bytes — every bound caps code units and bytes with one
 * number, and bytes are never fewer. Stage 5's caption and hashtag count are
 * measured per platform — the caption as the provider-visible text the
 * validator compares — against that platform's effective cap and the lower
 * target the prompt states, and so is the
 * local keyword count. Read-only:
 * nothing here changes a validation outcome.
 */
export function measureFields(
  transcript: RecordedRequest[],
  { bounds, statedCeiling, platformCaps, providerText }: {
    bounds: Record<string, { enforced: number; class?: string } | undefined>;
    statedCeiling: (key: string, enforced: number) => number;
    platformCaps: (platform: string) => { caption: number; captionStated: number; hashtags: number; localKeywords: number };
    providerText: (caption: string, tags: string[]) => string;
  },
): MeasurementRow[] {
  const rows: MeasurementRow[] = [];
  const bytes = (text: string) => Buffer.byteLength(text, "utf8");
  const row = (
    stage: string, field: string, observed: number, enforced: number, stated: number, fieldClass: string | undefined,
  ) => rows.push({
    stage, field, observed, enforced, stated, class: fieldClass,
    pctOfStated: stated > 0 ? Math.round((observed / stated) * 100) : null, over: observed > enforced,
  });
  for (const { stage: stageId, lens, text } of transcript) {
    // A critic lens response is measured against its own lens's contract.
    const stage = lens ? `${stageId}:${lens}` : stageId;
    let raw: any;
    try { raw = JSON.parse(text as string); } catch { rows.push({ stage, field: "(response)", observed: "not JSON" }); continue; }
    const seen = new Map<string, number>();
    const note = (path: string, n: number) => seen.set(path, Math.max(seen.get(path) ?? 0, n));
    const walk = (value: unknown, path: string): void => {
      if (typeof value === "string") note(path, bytes(value));
      else if (Array.isArray(value)) { note(path, value.length); value.forEach((v) => walk(v, `${path}[]`)); }
      else if (value && typeof value === "object") {
        for (const [key, v] of Object.entries(value)) walk(v, path ? `${path}.${key}` : key);
      }
    };
    walk(raw, "");
    for (const [path, observed] of seen) {
      const key = `${stage}.${path}`;
      const bound = bounds[key];
      if (!bound || key === "packaging-adaptation.packages[].caption"
        || key === "packaging-adaptation.packages[].hashtags"
        || key === "packaging-adaptation.packages[].localKeywords") continue;
      row(stage, path, observed, bound.enforced, statedCeiling(key, bound.enforced), bound.class);
    }
    for (const pkg of (stageId === "packaging-adaptation" && Array.isArray(raw?.packages) ? raw.packages : []) as any[]) {
      if (typeof pkg?.caption !== "string") continue;
      const caps = platformCaps(pkg.platform);
      const tags: string[] = Array.isArray(pkg.hashtags) ? pkg.hashtags.filter((t: unknown) => typeof t === "string") : [];
      row(stage, `packages[${pkg.platform}].caption+hashtags`, bytes(providerText(pkg.caption, tags)),
        caps.caption, caps.captionStated, "product-bearing");
      row(stage, `packages[${pkg.platform}].hashtags`, tags.length, caps.hashtags, caps.hashtags, "product-bearing");
      if (Array.isArray(pkg.localKeywords)) {
        row(stage, `packages[${pkg.platform}].localKeywords`, pkg.localKeywords.length,
          caps.localKeywords, caps.localKeywords, "product-bearing");
      }
    }
  }
  return rows;
}

export function measurementTable(rows: MeasurementRow[]): string {
  const lines = ["# Field measurements", "",
    "Observed size of every bounded output field against its limit, per provider response. "
      + "Sizes are UTF-8 bytes (never fewer than characters). `stated` is what the prompt tells the model.", "",
    "| stage | field | class | observed | stated | enforced | % of stated | over |",
    "|---|---|---|---:|---:|---:|---:|---|"];
  for (const r of rows) {
    lines.push(`| ${r.stage} | \`${r.field}\` | ${r.class ?? ""} | ${r.observed} | ${r.stated ?? ""} | `
      + `${r.enforced ?? ""} | ${r.pctOfStated ?? ""} | ${r.over ? "**OVER**" : ""} |`);
  }
  return `${lines.join("\n")}\n`;
}
