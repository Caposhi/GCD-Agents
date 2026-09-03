#!/usr/bin/env node
/**
 * Focused mutation tests for the payload-contract derivations.
 *
 * A derivation regression that cannot fail is decoration. This script proves
 * each load-bearing derivation in `src/harness/agents/payloadContract.ts` (and
 * the eight files that must agree with it) is actually load-bearing: it applies
 * one focused, single-token mutation, rebuilds, runs the Content Intelligence
 * offline suite, and requires the NAMED check that owns that derivation to
 * fail. Then it restores the file byte-for-byte — verified by SHA-256 against
 * the bytes captured before the mutation — rebuilds, and requires the suite to
 * pass again.
 *
 * It is offline and deterministic: no network, no database, no provider, no
 * credential. It mutates only files inside this repository's `src/` and
 * `state/` trees, and it restores every one of them in a `finally` block, so an
 * interrupted run does not leave a mutated tree behind.
 *
 * Run: npm run test:payload-mutation
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const PAYLOAD = "src/harness/agents/payloadContract.ts";
const MIGRATION = "state/migrations/007_evidence_bounds.sql";
const PACKAGING = "src/harness/agents/packagingAdaptation.ts";
const FINAL_CRITIC = "src/harness/agents/finalCritic.ts";
const MODEL_POLICY = "src/harness/agents/modelPolicy.ts";
const EVIDENCE_CONTRACT = "src/harness/evidence/contract.ts";
const EVIDENCE_PACK = "src/harness/evidence/pack.ts";
const STAGE_EXECUTION = "src/harness/agents/stageExecution.ts";
const SDK = "src/harness/sdk.ts";

/**
 * Each mutation names the derivation it breaks, the single edit that breaks it,
 * and the check prefix that must report the break. `expect` is a prefix rather
 * than a whole line so a wording change to a check does not silently turn a
 * mutation test into a no-op — the id is the stable part.
 */
