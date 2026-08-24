/**
 * CLI boundary for `npm run dryrun`. In simulated mode the sensitive
 * environment is cleared before dynamically importing config-bearing harness
 * modules, so even eagerly-read config cannot retain developer credentials.
 */

import { prepareSimulatedDryRunEnvironment } from "./dryrunEnv.js";

const live = process.argv.includes("--live");
if (!live) prepareSimulatedDryRunEnvironment();

const {
  DUMMY_PUBLICATION_TARGETS,
  dryRunReportPasses,
  runDryRun,
  simulatedInspectedImageResolver,
  simulatedRunner,
} = await import("./dryrun.js");

const brief = {
  // Canonical facts always come from config/approved-facts.json; trigger input
  // cannot supplement or override them.
  goal: "Promote routine European-car maintenance; encourage booking online",
};

// Live mode is explicitly separate: no injected runner/resolver, but it still
// stops at pure request construction and never invokes the posting boundary.
runDryRun(
  brief,
  live ? undefined : simulatedRunner(),
  live ? undefined : simulatedInspectedImageResolver,
  live ? undefined : DUMMY_PUBLICATION_TARGETS,
)
  .then((report) => {
    console.log(`=== GCD-SOCIAL dry run (${live ? "LIVE — real agents, no posting" : "simulated"}) ===`);
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "escalated" && report.criticFindings?.length) {
      console.log("\nWhy the critic failed it:");
      report.criticFindings.forEach((finding) => {
        console.log(`  • [${finding.section}] ${finding.issue} → ${finding.exact_fix} (${finding.owning_subagent})`);
      });
    }
    const dryRunOk = dryRunReportPasses(report);
    console.log(dryRunOk
      ? "\nDRY RUN OK ✅ (no posting performed)"
      : "\nDRY RUN ISSUES ⚠️ — see above");
    process.exit(dryRunOk ? 0 : 1);
  })
  .catch((err) => {
    console.error("dry run error:", err);
    process.exit(1);
  });
