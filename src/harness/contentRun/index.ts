/**
 * The content-run pipeline library (Content Studio S1).
 *
 * The pipeline core that `scripts/local/content-run.mjs` used to hold, moved
 * here unchanged in behaviour so the CLI and the Content Studio worker (S3)
 * run the same code (docs/CONTENT_STUDIO_DESIGN.md §5.1). It loads every stage
 * executor, so only those two callers may import it, and no live `gcd-social-*`
 * entry point may reach it; the offline suite enforces both (§5.4).
 */

export { loadRuntime, type ContentRunRuntime } from "./runtime.js";
export type {
  CostCeiling, CostCeilingLine, FactFile, MeasurementRow, MeasurementWrite, PaidActionConsent, PaidActionKind,
  PaidActionRequest, RecordedRequest, RunFacts, RunFailureContext, RunIo, RunnerKind, RunOptions, RunOutputs,
  RunReporter, RunSink, RunSource, UnprovenFactsConfirmation, UnprovenFactsDecision, UnprovenFactsNotice,
} from "./types.js";
export {
  EvidenceScopeError, alwaysIncludedIds, buildRunEvidence, countTags, effectiveEvidenceScope,
  evidencePackFingerprint, factFileAt, factFingerprint, loadAutomotiveFactsFile, loadRecords, normalizeScopeTags,
  parseAutomotiveFacts, sha256OfBytes, type EvidenceScope, type RunFingerprints, type TagCounts,
} from "./evidence.js";
export {
  RESUME_POINTS, allStagePolicies, computeCostCeiling, criticLensPolicies, priceTableSha256, resumePolicies,
  revisionPolicies,
} from "./pricing.js";
export { buildFakeStageResponses, fakeStageRunner } from "./fakes.js";
export { createRunRecorder, measureFields, measurementTable, recordingRunner } from "./recording.js";
export { markdownSummary, revisionSummaryLines, summaryFooter } from "./summary.js";
export { REUSED_STAGE_FILES, nowFromRunDirName, readSavedStage, verifySourceRun } from "./verify.js";
export { WRITER_STAGE_FILES, replayCritic, resumeFromPackaging, reviseRun, runFullPipeline } from "./pipeline.js";
export { refuseUnprovenAutomotiveFacts } from "./consent.js";
export {
  REVIEW_ONLY_CALLERS, REVIEW_ONLY_CONTEXT_KEYS, ReviewOnlyContextError, createReviewOnlyExecutionContext,
  isReviewOnlyExecutionContext, requireReviewOnlyExecutionContext,
  type ReviewOnlyCaller, type ReviewOnlyExecutionContext, type ReviewOnlyRequestCheck, type ReviewOnlyRequestUnit,
} from "./executionContext.js";

/**
 * Every artifact name a run of each kind can write, derived from this library
 * rather than from any database: the Studio stores exactly these (§4.2).
 * `rejected-responses.json` appears only when a paid response was refused.
 */
export const RUN_ARTIFACT_NAMES = {
  "full-run": [
    "run-meta.json", "01-strategy-concept.json", "02-automotive-truth.json", "03-hook-story-script.json",
    "04-production-direction.json", "05-packaging-adaptation.json", "05b-contact-lines.json", "06-final-critic.json",
    "summary.md", "field-measurements.json", "field-measurements.md",
  ],
  resume: [
    "run-meta.json", "01-strategy-concept.json", "02-automotive-truth.json", "03-hook-story-script.json",
    "04-production-direction.json", "resume-meta.json", "05-packaging-adaptation.json", "05b-contact-lines.json",
    "06-final-critic.json", "summary.md", "field-measurements.json", "field-measurements.md",
  ],
  "critic-replay": [
    "replay-meta.json", "05b-contact-lines.json", "06-final-critic.json", "field-measurements.json",
    "field-measurements.md",
  ],
  revision: [
    "run-meta.json", "01-strategy-concept.json", "02-automotive-truth.json", "03-hook-story-script.json",
    "04-production-direction.json", "05-packaging-adaptation.json", "round-1-06-final-critic.json",
    "revision-meta.json", "05b-contact-lines.json", "06-final-critic.json", "summary.md", "field-measurements.json",
    "field-measurements.md",
  ],
  failure: ["rejected-responses.json"],
} as const;