const MUTATIONS = [
  {
    // Not the constant itself — a change there is a type error, because the
    // regressions compare against its literal type. The derivation's USE of it
    // is the load-bearing part: drop the factor and every ceiling loses the
    // allowance escaping needs, so real maximal outputs stop fitting and the
    // transport ceiling collapses onto the ordinary-character one.
    name: "the escape factor stops being applied when a ceiling is derived",
    file: PAYLOAD,
    from: "  expansion: number = MAX_JSON_ESCAPE_EXPANSION,",
    to: "  expansion: number = 1,",
    expect: ["CC11.", "CC13.", "BX23."],
  },
  {
    name: "a producer's ceiling loses one of its three id channels",
    file: PAYLOAD,
    from: "export const STRATEGY_ID_CHANNELS = 3;",
    to: "export const STRATEGY_ID_CHANNELS = 2;",
    // The transport ceiling still covers it — the escape factor leaves that
    // much headroom for ASCII ids — but the ordinary-character ceiling, which
    // the token budget is derived from, does not. CC12 is the check that owns
    // that side, and it is the one that must speak.
    expect: ["CC12."],
  },
  {
    name: "an evidence bound diverges from the migration that enforces it",
    file: PAYLOAD,
    from: "  claimChars: 1_000,",
    to: "  claimChars: 1_200,",
    expect: ["CC1."],
  },
  {
    name: "the migration diverges from the TypeScript bound it mirrors",
    file: MIGRATION,
    from: "    CHECK (length(claim) <= 1000 AND octet_length(claim) <= 1000),",
    to: "    CHECK (length(claim) <= 1200 AND octet_length(claim) <= 1200),",
    expect: ["CC1."],
  },
  {
    // The first draft of this migration wrote the per-tag bound as
    // `NOT EXISTS (SELECT 1 FROM unnest(tags) ...)`. PostgreSQL rejects a
    // subquery inside a CHECK, so it failed at apply time in the PostgreSQL
    // job rather than offline. CC2 now refuses the shape outright, so the
    // same mistake is caught without a database.
    name: "the per-tag bound is written as a subquery a CHECK cannot contain",
    file: MIGRATION,
    from: "      AND gcd_content_evidence_tags_within_v007(tags, 60)",
    to: "      AND NOT EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE length(t) > 60)",
    expect: ["CC2."],
  },
  {
    name: "the worst-case tokens-per-byte ceiling is loosened below the lossless bound",
    file: PAYLOAD,
    from: "export const MAX_TOKENS_PER_UTF8_BYTE = 1;",
    to: "export const MAX_TOKENS_PER_UTF8_BYTE = 0.1;",
    expect: ["CC18.", "CC22."],
  },
  {
    name: "a token budget is hand-chosen again instead of derived",
    file: MODEL_POLICY,
    from: '  "reasoning-standard": POLICY_OUTPUT_TOKEN_FLOORS["reasoning-standard"]!,',
    to: '  "reasoning-standard": 3_000,',
    expect: ["CC19.", "CC21."],
  },
  {
    name: "a consumer's guard is raised above its producer's ceiling",
    file: FINAL_CRITIC,
    from: "  packagingOutputChars: PACKAGING_OUTPUT_SERIALIZED_CEILING,",
    to: "  packagingOutputChars: PACKAGING_OUTPUT_SERIALIZED_CEILING + 1,",
    expect: ["CC13.", "BX22.", "BX23."],
  },
  {
    name: "the pipeline caption cap stops narrowing the provider limit",
    file: PACKAGING,
    from: "    const captionMax = Math.min(policy.captionMax, PACKAGING_LIMITS.pipelineCaptionChars);",
    to: "    const captionMax = policy.captionMax;",
    expect: ["BX18."],
  },
  {
    name: "the pack builder stops enforcing maxProjectedRecords",
    file: EVIDENCE_PACK,
    from: "  if (scoped.length > EVIDENCE_LIMITS.maxProjectedRecords) {",
    to: "  if (false && scoped.length > EVIDENCE_LIMITS.maxProjectedRecords) {",
    expect: ["CC32."],
  },
  {
    name: "the consumer boundary stops enforcing maxProjectedConflicts",
    file: EVIDENCE_PACK,
    from: "  if (pack.conflicts.length > EVIDENCE_LIMITS.maxProjectedConflicts) {",
    to: "  if (false && pack.conflicts.length > EVIDENCE_LIMITS.maxProjectedConflicts) {",
    expect: ["CC31."],
  },
  {
    name: "detail validation falls back to compact JavaScript JSON length",
    file: EVIDENCE_CONTRACT,
    from: "      const canonicalUpperBound = postgresJsonbTextUpperBoundBytes(record.detail);",
    to: "      const canonicalUpperBound = JSON.stringify(record.detail).length;",
    expect: ["CC29."],
  },
  {
    name: "the TypeScript relation-note validator exceeds its owning bound",
    file: EVIDENCE_CONTRACT,
    from: "    boundedText(relation.note, \"note\", EVIDENCE_LIMITS.relationNoteChars, push);",
    to: "    boundedText(relation.note, \"note\", EVIDENCE_LIMITS.relationNoteChars + 1, push);",
    expect: ["CC30."],
  },
  {
    name: "bounded output text stops enforcing its UTF-8 byte allowance",
    file: PAYLOAD,
    from: "  return value.length <= max && utf8ByteLength(value) <= max && isSerializableText(value);",
    to: "  return value.length <= max && isSerializableText(value);",
    expect: ["CC33."],
  },
  {
    name: "the PostgreSQL tag helper accepts NULL elements",
    file: MIGRATION,
    from: "    t IS NOT NULL AND length(t) <= max_len AND octet_length(t) <= max_len",
    to: "    (t IS NULL OR length(t) <= max_len) AND octet_length(coalesce(t, '')) <= max_len",
    expect: ["CC35."],
  },
  {
    name: "migration 007 regains overwrite authority over a pre-existing helper",
    file: MIGRATION,
    from: "CREATE FUNCTION gcd_content_evidence_tags_within_v007(tags text[], max_len integer)",
    to: "CREATE OR REPLACE FUNCTION gcd_content_evidence_tags_within_v007(tags text[], max_len integer)",
    expect: ["CC4.", "CC34."],
  },
  {
    name: "the structured stage request regains adaptive thinking inside the visible output ceiling",
    file: STAGE_EXECUTION,
    from: "      thinking: resolved.thinking,",
    to: '      thinking: { type: "adaptive" } as never,',
    expect: ["CC36."],
  },
  {
    name: "the JSONB numeric upper bound loses the sign byte for -5e-324",
    file: EVIDENCE_CONTRACT,
    from: '  if (typeof value === "number") return 327;',
    to: '  if (typeof value === "number") return 326;',
    expect: ["CC37."],
  },
  {
    name: "the pack builder stops validating its input evidence records",
    file: EVIDENCE_PACK,
    from: "  for (const record of input.records) assertValidEvidenceRecord(record);",
    to: "  for (const record of input.records) if (false) assertValidEvidenceRecord(record);",
    expect: ["CC38."],
  },
  {
    // The semantic validator is the whole of findings 1 and 2. If the shared
    // executor boundary stops calling it, a hand-built pack that promotes a
    // hypothesis into `allowedFacts` reaches a model again — which is exactly
    // the state this branch was reviewed in.
    name: "the shared executor boundary stops validating pack semantics",
    file: STAGE_EXECUTION,
    // Removed rather than swapped for the weaker bounds-only assert: that
    // symbol is no longer imported here, so a swap would be a type error and
    // the mutation would prove nothing about the runtime.
    from: "  assertUsableEvidencePack(pack);",
    to: "",
    // Only the cases this boundary alone catches. Removing it does NOT reopen
    // the hypothesis- and stale-promotion cases, because `unusableEvidenceIds`
    // and the pack renderer call the same validator on the same synchronous
    // path — defense in depth working as intended, recorded here rather than
    // papered over with a wider expectation that would quietly stop meaning
    // anything.
    expect: ["CC56.", "CC67."],
  },
  {
    // Section membership without a kind rule is how a valid hypothesis became
    // a citable fact: every field validated, every bound respected, wrong
    // section. Widening one section's permitted kinds is the smallest edit
    // that reopens it.
    name: "a section stops constraining which evidence kinds it may hold",
    file: EVIDENCE_PACK,
    from: "  allowedFacts: new Set([\"verified_automotive_fact\", \"verified_business_fact\"]),",
    to: "  allowedFacts: new Set(EVIDENCE_KINDS),",
    expect: ["CC48."],
  },
  {
    // Freshness anchored at builtAt is the documented decision. Removing the
    // citability check leaves a lapsed fact citable.
    name: "allowedFacts stops being checked for citability at builtAt",
    file: EVIDENCE_PACK,
    from: "    if (!isCitableAsFact(record, builtAt)) {",
    to: "    if (false && !isCitableAsFact(record, builtAt)) {",
    expect: ["CC49."],
  },
  {
    // The conflict projection was cardinality-only. Dropping the per-field
    // bound restores the 50,000-character subject the reviewer found.
    name: "conflict fields stop being bounded, leaving only the cardinality check",
    file: EVIDENCE_PACK,
    from: '    boundedField(conflict.subject, "subject", EVIDENCE_LIMITS.subjectChars, true);',
    to: "",
    expect: ["CC55.", "CC56."],
  },
  {
    name: "counts stop being compared against the sections they describe",
    file: EVIDENCE_PACK,
    from: "      if (value !== expected) {",
    to: "      if (false && value !== expected) {",
    expect: ["CC62."],
  },
  {
    // Finding 3. The SDK default is two retries, so removing the explicit
    // zero silently restores up to three wire requests behind a documented
    // one-request guarantee.
    name: "stage requests stop disabling SDK retries, restoring the default of two",
    file: SDK,
    from: "    maxRetries: STAGE_REQUEST_MAX_RETRIES,",
    // The SDK's own default, written literally. `undefined` would not compile
    // now that `StageRequestOptions.maxRetries` is `number` rather than
    // `number | undefined`, and a mutation that fails to build proves nothing.
    to: "    maxRetries: 2,",
    expect: ["CC39."],
  },
  {
    name: "the stage stream deadline is pinned to the old 90-second value instead of derived",
    file: PAYLOAD,
    from: "export function stageStreamDeadlineMs(maxOutputTokens: number): number {",
    to: "export function stageStreamDeadlineMs(maxOutputTokens: number): number {\n  if (maxOutputTokens > 0) return 90_000;",
    expect: ["CC41.", "CC42."],
  },
  {
    // Finding 2. The SDK's `timeout` bounds the fetch only — for a streaming
    // request it is cleared once headers arrive. Removing the abort leaves a
    // stalled stream with nothing at all to stop it, which is the state this
    // branch was reviewed in.
    name: "the total stream deadline stops aborting a stalled stream",
    file: SDK,
    from: "    deadlineExpired = true;\n    stream.abort();",
    to: "    deadlineExpired = true;",
    expect: ["CC45."],
  },
  {
    name: "the deadline timer is never cleared, leaking a timer past every stage call",
    file: SDK,
    from: "    timers.clearTimeout(handle);",
    to: "    void handle;",
    expect: ["CC44."],
  },
  {
    name: "the request-setup timeout is conflated with the total stream deadline",
    file: SDK,
    from: "    requestSetupTimeoutMs: STAGE_REQUEST_SETUP_TIMEOUT_MS,",
    to: "    requestSetupTimeoutMs: stageStreamDeadlineMs(maxOutputTokens),",
    expect: ["CC41."],
  },
  {
    // Finding 1. The semantic validator is where both conflict-pack defects
    // lived. Reverting the endpoint rule to the pre-correction form — which
    // demanded only that an endpoint exist somewhere — reopens the case a
    // conflicted record left citable in a usable section.
    name: "a conflict endpoint may live in any section again, not conflictedEvidence",
    file: EVIDENCE_PACK,
    from: '      if (home !== "conflictedEvidence") {',
    to: "      if (false) {",
    expect: ["CC61."],
  },
  {
    // The snapshot rule. Without it a hand-built pack can show a model claim
    // text no record in the pack ever made.
    name: "conflict claim and subject snapshots stop being compared to their records",
    file: EVIDENCE_PACK,
    // Compared to itself rather than short-circuited: `false &&` would stop
    // narrowing `recordA` for the body and the tree would not compile.
    from: "    if (recordA && conflict.aClaim !== recordA.claim) {",
    to: "    if (recordA && conflict.aClaim !== conflict.aClaim) {",
    expect: ["CC76."],
  },
  {
    name: "conflict fields lose their UTF-8 byte allowance, keeping only code units",
    file: EVIDENCE_PACK,
    from: '      if (utf8ByteLength(value) > max) push(`${at}.${field} exceeds ${max} UTF-8 bytes`);',
    to: "",
    expect: ["CC80.", "CC81."],
  },
  {
    // The builder half of finding 1: routing conflicted records back to their
    // ordinary sections is exactly what made legitimate packs invalid.
    name: "the builder stops routing conflicted records into conflictedEvidence",
    file: EVIDENCE_PACK,
    from: "    if (conflicted.has(record.id)) {\n      conflictedEvidence.push(record);\n      continue;\n    }",
    to: "",
    expect: ["CC70.", "CC73."],
  },
];

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const build = () => {
  execFileSync("npx", ["tsc", "-p", "tsconfig.json"], {
    cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8",
  });
};

