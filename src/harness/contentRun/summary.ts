/**
 * The human review surface, `summary.md`. Moved unchanged from
 * `scripts/local/content-run.mjs` (Content Studio S1).
 */

/**
 * The summary footer names the runner that actually produced the run. It used to
 * say "Fake-runner output" for every run, live ones included (found on the
 * 2026-09-23T17:07Z live run). The disclaimer after it holds for both runners.
 */
export function summaryFooter(runner: unknown): string {
  const label = runner === "live" ? "Live" : runner === "fake" ? "Fake" : String(runner);
  return `_${label}-runner output. Not reviewed. Not publishable. Authorizes nothing._`;
}

/**
 * The human review surface. `packaging` is stage 5's output with the
 * deterministic contact line attached to every package; each platform's contact
 * line and Google Business Profile's call to action are rendered beside its
 * caption, labelled as code-attached rather than model-written. The critic
 * panel is rendered as the panel's computed verdict and counts, then one
 * section per lens: that lens's verdict, its own summary, and its findings.
 */
export function markdownSummary({
  goal, runner, timestamp, script, direction, packaging, critic, resumedFrom, revision,
}: {
  goal: string; runner: string; timestamp: string; script: any; direction: any; packaging: any; critic: any;
  resumedFrom?: { stage: string; sourceRunDir: string };
  revision?: any;
}): string {
  const lines: string[] = [];
  lines.push(`# Content Intelligence local run`, "");
  lines.push(`- Goal: ${goal}`);
  lines.push(`- Runner: ${runner}`);
  lines.push(`- Generated: ${timestamp}`);
  if (resumedFrom) {
    lines.push(`- Resumed at ${resumedFrom.stage} from ${resumedFrom.sourceRunDir}: stages 1-4 reused and `
      + `revalidated, not re-requested; the runner above ran stage 5 and the critic only`);
  }
  if (revision) {
    lines.push(`- Revised from ${revision.sourceRunDir} (one round, ${revision.origin}): re-ran `
      + `${revision.rerunStages.join(", ")} and the critic panel; everything else reused byte for byte`);
  }
  lines.push("", "## Hook", "", script.provisional.hook, "");
  lines.push("## Script", "", script.provisional.script, "");
  lines.push("## Shot list", "");
  direction.provisional.shots.forEach((shot: any, i: number) => {
    lines.push(`${i + 1}. **${shot.purpose}** (${shot.framing}, ${shot.movement}) — ${shot.action}`);
  });
  lines.push("", "## Captions", "");
  packaging.provisional.packages.forEach((pkg: any) => {
    lines.push(`### ${pkg.platform}`, "", pkg.caption, "");
    if (pkg.hashtags.length) lines.push(pkg.hashtags.join(" "), "");
    const contact = pkg.contact;
    if (contact?.text) {
      lines.push(`Contact line (fixed, attached by code from approved facts): ${contact.text}`, "");
    }
    if (contact?.gbpCta) {
      lines.push(`Call to action (fixed, attached by code from approved facts): `
        + `${contact.gbpCta.actionType} → ${contact.gbpCta.url}`, "");
    }
  });
  lines.push("## Critic panel", "");
  lines.push(`**${critic.provisional.verdict}** — ${critic.provisional.summary}`, "");
  lines.push("_Verdict and counts are computed by code from the four lens answers; no model merged them._", "");
  for (const lens of critic.provisional.lenses) {
    lines.push(`### ${lens.lens} — ${lens.verdict}`, "", lens.summary, "");
    const own = critic.provisional.findings.filter((f: any) => f.lens === lens.lens);
    if (!own.length) lines.push("No findings from this lens.", "");
    own.forEach((f: any) => {
      lines.push(`- [${f.severity}/${f.category}/${f.platform}/${f.owner}] ${f.issue} — ${f.suggestedAction}`);
    });
    if (own.length) lines.push("");
  }
  if (revision) lines.push(...revisionSummaryLines(revision));
  lines.push("---", summaryFooter(runner));
  return lines.join("\n");
}

/** "3 (1 blocking, 2 advisory)" for a panel output's findings. */
function findingCounts(findings: any[]): string {
  const blocking = findings.filter((f) => f.severity === "blocking").length;
  return `${findings.length} (${blocking} blocking, ${findings.length - blocking} advisory)`;
}

/**
 * The revision section of a revised run's summary: round 1 and round 2 side by
 * side, what each re-run stage was sent, what was dropped over a cap, what was
 * not sent because its stage did not re-run, and the owner items no model saw.
 */
export function revisionSummaryLines({ round1, round2, plan, reusedFiles }: any): string[] {
  const lines = ["## Revision — one round", ""];
  lines.push(`Started at **${plan.startStage}**. Re-run: ${plan.stages.map((s: any) => s.stage).join(", ")}, then all four `
    + `critic lenses. Reused byte for byte: ${reusedFiles.join(", ")}.`, "");
  lines.push("### Round 1 and round 2, side by side", "");
  lines.push("| | Round 1 | Round 2 |", "|---|---|---|");
  lines.push(`| Panel verdict | ${round1.verdict} | ${round2.verdict} |`);
  lines.push(`| Findings | ${findingCounts(round1.findings)} | ${findingCounts(round2.findings)} |`);
  round1.lenses.forEach((lens: any, i: number) => {
    const other = round2.lenses[i];
    const own = (panel: any, name: string) => panel.findings.filter((f: any) => f.lens === name);
    lines.push(`| ${lens.lens} | ${lens.verdict}, ${findingCounts(own(round1, lens.lens))} | `
      + `${other?.verdict ?? "?"}, ${findingCounts(own(round2, lens.lens))} |`);
  });
  lines.push("", "_Round 2's panel reviewed the revised outputs fresh: it was shown no round-1 finding or verdict. "
    + "Round 1's panel output is kept as round-1-06-final-critic.json._", "");
  lines.push("### Findings sent to each re-run stage", "");
  for (const stage of plan.stages) {
    lines.push(`- ${stage.stage} (cap ${stage.cap}): ${stage.sent.length
      ? stage.sent.map((f: any) => `${f.id} (${f.lens}, ${f.severity})`).join(", ")
      : "none — re-run because an earlier stage was revised"}`);
  }
  const dropped = plan.stages.flatMap((stage: any) => stage.dropped.map((f: any) => ({ ...f, stage: stage.stage })));
  lines.push("", "### Findings dropped over a stage's cap", "");
  if (!dropped.length) lines.push("None.");
  dropped.forEach((f: any) => lines.push(`- ${f.id} (${f.lens}, ${f.severity}) — owned by ${f.stage}, over its cap`));
  lines.push("", "### Findings not sent: their stage was not re-run", "");
  if (!plan.notRerun.length) lines.push("None.");
  plan.notRerun.forEach((f: any) => lines.push(`- ${f.id} (${f.lens}, ${f.severity}) — owned by ${f.owner}`));
  lines.push("", "### Owner items — never sent to any model", "");
  if (!plan.ownerItems.length) lines.push("None.");
  plan.ownerItems.forEach((f: any) => lines.push(
    `- ${f.id} [${f.severity}/${f.category}/${f.platform}/${f.owner}] ${f.issue} — ${f.suggestedAction}`));
  lines.push("");
  return lines;
}
