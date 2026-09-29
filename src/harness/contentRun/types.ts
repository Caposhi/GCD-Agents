/**
 * The seams between the content-run pipeline and whoever calls it.
 *
 * The library never touches a terminal, never decides where a run is stored,
 * and never decides on its own that money may be spent. Its caller supplies
 * each of those through the interfaces below. Today the only caller is
 * `scripts/local/content-run.mjs`; the Content Studio worker (S3) is the
 * second (docs/CONTENT_STUDIO_DESIGN.md §5.1).
 */

/** Progress and warning lines. The CLI prints them to the console. */
export interface RunReporter {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * One raw provider response as the run received it — accepted, refused by a
 * validator, or carried by a stop-reason error. The same object the run keeps
 * in its transcript and, on failure, writes to `rejected-responses.json`.
 */
export type RecordedRequest = Record<string, unknown> & { stage: string; lens?: string };

/**
 * Where one run's artifacts go.
 *
 * `writeArtifact` receives exactly the bytes a file of that name holds; the
 * library never writes anything else. `recordRequest` is told about every
 * provider response as it arrives, before anything validates it. A synchronous
 * sink (the CLI's) returns nothing and keeps the failure path synchronous; an
 * asynchronous one (the Studio worker's, later) returns a promise, which the
 * library awaits on every success path.
 */
export interface RunSink {
  /** Names the run in messages — the CLI's run directory. */
  readonly label: string;
  writeArtifact(name: string, bytes: string | Uint8Array): void | Promise<void>;
  recordRequest(entry: RecordedRequest): void | Promise<void>;
}

/** A saved run the library reads back: the source of a replay, resume or revision. */
export interface RunSource {
  /** Names the source in messages — the CLI's source run directory, as given. */
  readonly label: string;
  /** The label recorded in a new run's metadata (a repository-relative path where the CLI can make one). */
  readonly displayLabel: string;
  /** The source's own name: a run directory's timestamp, for runs that predate run-meta.json. */
  readonly name: string;
  exists(): boolean | Promise<boolean>;
  /** A saved artifact's bytes, or undefined when the source holds no artifact of that name. */
  readArtifact(name: string): Promise<Uint8Array | undefined>;
}

/** A facts input: `config/approved-facts.json`, or the operator's automotive facts file. */
export interface FactFile {
  /** Names the file in messages (the CLI's resolved path). */
  readonly path: string;
  /** Recorded in run metadata (repository-relative where possible). */
  readonly displayPath: string;
  exists(): boolean;
  /** The file's exact bytes. Throws, as a file read does, when it is absent. */
  read(): Promise<Uint8Array>;
}

export interface RunFacts {
  approvedFacts: FactFile;
  automotiveFacts: FactFile;
}

/** One priced model request in a cost ceiling. */
export interface CostCeilingLine {
  label: string;
  policy: string;
  model: string;
  maxTokens: number;
  inputTokensEstimate: number;
  /** Undefined when the model has no row in the estimate's price table. */
  costUsd: number | undefined;
}

/**
 * The rough, not billing-accurate ceiling for exactly the requests one paid
 * action makes. Computed as data; the CLI prints it and the Studio will show it.
 */
export interface CostCeiling {
  lines: CostCeilingLine[];
  /** The sum of every priced line; an unpriced line adds nothing. */
  totalUsd: number;
  /** Every model-bearing policy the estimate checked. */
  policiesChecked: string[];
  policyMaxTokens: Record<string, number>;
}

export type PaidActionKind = "full-run" | "resume" | "critic-replay" | "revision";

export interface PaidActionRequest {
  kind: PaidActionKind;
  /** e.g. "one full six-stage run", "one revision round from production-direction". */
  label: string;
  ceiling: CostCeiling;
  /** Set on a full run that `--revise-once` will follow: the most requests that round can make. */
  revisionRoundMaxRequests?: number;
}

/**
 * The paid-action gate. Called for a live runner only, after every free check
 * and after pricing, and before the first request exists. It resolves to allow
 * the requests and throws to refuse them; the library builds no runner and
 * creates no output until it resolves. The CLI's gate is the cost flag and the
 * typed word LIVE; the Studio worker's will be a consumed quote with a live
 * reservation.
 */
export type PaidActionConsent = (request: PaidActionRequest) => Promise<void>;

/**
 * What a replay asks before continuing from a source run that predates the
 * automotive-facts fingerprint, so the facts file's identity cannot be proven.
 */
export interface UnprovenFactsNotice {
  automotiveFactsDisplayPath: string;
  currentSha256: string | null;
}

export type UnprovenFactsDecision = { confirmed: true } | { confirmed: false; reason: string };

/**
 * The `UNPROVEN` confirmation. The CLI asks the operator to type UNPROVEN; the
 * Studio worker uses `refuseUnprovenAutomotiveFacts`, which always refuses.
 */
export type UnprovenFactsConfirmation = (notice: UnprovenFactsNotice) => Promise<UnprovenFactsDecision>;

/**
 * Everything the library needs to put right on a failure: the raw responses the
 * run already paid for, the field measurements, and (for a revision) the final
 * metadata write. Handed to the caller as soon as the run's output exists, and
 * withdrawn (null) where a run starts that must not write into an earlier one.
 */
export interface RunFailureContext {
  sink: RunSink;
  transcript: RecordedRequest[];
  /** Writes both measurement files through the sink and returns the rows. */
  writeMeasurements(): MeasurementWrite;
  /** A revision's: records `status: "failed"` in revision-meta.json. */
  finalize?(error: unknown): void | Promise<void>;
}

export interface MeasurementRow {
  stage: string;
  field: string;
  observed: number | string;
  enforced?: number;
  stated?: number;
  class?: string;
  pctOfStated?: number | null;
  over?: boolean;
}

export interface MeasurementWrite {
  rows: MeasurementRow[];
  /** Undefined for a synchronous sink; otherwise settles once both files are written. */
  written: void | Promise<void>;
}

/** Where a new run's outputs are created. Called once per run, after consent. */
export interface RunOutputs {
  /** A full run's output, named by its instant. */
  openFullRun(spec: { now: number }): RunSink | Promise<RunSink>;
  /**
   * A new sibling of `source` for a replay, resume or revision. Refuses, rather
   * than overwriting, when one of that name already exists.
   */
  openDerivedRun(spec: {
    kind: "critic-replay" | "resume" | "revision";
    source: RunSource;
    at: Date;
    resumeAt?: string;
  }): RunSink | Promise<RunSink>;
}

/** The injected collaborators every pipeline function takes. */
export interface RunIo {
  reporter: RunReporter;
  consent: PaidActionConsent;
  confirmUnproven: UnprovenFactsConfirmation;
  outputs: RunOutputs;
  onFailureContext?(context: RunFailureContext | null): void;
}

export type RunnerKind = "fake" | "live";

/** The inputs a run is given — the CLI's flags, after parsing. */
export interface RunOptions {
  runner: RunnerKind;
  facts: RunFacts;
  /** The positional goal: required for a full run; for a replay, a fallback and a cross-check. */
  goal?: string;
  platforms?: string[];
  scopeTags?: string[];
  /** The attributed review time for approved-facts.json. A full run always has one. */
  reviewedAt: string;
  /** Whether the operator gave `reviewedAt` explicitly (a replay of a pre-metadata run uses it only then). */
  reviewedAtExplicit: boolean;
  /** A full run that `--revise-once` will follow, so the paid-action request can say so. */
  reviseOnce?: boolean;
}