/** Runs the suite. Returns the set of check ids that FAILED, or null if it crashed. */
const runSuite = () => {
  let stdout = "";
  try {
    stdout = execFileSync("node", ["dist/harness/contentIntelligence.selftest.js"], {
      cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    return { failed: [], crashed: false };
  } catch (error) {
    stdout = `${error.stdout ?? ""}`;
    const failed = stdout.split("\n")
      .filter((line) => line.startsWith("FAIL  "))
      .map((line) => line.slice("FAIL  ".length));
    // A nonzero exit with no reported failure is a crash: the suite aborted
    // before it could name anything, which is not a passing mutation test.
    return { failed, crashed: failed.length === 0 };
  }
};

/**
 * Files mutated right now, so a signal that kills this process mid-mutation
 * still restores the tree.
 *
 * A `finally` block only runs when the process survives to reach it. An earlier
 * run of this harness was killed by an external timeout inside the mutation
 * window and left one source file mutated, which then made the NEXT run's
 * baseline red — a failure mode that looks like a broken test and is really a
 * dirty tree. These handlers close that window.
 */
const inFlight = new Map();
let restoringOnSignal = false;
const restoreAll = () => {
  for (const [path, original] of inFlight) {
    try {
      writeFileSync(path, original, "utf8");
    } catch {
      // Best effort: report below rather than mask the original signal.
    }
  }
  if (inFlight.size) {
    console.error(`\n[mutation] restored ${inFlight.size} file(s) after interruption`);
  }
  inFlight.clear();
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (restoringOnSignal) return;
    restoringOnSignal = true;
    restoreAll();
    process.exit(130);
  });
}
process.on("exit", restoreAll);

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  console.log("Payload-contract mutation tests\n");

  // Baseline. Everything below is measured against this.
  build();
  const baseline = runSuite();
  check("M0. the unmutated tree builds and the whole suite passes",
    !baseline.crashed && baseline.failed.length === 0,
    `failed: ${baseline.failed.join(" | ") || "(crashed)"}`);
  if (failures) {
    console.log("\nBaseline is not green; mutation results would be meaningless.");
    process.exit(1);
  }

  for (const [index, mutation] of MUTATIONS.entries()) {
    const path = resolve(REPO_ROOT, mutation.file);
    const original = readFileSync(path, "utf8");
    const originalDigest = sha256(original);
    const id = `M${index + 1}`;

    if (!original.includes(mutation.from)) {
      check(`${id}. ${mutation.name}`, false,
        `the mutation site is gone from ${mutation.file}: ${JSON.stringify(mutation.from)}`);
      continue;
    }
    const occurrences = original.split(mutation.from).length - 1;
    if (occurrences !== 1) {
      check(`${id}. ${mutation.name}`, false,
        `the mutation site appears ${occurrences} times in ${mutation.file}; it must be unique`);
      continue;
    }

    try {
      inFlight.set(path, original);
      writeFileSync(path, original.replace(mutation.from, mutation.to), "utf8");
      let result;
      let buildFailed = false;
      try {
        build();
      } catch {
        buildFailed = true;
      }
      result = buildFailed ? { failed: [], crashed: true } : runSuite();

      const named = mutation.expect.filter((prefix) =>
        result.failed.some((line) => line.startsWith(prefix)));
      check(`${id}. ${mutation.name} — the suite reports it by name `
        + `(${mutation.expect.join(", ")})`,
        !buildFailed && !result.crashed && named.length === mutation.expect.length,
        buildFailed ? "the mutated tree did not compile, so no check could report it"
          : result.crashed ? "the suite aborted instead of naming a failing check"
          : `reported: ${result.failed.map((l) => l.split(".")[0]).join(", ") || "nothing"}`);
    } finally {
      writeFileSync(path, original, "utf8");
      inFlight.delete(path);
      const restored = readFileSync(path, "utf8");
      check(`${id}r. ${mutation.file} is restored byte-for-byte`,
        restored === original && sha256(restored) === originalDigest,
        `sha256 before=${originalDigest} after=${sha256(restored)}`);
    }
  }

  // The tree must end exactly where it started, and prove it by running green.
  build();
  const restoredRun = runSuite();
  check("M-end. after every mutation is reverted the suite passes again",
    !restoredRun.crashed && restoredRun.failed.length === 0,
    `failed: ${restoredRun.failed.join(" | ") || "(crashed)"}`);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
