/**
 * Offline self-test for the Phase 0B.0 evidence and agent foundation.
 * No SDK, image provider, network, database, approval, or publishing.
 * Run: npm run build && npm run test:content-intelligence
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVIDENCE_KINDS,
  EvidenceKind,
  EvidenceRecord,
  isCitableAsFact,
  isStale,
  validateEvidenceRecord,
} from "./evidence/contract.js";
import { buildEvidencePack, evidencePackInvariants } from "./evidence/pack.js";
import {
  adaptApprovedFactsFile,
  approvedFactEvidenceId,
  approvedFactsContentSha256,
} from "./evidence/approvedFacts.js";
import {
  AgentRegistry,
  AgentRegistryError,
  TARGET_STAGE_IDS,
  resolveAssetPath,
  targetStageDefinitions,
} from "./agents/registry.js";
import {
  assertPreviewIsInert,
  buildContentIntelligencePreview,
  parsePreviewGoal,
  PreviewInputError,
} from "./contentIntelligence.js";

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}
function throws(fn: () => unknown): boolean {
  try { fn(); return false; } catch { return true; }
}

const NOW = Date.parse("2026-08-27T12:00:00Z");
const PAST = "2026-01-01T00:00:00Z";
const FUTURE = "2027-01-01T00:00:00Z";

const base = {
  subject: "german-car-depot",
  tags: ["test"],
  createdAt: "2026-08-01T00:00:00Z",
  lifecycle: "active" as const,
};

function verifiedAutomotive(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    ...base,
    id: "auto-1",
    kind: "verified_automotive_fact",
    claim: "Brake fluid absorbs moisture over time and requires periodic replacement.",
    subject: "brake-service",
    sourceType: "manufacturer_documentation",
    sourceRef: "BMW service documentation, brake fluid change interval",
    provenance: "transcribed from manufacturer service schedule",
    reviewedAt: "2026-08-01T00:00:00Z",
    reviewBy: FUTURE,
    confidence: 0.95,
    ...overrides,
  } as EvidenceRecord;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

async function run(): Promise<void> {
  // --- A. every evidence kind validates when correctly formed ---------------
  const wellFormed: Record<EvidenceKind, EvidenceRecord> = {
    verified_automotive_fact: verifiedAutomotive(),
    verified_business_fact: {
      ...base, id: "biz-1", kind: "verified_business_fact",
      claim: "warranty: 3-Year / 36,000-Mile warranty on qualifying parts & labor",
      sourceType: "repository_config", sourceRef: "config/approved-facts.json#warranty",
      provenance: "adapted from approved facts", reviewedAt: "2026-08-01T00:00:00Z", reviewBy: FUTURE,
    },
    sourced_research: {
      ...base, id: "res-1", kind: "sourced_research",
      claim: "Short-form vertical video outperforms static images for local service discovery.",
      subject: "content-format", sourceType: "industry_publication",
      sourceRef: "industry report 2026, section 4", observedAt: "2026-06-01T00:00:00Z", reviewBy: FUTURE,
    },
    gcd_direct_observation: {
      ...base, id: "obs-1", kind: "gcd_direct_observation",
      claim: "A 2015 Mini Cooper presented with a check-engine light traced to a faulty thermostat housing.",
      subject: "mini-cooper", sourceType: "gcd_shop_record",
      observedAt: "2026-08-10T00:00:00Z", provenance: "GCD shop record, technician write-up",
      generalizable: false,
    },
    gcd_performance_evidence: {
      ...base, id: "perf-1", kind: "gcd_performance_evidence",
      claim: "Brake-service posts averaged 2.1x the saves of oil-change posts over 30 days.",
      subject: "brake-service", sourceType: "platform_analytics",
      observedAt: "2026-08-20T00:00:00Z", reviewBy: FUTURE, generalizable: false,
    },
    creative_hypothesis: {
      ...base, id: "hyp-1", kind: "creative_hypothesis",
      claim: "Opening on the diagnostic screen may hook viewers faster than opening on the car.",
      subject: "content-format", sourceType: "model_inference", confidence: 0.4,
    },
    causal_hypothesis: {
      ...base, id: "cause-1", kind: "causal_hypothesis",
      claim: "Saves may be higher on brake content because the decision is deferred, not because of the format.",
      subject: "brake-service", sourceType: "model_inference", confidence: 0.35,
    },
    unsupported_assumption: {
      ...base, id: "assume-1", kind: "unsupported_assumption",
      claim: "Owners probably delay brake service until they hear noise.",
      subject: "brake-service", sourceType: "unattributed", confidence: 0.2,
    },
  };
  const allKindsValid = EVIDENCE_KINDS.every((kind) => validateEvidenceRecord(wellFormed[kind]).ok);
  check("A. every evidence kind validates when correctly formed", allKindsValid);
  check("A2. the seven roadmap kinds are all present", [
    "verified_automotive_fact", "sourced_research", "gcd_direct_observation",
    "gcd_performance_evidence", "creative_hypothesis", "causal_hypothesis", "unsupported_assumption",
  ].every((k) => (EVIDENCE_KINDS as readonly string[]).includes(k)));

  // --- B. invalid evidence is rejected --------------------------------------
  check("B1. a verified fact without a source is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ sourceRef: undefined })).ok);
  check("B2. a verified fact without provenance is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ provenance: undefined })).ok);
  check("B3. a verified fact without reviewedAt is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ reviewedAt: undefined })).ok);
  check("B4. a verified fact sourced from model inference is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ sourceType: "model_inference" })).ok);
  check("B5. an unattributed verified fact is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ sourceType: "unattributed" })).ok);
  check("B6. confidence outside [0,1] is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ confidence: 1.5 })).ok);
  check("B7. a malformed timestamp is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ reviewedAt: "last Tuesday" as any })).ok);
  check("B8. an observation without observedAt is rejected",
    !validateEvidenceRecord({ ...wellFormed.gcd_direct_observation, observedAt: undefined }).ok);
  check("B9. performance evidence from a non-analytics source is rejected",
    !validateEvidenceRecord({ ...wellFormed.gcd_performance_evidence, sourceType: "model_inference" }).ok);
  check("B10. self-supersession is rejected",
    !validateEvidenceRecord(verifiedAutomotive({ lifecycle: "superseded", supersededById: "auto-1" })).ok);
  check("B11. superseded evidence must name its successor",
    !validateEvidenceRecord(verifiedAutomotive({ lifecycle: "superseded" })).ok);

  // --- C–F. promotion is impossible -----------------------------------------
  const mixed = Object.values(wellFormed);
  const pack = buildEvidencePack({ goal: "brake service content", records: mixed, now: NOW });

  const allowedIds = new Set(pack.allowedFacts.map((r) => r.id));
  check("C. unsupported assumptions cannot enter allowedFacts",
    !allowedIds.has("assume-1") && pack.unsupportedAssumptions.some((r) => r.id === "assume-1"));
  check("D. creative hypotheses stay labelled hypotheses",
    !allowedIds.has("hyp-1") && pack.creativeHypotheses.some((r) => r.id === "hyp-1"));
  check("E. causal hypotheses stay hypotheses",
    !allowedIds.has("cause-1") && pack.causalHypotheses.some((r) => r.id === "cause-1"));
  check("F. performance evidence is never promoted to fact",
    !allowedIds.has("perf-1") && pack.performanceEvidence.some((r) => r.id === "perf-1"));
  check("F2. performance evidence is not citable as fact by the contract",
    !isCitableAsFact(wellFormed.gcd_performance_evidence, NOW));
  check("F3. an observation cannot be marked generalizable",
    !validateEvidenceRecord({ ...wellFormed.gcd_direct_observation, generalizable: true }).ok);
  check("F4. observations are grouped separately from allowedFacts",
    !allowedIds.has("obs-1") && pack.gcdObservations.some((r) => r.id === "obs-1"));
  check("F5. pack invariants hold", evidencePackInvariants(pack, NOW).length === 0);

  // --- G. stale evidence is surfaced ----------------------------------------
  const stalePack = buildEvidencePack({
    goal: "stale check",
    records: [verifiedAutomotive({ id: "auto-stale", reviewBy: PAST })],
    now: NOW,
  });
  check("G1. review-overdue fact is excluded from allowedFacts", stalePack.allowedFacts.length === 0);
  check("G2. review-overdue fact is surfaced as stale",
    stalePack.staleEvidence.some((r) => r.id === "auto-stale"));
  check("G3. an expired record is stale regardless of kind",
    isStale({ ...wellFormed.creative_hypothesis, expiresAt: PAST }, NOW));
  check("G4. freshness fails closed for citability",
    !isCitableAsFact(verifiedAutomotive({ reviewBy: PAST }), NOW));

  // --- H. conflicts are surfaced and never auto-resolved ---------------------
  const conflictPack = buildEvidencePack({
    goal: "conflict check",
    records: [
      verifiedAutomotive({ id: "auto-a", attribute: "brake-fluid-interval", claim: "Interval is 2 years.", confidence: 0.9 }),
      verifiedAutomotive({ id: "auto-b", attribute: "brake-fluid-interval", claim: "Interval is 3 years.", confidence: 0.99 }),
    ],
    now: NOW,
  });
  check("H1. two conflicting active facts are surfaced", conflictPack.conflicts.length === 1);
  check("H2. neither side is silently chosen as truth", conflictPack.allowedFacts.length === 0);
  check("H3. higher confidence does not win automatically",
    !conflictPack.allowedFacts.some((r) => r.id === "auto-b"));
  check("H4. conflict reporting is order-stable",
    conflictPack.conflicts[0]!.aId === "auto-a" && conflictPack.conflicts[0]!.bId === "auto-b");

  // The bug the PostgreSQL suite caught: every approved fact shares the subject
  // "german-car-depot". Distinct attributes of one subject do not disagree, and
  // treating them as conflicts emptied allowedFacts entirely.
  const sameSubjectDifferentAttributes = buildEvidencePack({
    goal: "distinct attributes",
    records: [
      verifiedAutomotive({ id: "biz-warranty", subject: "german-car-depot", attribute: "warranty", claim: "warranty: 3-year" }),
      verifiedAutomotive({ id: "biz-phone", subject: "german-car-depot", attribute: "phone", claim: "phone: (954) 921-1515" }),
    ],
    now: NOW,
  });
  check("H6. distinct attributes of one subject are not a conflict",
    sameSubjectDifferentAttributes.conflicts.length === 0
      && sameSubjectDifferentAttributes.allowedFacts.length === 2);
  check("H7. records without an attribute never auto-conflict",
    buildEvidencePack({
      goal: "no attribute",
      records: [
        verifiedAutomotive({ id: "n1", subject: "s", claim: "A" }),
        verifiedAutomotive({ id: "n2", subject: "s", claim: "B" }),
      ],
      now: NOW,
    }).conflicts.length === 0);

  const declared = buildEvidencePack({
    goal: "declared conflict",
    records: [
      verifiedAutomotive({ id: "auto-a", subject: "s1", claim: "A" }),
      verifiedAutomotive({ id: "auto-c", subject: "s2", claim: "C" }),
    ],
    relations: [{ fromId: "auto-a", toId: "auto-c", kind: "conflicts_with", createdAt: base.createdAt }],
    now: NOW,
  });
  check("H5. a declared cross-subject conflict is surfaced",
    declared.conflicts.length === 1 && declared.conflicts[0]!.basis === "declared");

  // --- I. supersession is explicit ------------------------------------------
  const supersession = buildEvidencePack({
    goal: "supersession",
    records: [
      verifiedAutomotive({ id: "auto-old", attribute: "brake-fluid-interval", claim: "Interval is 2 years.", lifecycle: "superseded", supersededById: "auto-new" }),
      verifiedAutomotive({ id: "auto-new", attribute: "brake-fluid-interval", claim: "Interval is 3 years." }),
    ],
    now: NOW,
  });
  check("I1. a superseded record leaves allowedFacts", supersession.allowedFacts.length === 1
    && supersession.allowedFacts[0]!.id === "auto-new");
  check("I2. superseded history stays auditable",
    supersession.inactiveEvidence.some((r) => r.id === "auto-old"));
  check("I3. explicit supersession resolves the conflict", supersession.conflicts.length === 0);

  // --- J–L. approved-facts adapter -------------------------------------------
  const rawFacts = await readFile(resolve(REPO_ROOT, "../config/approved-facts.json"), "utf8")
    .catch(() => readFile(resolve(REPO_ROOT, "config/approved-facts.json"), "utf8"));
  const first = adaptApprovedFactsFile(rawFacts, { reviewedAt: "2026-08-01T00:00:00Z", now: NOW });
  const second = adaptApprovedFactsFile(rawFacts, { reviewedAt: "2026-08-01T00:00:00Z", now: NOW });
  check("J1. adaptation is deterministic", JSON.stringify(first.records) === JSON.stringify(second.records));
  check("J2. adaptation produces records", first.records.length > 5);
  check("J3. every adapted record validates", first.records.every((r) => validateEvidenceRecord(r).ok));
  check("J4. adapted ids are derived from the field path",
    first.records.some((r) => r.id === approvedFactEvidenceId("warranty")));
  check("J6. every adapted record carries its field as the attribute",
    first.records.every((r) => typeof r.attribute === "string" && r.attribute.length > 0));
  check("J5. business facts are not mislabelled as automotive facts",
    first.records.every((r) => r.kind === "verified_business_fact"));
  check("K1. provenance survives adaptation",
    first.records.every((r) => (r.provenance ?? "").includes(first.contentSha256)));
  check("K2. sourceRef points at the file and field",
    first.records.every((r) => (r.sourceRef ?? "").startsWith("config/approved-facts.json#")));
  check("K3. content hash matches the exact bytes",
    first.contentSha256 === approvedFactsContentSha256(rawFacts));
  check("K4. instructional and empty fields are not imported",
    !first.records.some((r) => r.id === approvedFactEvidenceId("_note"))
      && !first.records.some((r) => r.id === approvedFactEvidenceId("currentPromos")));

  // L. idempotence, proven at the record level offline; the PostgreSQL suite
  // proves the same property against the real upsert.
  const ids = first.records.map((r) => r.id);
  check("L1. adapted ids are unique", new Set(ids).size === ids.length);
  check("L2. re-adapting yields an identical id set",
    JSON.stringify(ids) === JSON.stringify(second.records.map((r) => r.id)));

  // --- N–R. agent registry ---------------------------------------------------
  const registry = new AgentRegistry();
  check("N1. all six target stages are registered",
    TARGET_STAGE_IDS.every((id) => registry.has(id)) && registry.ids().length === 6);
  check("N2. the six ids are exactly the roadmap stages",
    JSON.stringify(registry.ids()) === JSON.stringify([
      "strategy-concept", "automotive-truth", "hook-story-script",
      "production-direction", "packaging-adaptation", "final-critic",
    ]));
  check("N3. no stage is execution-enabled in this slice",
    registry.list().every((s) => s.executionEnabled === false));
  check("N4. the automotive-truth stage requires fact-class evidence",
    registry.get("automotive-truth").requiredEvidenceKinds.includes("verified_automotive_fact"));

  check("O. duplicate stage ids fail", throws(() => {
    const r = new AgentRegistry();
    r.register(targetStageDefinitions()[0]!);
  }));

  let missingAssetFailed = false;
  try {
    const r = new AgentRegistry([{ ...targetStageDefinitions()[0]!, skillPaths: ["skills/does-not-exist/SKILL.md"] }]);
    await r.loadStageAssets("strategy-concept");
  } catch (e) {
    missingAssetFailed = e instanceof AgentRegistryError;
  }
  check("P. a missing mandatory asset fails loudly", missingAssetFailed);

  check("Q1. upward traversal is rejected", throws(() => resolveAssetPath("../../etc/passwd")));
  check("Q2. absolute paths are rejected", throws(() => resolveAssetPath("/etc/passwd")));
  check("Q3. an embedded traversal segment is rejected", throws(() => resolveAssetPath("skills/../../etc/passwd")));
  check("Q4. a non-allowlisted root is rejected", throws(() => resolveAssetPath("src/harness/config.ts")));
  check("Q5. a null byte is rejected", throws(() => resolveAssetPath("skills/a\0b")));
  check("Q6. an allowlisted path resolves", resolveAssetPath("skills/brand-voice/SKILL.md").includes("skills"));
  check("Q7. traversal is rejected at registration, not first use", throws(() => {
    new AgentRegistry([{ ...targetStageDefinitions()[0]!, promptPaths: ["../secrets.md"] }]);
  }));

  const planA = registry.buildStagePlan(new Set<EvidenceKind>(["verified_business_fact"]));
  const planB = registry.buildStagePlan(new Set<EvidenceKind>(["verified_business_fact"]));
  check("R1. stage plan ordering is deterministic", JSON.stringify(planA) === JSON.stringify(planB));
  check("R2. stage plan is ordered by pipeline order",
    planA.map((s) => s.order).every((o, i, arr) => i === 0 || arr[i - 1]! <= o));
  check("R3. missing evidence classes are reported, not thrown",
    planA.find((s) => s.id === "automotive-truth")!.missingEvidenceKinds.includes("verified_automotive_fact"));
  check("R4. every registered asset resolves on disk",
    await registry.verifyAllAssets().then(() => true).catch(() => false));

  // --- S–T. preview -----------------------------------------------------------
  const businessContext = {
    activePlatforms: ["instagram", "facebook"],
    autonomyPhase: "A",
    approvedFactsSource: "config/approved-facts.json",
  };
  const preview = await buildContentIntelligencePreview({
    goal: "Promote a brake fluid flush special",
    records: mixed,
    now: NOW,
    traceId: "trace-fixed",
    businessContext,
  });
  check("S1. preview returns evidence grouped by class",
    preview.evidence.counts.allowedFacts === pack.allowedFacts.length
      && preview.evidence.creativeHypotheses.length === 1
      && preview.evidence.causalHypotheses.length === 1
      && preview.evidence.unsupportedAssumptions.length === 1);
  check("S2. preview returns the six-stage plan", preview.stagePlan.length === 6);
  check("S3. preview verifies every registered asset", preview.assetsVerified === true);
  check("S4. preview surfaces stale and conflicting evidence fields",
    Array.isArray(preview.evidence.staleEvidence) && Array.isArray(preview.evidence.conflicts));
  check("S5. preview is deterministic for a fixed trace and clock",
    JSON.stringify(preview) === JSON.stringify(await buildContentIntelligencePreview({
      goal: "Promote a brake fluid flush special", records: mixed, now: NOW,
      traceId: "trace-fixed", businessContext,
    })));

  check("T1. preview reports execution disabled", preview.executionDisabled === true);
  check("T2. preview violates no evidence invariant", preview.invariantViolations.length === 0);
  check("T3. inertness assertion passes", (() => {
    try { assertPreviewIsInert(preview); return true; } catch { return false; }
  })());
  check("T4. inertness assertion rejects an execution-enabled plan", throws(() =>
    assertPreviewIsInert({ ...preview, executionDisabled: false })));
  // The preview module must not be able to reach a provider or the queue at all.
  const previewSource = await readFile(resolve(REPO_ROOT, "harness/contentIntelligence.js"), "utf8")
    .catch(() => readFile(resolve(REPO_ROOT, "src/harness/contentIntelligence.ts"), "utf8"));
  check("T5. preview imports no posting, image, or queue module",
    !/posting-tool|image-tool|enqueueBrief|createApproval/.test(previewSource));

  check("S6. goal validation rejects empty and oversized input",
    throws(() => parsePreviewGoal("")) && throws(() => parsePreviewGoal("x".repeat(2_001)))
      && throws(() => parsePreviewGoal(42 as any)));
  check("S7. goal validation trims and accepts normal input",
    parsePreviewGoal("  Promote a brake service  ") === "Promote a brake service");
  check("S8. PreviewInputError is the rejection type", (() => {
    try { parsePreviewGoal(""); return false; } catch (e) { return e instanceof PreviewInputError; }
  })());

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
