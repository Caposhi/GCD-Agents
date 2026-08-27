/**
 * Explicit operator command: import `config/approved-facts.json` into durable
 * content evidence.
 *
 * Deliberately a command and not a startup step. If this ran on boot, every
 * deploy would silently rewrite what the system believes is true, and a bad
 * edit would propagate without anyone deciding to apply it. An operator runs
 * this, sees the counts, and can re-run it safely — the sync is idempotent, so
 * a second run reports zero changes.
 *
 *   npm run build && npm run evidence:sync            # apply
 *   npm run build && npm run evidence:sync -- --dry-run
 *
 * `--dry-run` needs no database and touches nothing; it prints exactly what
 * would be written. This command is not part of any release and must not be
 * pointed at production without separate authorization.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { closeState, initState, stateEnabled, syncContentEvidence } from "../state.js";
import { adaptApprovedFactsFile } from "./approvedFacts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPROVED_FACTS_PATH = resolve(__dirname, "../../../config/approved-facts.json");

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const raw = await readFile(APPROVED_FACTS_PATH, "utf8");

  // reviewedAt is attributed to the checked-in file, which is reviewed by a
  // human before merge. Callers may override for a controlled backdate.
  const reviewedAtArg = process.argv.find((a) => a.startsWith("--reviewed-at="));
  const reviewedAt = reviewedAtArg ? reviewedAtArg.split("=")[1]! : new Date().toISOString();

  const { contentSha256, records } = adaptApprovedFactsFile(raw, {
    reviewedAt,
    now: Date.now(),
  });

  console.log(`[evidence-sync] source config/approved-facts.json sha256=${contentSha256}`);
  console.log(`[evidence-sync] adapted ${records.length} evidence record(s)`);
  for (const record of records) console.log(`  ${record.id}  [${record.kind}]  ${record.claim.slice(0, 90)}`);

  if (dryRun) {
    console.log("[evidence-sync] --dry-run: nothing was written");
    return;
  }

  await initState({ requireDurable: true });
  if (!stateEnabled()) throw new Error("durable PostgreSQL state is required for evidence sync");
  try {
    const result = await syncContentEvidence(records);
    console.log(
      `[evidence-sync] inserted=${result.inserted} updated=${result.updated} unchanged=${result.unchanged}`,
    );
  } finally {
    await closeState();
  }
}

void main().catch((err) => {
  console.error(`[evidence-sync] FAILED: ${(err as Error).message}`);
  process.exit(1);
});
