#!/usr/bin/env node
/**
 * Focused mutation tests for the payload-contract derivations.
 *
 * A derivation regression that cannot fail is decoration. This script proves
 * each load-bearing derivation in `src/harness/agents/payloadContract.ts` (and
 * the two files that must agree with it) is actually load-bearing: it applies
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
    from: "    CHECK (length(claim) <= 1000),",
    to: "    CHECK (length(claim) <= 1200),",
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
    from: "      AND content_evidence_tag_length_within(tags, 60)",
    to: "      AND NOT EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE length(t) > 60)",
    expect: ["CC2."],
  },
  {
    name: "the characters-per-token floor is loosened past what a token can hold",
    file: PAYLOAD,
    from: "export const MIN_CHARS_PER_TOKEN = 3;",
    to: "export const MIN_CHARS_PER_TOKEN = 30;",
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
    // Tightened, not loosened: loosening it raises every ceiling derived from
    // it in lockstep and violates nothing, which is the derivation working.
    // Tightening it below a real maximal pack is the change that breaks
    // something, and a stage refusing a valid pack is what must report it.
    name: "the pack projection bound is tightened below a real maximal pack",
    file: PAYLOAD,
    from: "  maxProjectedRecords: 64,",
    to: "  maxProjectedRecords: 4,",
    expect: ["CC27."],
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
