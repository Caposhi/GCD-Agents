# GCD Content Intelligence / GCD-SOCIAL

This repository is the current production foundation for German Car Depot's Content Intelligence Platform, or Content OS. Today it is a Node.js/TypeScript system that creates, reviews, queues, and conditionally publishes organic social content. The longer-term objective is a governed automotive media engine that earns massive qualified reach, followers, repeat viewing, affinity, engagement, GCD authority, and local market dominance before optimizing for attribution, leads, and revenue.

V1 is organic-first. Humans still film content, and CapCut or another external editor remains the editing path. An in-browser video editor is not current scope.

> Research gives us the prior. GCD empirical performance becomes the posterior.

Evidence may be collected automatically, but prompts, skills, production process, agent behavior, and publishing rules must change only through governed review. Agents reason; deterministic services retrieve, validate, mutate, store, enforce, and publish. Automotive truth, safety, privacy, and approval integrity are hard constraints. Never fabricate a diagnosis, failure or repair evidence, customer facts, or shop evidence. Prefer real GCD evidence over generic decorative imagery.

## Start here

New AI agents should read [Start here](docs/START_HERE.md), then the concise [AI engineering handoff](docs/AI_HANDOFF.md). The short current source of truth is [Status](docs/STATUS.md).

| Document | Purpose |
|---|---|
| [AI engineering handoff](docs/AI_HANDOFF.md) | Mission, orientation, current operation, next action, and authority boundaries |
| [Status](docs/STATUS.md) | Verified current repository, production, and deployment-authority state |
| [Roadmap](docs/ROADMAP.md) | Canonical work sequence and current cursor: phase-state vocabulary, completed history, hardening order, Phase 0B, and later work |
| [Architecture](docs/ARCHITECTURE.md) | Current production design versus target Content OS design |
| [Deployment control](docs/DEPLOYMENT.md) | Exact CI/controller contract, current cutover state, and migration boundary |
| [Operations](docs/OPERATIONS.md) | Health, routine operation, incident response, and recovery |
| [Security and continuity](docs/SECURITY_AND_CONTINUITY.md) | Trust boundaries, risk register, secrets, and takeover |
| [Testing](docs/TESTING.md) | Offline/static validation, disposable integration tests, and CI |
| [Data model](docs/DATA_MODEL.md) | Authoritative tables, invariants, migration, retention, and recovery |
| [Integrations](docs/INTEGRATIONS.md) | External-system responsibilities and failure boundaries |
| [Environment](docs/ENVIRONMENT.md) | Application and GitHub control-plane variable contracts |
| [Credential setup](docs/credentials-setup.md) | Provider and deployment setup without secret values |
| [Phase 0B.0 rollout runbook](docs/ROLLOUT_PHASE_0B0.md) | Migration-bearing release of `44d7336…`: preflight, sequence, stop conditions, rollback matrix, and the completed rollout record |

`docs/archive/` is historical only. Current source, this README, and active runbooks take precedence.

## Handoff snapshot

**Repository source and the live production release are separate facts and currently differ.** Production was last independently verified at `44d7336…` on 2026-08-28; the source lineage additionally carries the merged, dormant Phase 0B.1 and Phase 0B.2 executors, neither established as deployed or production-validated. Do not read exact current SHAs from this file — [Status](docs/STATUS.md) records dated production evidence and its freshness, and the exact current `main` is a Git lookup.

- `main` carries Phase 0A (PR #33), Phase 0D (PR #34), the documentation reconciliation (PR #35), the **worker ownership and recovery work (PR #36)**, roadmap-continuity governance (PR #37), **media publication normalization (PR #38)**, the **Phase 0B.0 content evidence and agent foundation (PR #40)**, and the dormant Phase 0B.1 and Phase 0B.2 executors (PR #42 and PR #44). Migrations `001–006` are applied in production: `005_approval_integrity.sql` since Phase 0A, and `006_content_evidence.sql` since 2026-08-28. PR #40 is the only one of those pull requests that added a migration.
- **PR #36 and PR #38 are deployed — their code is live in the current `44d7336…` release, independently verified 2026-08-28.** The earlier behavioral evidence — the ownership-wait timing, the August 10 provider-history reconciliation, and the PR #38 controlled brief — remains **operator-reported 2026-08-27** and was not independently re-examined. Treat that part as reported, and reconfirm before relying on it for a decision.
- **Phase 0B.0 is MERGED (`44d7336…`) and DEPLOYED.** Independently verified 2026-08-28 by a separate final-inspection session with Render and read-only PostgreSQL access: the API, worker, and scheduler all report `44d7336…`; `_migrations` holds `006` exactly once; the evidence tables are empty; database row counts are unchanged; no API, worker, or scheduler errors during the rollout interval. The exact application timestamp (`15:24:18Z`), the two separate worker-ownership-acquisition events, the scheduler's non-trigger action, and that exactly one preview call was executed are **operator-reported**, not independently re-derived. A documentation-inventory defect (9 vs. 10 indexes) stopped the rollout mid-flight at step 6 before it was corrected and resumed under fresh authorization — the schema was always correct. Completion carried one documented, authorization-governed variance at step 13: exactly one production preview was executed, as authorized, and deterministic equality came from the existing automated fixed-input test — **no second production preview occurred**. See [ROLLOUT_PHASE_0B0.md §0](docs/ROLLOUT_PHASE_0B0.md) for the full record.
- **Reverified 2026-08-28** by a separate final-inspection session with Render and read-only PostgreSQL access: all three services live and healthy at `44d7336…`; `/healthz` reporting PostgreSQL state and the exact target; Render native auto-deploy **off** on API, worker, and scheduler; repository variable `RENDER_DEPLOY_AUTOMATION_ENABLED` still **false** — **no unattended deployment authority**; `_migrations` holding six rows with migration 006 exactly once; and no API, worker, or scheduler errors during the rollout interval.
- **Genuinely still stale, from the 2026-08-24 21:32 UTC verification and not revisited since:** the GitHub `production` environment and its five non-secret variables. Treat that as last-verified rather than current — it is now the only fact in this state.
- A normal scheduled execution of the **then-current Phase 0D SHA** (`10098de…`) **was** observed on 2026-08-25, closing that observation historically; it does not describe the `44d7336…` release, which deployed on 2026-08-28. Do not trigger production cron for evidence.
- Production PostgreSQL external access remains `0.0.0.0/0` — **independently reverified 2026-08-28** by a separate final-inspection session. Restriction is a separate, high-priority, separately authorized security change.
- **Two open tracks, neither blocking the other.** The Phase 0B.0 migration-bearing rollout is complete, so enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` and proving the controller path are now eligible — each under its own authorization and its own immediate re-verification, and the gate remains `false` until then. Separately, Phase 0B continues with the six reasoning stages. [Roadmap](docs/ROADMAP.md) holds the ordered cursor.

Service IDs and exact control-plane configuration are recorded in [Status](docs/STATUS.md) and [Deployment control](docs/DEPLOYMENT.md). Do not infer mutable production facts from `render.yaml` alone.

## What runs today

```mermaid
flowchart LR
  PR["Pull request / main push"] --> CI["GitHub CI"]
  CI -->|"successful main push + enabled gate"| DC["GitHub Render controller"]
  DC -->|"exact SHA, serialized"| A["API"]
  DC --> W["Worker"]
  DC --> S["Scheduler"]
  S -->|"enqueue brief"| D[("PostgreSQL")]
  A --> D
  W -->|"claim brief"| D
  W --> M["Anthropic + fal.ai"]
  W -->|"canonical approval"| D
  W --> L["Slack review link"]
  H["Human reviewer"] --> A
  W -->|"live guard before every provider request"| P["Instagram / Facebook / GBP"]
```

- `src/api/`: health, authenticated triggers/diagnostics/console, approval review/actions, and public content-addressed media.
- `src/worker/`: queue consumption, deterministic orchestration, human approval wait, and the only publication handoff.
- `src/scheduler/`: daily `0 13 * * *` enqueue; it does not publish.
- `src/harness/`: configuration, state, orchestration, approval, image QC, dry runs, and self-tests. `src/harness/evidence/` and `src/harness/agents/` are the Phase 0B.0 foundation — merged, deployed on all three services, and executing no reasoning stage.
- `src/mcp/`: imported provider libraries, not standalone MCP servers or model tools.
- `state/migrations/`: forward-only PostgreSQL schema authority. **001–006 are applied in production** — 006 as of 2026-08-28.
- `agents/`: model prompt bodies and model IDs actually loaded by the orchestrator.
- `skills/`: reviewed specifications, but not automatically injected into current model calls.
- `prompts/MASTER_PROMPT.md`: dormant/experimental; the production worker does not run an Opus manager.
- `.github/workflows/ci.yml`: comprehensive Node 22, offline/static, PostgreSQL 16/18, AgentShield, and workflow validation.
- `.github/workflows/deploy-production.yml`: exact-SHA serialized Render controller; currently disabled by the repository gate.

The current reasoning flow is analytics, copywriter, image specification, hashtag/SEO/timing, platform formatter, and final critic under deterministic TypeScript control. Phase 0B.1 and Phase 0B.2 add dormant `strategy-concept` and `automotive-truth` executors alongside it, and Phase 0B.3 adds a third, `hook-story-script`, which is **implemented in a draft pull request and not merged**. The first two are merged, none is established as deployed or production-validated, and none is reachable from a production path; every registry entry remains `executionEnabled: false`. It is not yet the target six-stage Content OS architecture and implements no empirical learning. Phase 0B.0 added the registry and evidence substrate those stages use; the two executors inject prompt and skill assets into their instruction channel while references stay out of it. None of this changes the production flow. See [Architecture](docs/ARCHITECTURE.md) and [Roadmap](docs/ROADMAP.md).

## Phase 0A guarantees

Phase 0A is complete and production-deployed. It protects control routes; binds review to one canonical nonempty, strict-valid, unique-platform provider subject; stores payload and decision-token SHA-256 values; enforces expiry, revocation, and one append-only atomic decision; and requires durable PostgreSQL approval for publication. The reviewer sees the exact provider subject, and no visible transformation follows approval.

Immediately before every provider HTTP attempt—including Instagram status reads and retries—the module-issued guard revalidates the durable decision, exact payload and index, destination, runtime target, media digest, current immutable bytes, and provider-relevant constraints. Trusted-media acquisition is host/redirect/time/size/dimension bounded, normalized to one reviewed feed profile, transcoded to a bounded JPEG, and subjected to fail-closed privacy, safety, material-integrity, and text QC. Production entry points fail startup without reachable, migration-compatible PostgreSQL.

Migration 005 deliberately invalidated legacy unbound approvals, removed plaintext decision-token storage, added immutable decisions/approval metadata/media digests, and forbids media mutation/deletion. Its production rollout exposed the worker-before-migration race that motivated Phase 0D. See [Data model](docs/DATA_MODEL.md).

## Phase 0D guarantees and current boundary

Phase 0D is complete in source and deployed. GitHub CI validates pull requests and `main`. The production workflow accepts only a successful same-repository `main` push CI result, rejects superseded targets after acquiring the serialized slot, selects exact `TARGET_SHA` and actual Render `LIVE_SHA`, requires ancestry, and blocks any `LIVE_SHA..TARGET_SHA` migration change before a production action. Migration-bearing releases require a separate controlled rollout with stopped incompatible consumers and exactly one migration runner.

For migration-free releases the controller deploys API first, verifies exact application/release health using a transport-bounded 4,096-byte body plus one overflow probe byte, deploys worker second, requires exact target-bound readiness and a 10-second stabilization observation, deploys scheduler last, and finally verifies all three SHAs. It does not automatically loop failed deploys. Failure evidence is bounded, recursively redacted with reviewed fallback patterns, and rendered Markdown/HTML inert.

The controller is not yet enabled or production-proven. [Deployment control](docs/DEPLOYMENT.md) is authoritative for the current cutover.

## Publication media normalization

**Merged in PR #38; deployed — the code is live in the current `44d7336…` release, independently verified 2026-08-28.** It resolved a production blocker: from 2026-08-25 scheduled briefs failed before reaching approval with `image dimensions 1024x1024 are not an approved cross-platform feed profile`. The controlled-brief evidence proving the fix in production remains **operator-reported 2026-08-27, not independently re-examined**: a 896x1120 provider render normalized to 1080x1350 and reached a real human approval, with nothing published automatically.

Image providers guarantee **composition, not exact publication pixels**. fal normalizes a requested `image_size` to its own resolution buckets and may return PNG despite a JPEG request. The pipeline previously asserted the exact publication-profile allowlist against the raw provider download and never resized, so any provider-native size was fatal.

Two policies are now distinct: **decode safety** governs bytes we will process, **publication profile** governs bytes we will publish. The provider render is an input; the artifact is produced here.

- **Uniform scale only.** Cropping and padding are refused, not unimplemented — cropping 1:1 into 4:5 would cut 20% of the frame through the headline. A mismatched aspect fails closed.
- **Normalize before approval.** Resize and JPEG transcode happen before QC, hashing, hosting, and approval, so the bytes a reviewer approves are byte-for-byte the bytes that publish. There is no post-approval transformation.
- **Not retryable.** An aspect mismatch is a deterministic media-contract failure: the request is identical every attempt, so it escalates after exactly one generation instead of burning three.
- **Policy unchanged.** No provider size was added to the four approved profiles, and the durable publication guard is unchanged in strength.

## Worker ownership and recovery

**Merged in PR #36; deployed — the code is live in the current `44d7336…` release, independently verified 2026-08-28.** The behavioral bootstrap evidence remains **operator-reported 2026-08-27, not independently re-examined**: the new worker waiting approximately 58 seconds for exclusive ownership before emitting readiness — the Render zero-downtime overlap behaving exactly as designed — and the August 10 stranded brief reconciled with `providerMutation = impossible` and no provider replay. Phase 0D.1 is no longer blocked by this: `RENDER_DEPLOY_AUTOMATION_ENABLED` still stands at `false` and enabling it is now an eligible, separately authorized step rather than a forbidden one.

Render background-worker deploys are zero-downtime, so the old worker stays alive for roughly a minute after the new one starts. A starting worker therefore cannot assume a `running` brief was abandoned. Exactly one worker is the owner, established by a PostgreSQL session-level advisory lock held on a dedicated connection for the process lifetime, released automatically when that session ends.

- **Ownership gates everything.** A worker waits — reconciling nothing, emitting no readiness, consuming nothing — until it acquires the lock. The `pending → running` claim runs on the ownership session itself, so a brief can only be claimed by a process that is still the exclusive owner at commit.
- **Recovery runs before readiness.** Once ownership is held, every remaining `running` brief provably has no live owner and is classified from its durable phase markers, then terminalized. Nothing is resumed, retried, or returned to `pending`, and recovery issues no provider request.
- **Durable phase markers are safety state, not telemetry.** `brief:approval_requested`, `brief:publish_attempt_started`, `brief:publish_attempt_settled`, and `brief:publish_attempt_abandoned` each commit before the side effect they describe, so an interrupted brief is classified exactly rather than guessed at. `recordEvent` keeps its best-effort telemetry contract; these use a separate failure-propagating primitive.
- **Losing ownership ends the process.** A worker that loses the lock writes nothing further, declines every terminal write so it cannot overwrite a successor's recovery, and exits nonzero for restart.
- **Readiness now means four things at once:** durable state initialized, exclusive ownership held, abandoned work reconciled, and mandatory initialization complete.

Runbooks live in [Operations](docs/OPERATIONS.md) (lifecycle and reconciliation), [Deployment control](docs/DEPLOYMENT.md) (readiness window and the one-time manual bootstrap release), [Data model](docs/DATA_MODEL.md) (marker contract and advisory key), and [Security and continuity](docs/SECURITY_AND_CONTINUITY.md) (trust boundaries and residual risk).

## Content evidence and agent foundation (Phase 0B.0)

**MERGED (`44d7336…`); DEPLOYED.** Migration 006 was applied to production on 2026-08-28 and the evidence tables are correctly empty; the API, worker, and scheduler all report the target. **No reasoning stage executes** — this change adds no model call. It exists so that the six Content Intelligence stages, when they are wired one at a time, already have a typed evidence substrate and a registry to be wired into.

The system's core epistemic risk is that a plausible sentence quietly becomes a fact. Two promotions are forbidden, and the design makes them impossible rather than discouraged:

- **A hypothesis can never become a verified fact.** Evidence kind is a required typed property, not a convention. Only `verified_automotive_fact` and `verified_business_fact` are citable as fact, and both require a checkable `source_ref`, provenance, and a review timestamp — and may not be sourced from `model_inference` or left unattributed. A model's own output can never be the thing that verifies it.
- **Performance can never become automotive or causal truth.** `gcd_performance_evidence` is measurement: it requires an observation time, an analytics or shop-record source, and `generalizable = false`. A post performing well is not evidence about a car.

Both rules are enforced twice, on purpose. The TypeScript contract in `src/harness/evidence/contract.ts` produces good errors; the CHECK constraints in `state/migrations/006_content_evidence.sql` make the invariant true even for a writer that bypasses the application.

- **Conflicts are surfaced, never resolved.** When two active fact-class claims disagree about the same subject **and attribute**, both are removed from the citable set and reported as a conflict. The system does not pick the newer row or the higher-confidence row and present it as settled truth — a machine silently choosing between contradictory facts is exactly the failure this exists to prevent. Attribute keying is what makes this meaningful: two claims about the shop's warranty disagree; its warranty and its phone number do not.
- **`config/approved-facts.json` stays authoritative.** The adapter is a deterministic projection of it — same bytes, same ids, same order — and every record carries provenance naming the file and the exact content sha256, so drift is visible rather than silent. There is no second source of truth.
- **Nothing writes evidence at startup.** Import is the explicit operator command `npm run evidence:sync`, which is idempotent and has a database-free `--dry-run`. A deploy can never silently rewrite what the system believes.
- **History is never destroyed.** Correcting a claim inserts a new row and marks the old one `superseded` with a pointer. Claim text is never rewritten and rows are never deleted, so an auditor can reconstruct what was believed and when.
- **The registry declares six stages and executes none.** Every stage resolves its checked-in prompt and skill assets through an allowlist rooted at `agents/`, `skills/`, `prompts/`, and `config/`; traversal outside those roots is rejected at registration, not at read time. Every stage is `executionEnabled: false`.
- **The preview is inert.** Authenticated `POST /console/content-intelligence/preview` returns the stage plan and an evidence summary. It creates no approval and no brief, and calls no provider — asserted directly against the database in the bound HTTP suite, not merely by inspection.

The existing production path is untouched: the copywriter and critic still read `config/approved-facts.json`, and orchestration, approval, and publication behave exactly as before.

Details in [Data model](docs/DATA_MODEL.md) (schema and constraints), [Architecture](docs/ARCHITECTURE.md) (component boundaries), [Operations](docs/OPERATIONS.md) (`evidence:sync` runbook), [Testing](docs/TESTING.md) (what is actually proven), and [the rollout runbook](docs/ROLLOUT_PHASE_0B0.md) (how it reaches production).

## Strategy-concept stage executor (Phase 0B.1)

**`MERGED` through PR #42 — not established as deployed, not production-validated, and deliberately dormant.** Merge commit `8c8bd5b0fd500f9a28247f472fd6626bb05c6ebd`; reviewed head `2dc416f1a49bb419531549e95cb31052ada28009`; base `aec3e805cecc2b99dc7a582292bef536cee8ae21`.

Merging changed nothing about reachability. Nothing calls it — not the worker, scheduler, orchestrator, approval path, or any HTTP route. `POST /console/content-intelligence/preview` remains inert and never invokes it. Every registered stage, including this one, still reports `executionEnabled: false`. No route, migration, environment variable, publishing path, approval path, or provider authority was added. Running it requires a caller to construct an invocation and supply a runner.

This is the first Content Intelligence stage with a real execution path. The interesting part is not the model call — it is refusing to believe the result.

- **Wrong-class and fabricated ids cannot enter the typed fact-citation channel.** Every cited id is checked against the evidence pack the caller built, in the section the contract assigns it; a performance or hypothesis id placed in `supportingFactIds` fails, because membership is tested against `allowedFacts` and nothing else. **That is the exact guarantee — it covers ids, not prose.**
- **The model's prose is not verified, and the code does not claim to verify it.** `angle`, `concept`, and `rationale` are length-bounded and nothing more. A response can assert a performance correlation as automotive fact in `rationale`, cite an unrelated valid id, and validate. That gap is closed *structurally* rather than by keyword matching: prose is returned as `provisional` — branded `provisional_model_prose`, `verified: false`, `publishable: false` — and `citedFactRecords()` is the only supported evidence accessor, taking ids and never reading prose. Phase 0B.2 receives this complete typed output and can create only a structural whitelist of evidence-record ids; it does not semantically prove the prose true. Nothing here is publishable.
- **Conflicted, stale, and inactive ids are rejected even when the id is real.** They are shown to the model as a named exclusion list so it avoids them rather than inventing a replacement for something it never knew existed.
- **One model request per invocation. No retry, no repair call.** A silent retry turns one budgeted decision into unbounded spend; a "fix your JSON" round trip is a second chance for the model to argue itself into an unsupported claim. Both are asserted against the source, not merely documented.
- **No tools are registered and the capability set is closed** to the declared `read_evidence_pack`. A stage declaring anything else is refused by the boundary.
- **Goal and evidence are framed as untrusted data** in delimited, labelled blocks — a mitigation, not the defence. The defences are the closed capability set and the typed citation channel bound to evidence the model did not select.
- **Reference assets never enter the instruction channel.** `config/approved-facts.json` is declared as a reference for this stage and is deliberately **omitted** from execution: the evidence projection already carries those facts classified and conflict-filtered, and a raw second copy would be unclassified authority competing with it. Asset metadata records the channel each asset actually reached.
- **Model ids resolve in exactly one module.** The registry names a policy class (`reasoning-heavy`), never an id; a test asserts no `claude-` string appears in the registry.
- **A dedicated prompt.** The registry previously pointed this stage at `agents/analytics.md`, which defines a performance-readout subagent with a different output contract, its own pinned model, and declared tools. Executing against it would have meant running one contract while claiming another.

Determinism is proven for the validator and the boundary using an injected fake runner. **Real model output is not deterministic and is not claimed to be.**

Details in [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), and [Testing](docs/TESTING.md).

## Automotive-truth stage executor (Phase 0B.2)

**`MERGED` through PR #44 — not established as deployed, not production-validated, and deliberately dormant.** Merge commit `52050b4d20d03b5cbaf2a98eaab71b2f77685d80`; reviewed head `5b2ed96663643fe68d3cc72a64137cb9abd87e4e`; base `15e18ecfd5406b0afb4fd8ad2f833581f42451f4`.

Stage 2 decides what the content is allowed to assert. Nothing calls it — not the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, or evidence-write paths. The preview stays inert, every stage remains `executionEnabled: false`, and no route, migration, environment variable, dependency, workflow change, publishing path, approval path, or provider authority was added. Merge changed repository state, not reachability or production state.

A stage named "automotive-truth" is the obvious place to accidentally build a machine that lets a language model declare things true. It is not one.

- **The complete Stage 1 result is reviewed.** The typed angle, concept, rationale, hypotheses, assumptions, and all three citation arrays reach Stage 2 together in one bounded `STRATEGY_OUTPUT` untrusted-data block. None becomes a permission automatically.
- **The evidence projection is classified.** Every projected record carries its authoritative `kind`; the prompt maps the two fact kinds to their allowed `claimClass` values and forbids inference from claim prose. Confidence, provenance, reviewer identity, and internal timestamps remain absent.
- **No sentence the model writes becomes a claim the pipeline may make.** A permission is a **binding to an evidence id**, not a sentence. Fabricated ids, ids from any other evidence class, duplicates, and ids the pack marked conflicted, stale, or inactive are all rejected.
- **The class the evidence system recorded wins.** The model must declare `claimClass`, and a declaration that disagrees with the record fails — which is how "a business fact permitted as automotive truth" is caught rather than merely discouraged. The record is never reclassified to match the model.
- **What may be claimed is read back from the records.** `allowedClaimRecords()` and `allowedClaimTexts()` take ids and never read model text, so a restatement that overstates its fact cannot become the claim.
- **The model's prose is not verified, and the code does not claim to verify it.** `assessment`, `restatement`, `forbiddenClaims`, `requiredCaveats`, and `openQuestions` are length-bounded and nothing more. **A language model is not a semantic prover of factual truth here.** The gap is closed structurally, not by keyword matching: prose is branded `provisional_model_prose` (`verified: false`, `publishable: false`) and each restatement is separately branded `restatementVerified: false`. `forbiddenClaims` is advisory — nothing enforces it, and a claim absent from it is not thereby permitted.
- **Missing evidence refuses before the model call.** Both `verified_automotive_fact` and `verified_business_fact` must be citable in the pack. Sourced research, observations, performance evidence, hypotheses, assumptions, and raw approved-facts data are **not** substitutes.
- **A dedicated prompt, and a narrow skill in place of the wrong one.** The registry pointed this stage at `skills/compliance-checklist/SKILL.md` — the final critic's publishing-era rubric (provider payloads, hashtag counts, image profiles, WCAG contrast, GBP fields, a PASS/FAIL verdict) which also states concrete facts. It was removed from this stage, stays registered on `final-critic`, and is replaced by `skills/claim-boundaries/SKILL.md`: claim-level rules only, with **no facts of its own**, asserted by test.
- **No second model-call implementation.** The stage reuses the Phase 0B.1 boundary, the central model-policy resolution, and the shared evidence projection. It adds no retry wrapper, repair call, tool mechanism, or policy table.

Details in [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), and [Testing](docs/TESTING.md).

## Hook-story-script stage executor (Phase 0B.3)

**`IMPLEMENTED` in a draft pull request — not merged, therefore not on `main`, not deployed, not enabled, not production-validated, and deliberately dormant.**

Stage 3 writes the channel-neutral hook, the ordered story beats, and the script. Nothing calls it — not the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, or evidence-write paths, each asserted by test. `executionEnabled` was not changed for any stage, and no route, migration, environment variable, dependency, workflow change, or `render.yaml` change was added.

Stage 3 is where copy gets written, which makes it the stage most likely to quietly re-acquire a fact stage 2 refused.

- **Stage 2's whitelist is the boundary, not the pack.** A real, citable, non-conflicted, non-stale fact that `automotive-truth` did not permit is **not available here**: it is absent from the `PERMITTED_CLAIMS` projection and fails validation if cited. **Presence in the evidence pack is not permission.**
- **The complete pack is never offered as an alternate claim source.** The model sees only the whitelisted records, each with the evidence system's own wording and authoritative `kind` — not the pack's other sections.
- **The typed handoff is complete and revalidated, not trusted.** The invocation takes the complete `StrategyConceptOutput`, the complete `AutomotiveTruthOutput`, and the pack that bound them — not free-form `concept` and `allowedClaims` strings. Both are re-run through the prior stages' own validators against that pack, so a cast, hand-built, or tampered object is refused. Every prior-stage field arrives as bounded, labelled untrusted data; none reaches the instruction channel.
- **Copy is never evidence.** `claimUse` is a separate branded channel binding factual portions to permitted ids; `scriptClaimRecords()` and `scriptClaimTexts()` take ids and never read the hook, beats, script, or a paraphrase.
- **What deterministic validation cannot do, stated plainly.** It checks structure, bounds, enums, ids, and whitelist membership. It **cannot** prove a paraphrase faithful to the fact it cites, and it **cannot** detect every uncited factual implication. **No language model in this pipeline proves a statement true.** A regression test feeds a drifting paraphrase and several uncited factual assertions, confirms they *validate*, and then confirms they reach neither accessor.
- **Zero permitted claims refuses before the model call.** Writing a "clearly non-factual draft" would hand a finished-looking script full of unfounded statements to stages with no mechanism to keep it non-factual, and asking for compelling copy with no permitted facts invites the model to supply its own. Authority is never widened from the pack to rescue the refusal.
- **Two registered placeholder assets were rejected.** `agents/copywriter.md` pins its own model, declares tools, and returns per-platform bilingual post bodies — platform adaptation and translation, both later stages. `skills/brand-voice/SKILL.md` is a real style authority but carries a founding year, a locality, a street address, a slogan, makes, and CTAs, which would let stage 3 regain from a style file a fact stage 2 refused. Both files are preserved unchanged for their current consumers; stage 3 uses `agents/hook-story-script.md` (which declares `tools: []` and pins no model) and `skills/script-craft/SKILL.md` (craft only, **no facts of its own**, asserted by test).
- **No second model-call implementation.** It reuses the shared boundary, the strict JSON parser, the central model-policy resolver, and the shared evidence helpers. No retry, repair call, tool mechanism, or policy table.

Details in [Architecture](docs/ARCHITECTURE.md), [Roadmap](docs/ROADMAP.md), and [Testing](docs/TESTING.md).

## Local validation

Node 22 is required. The routine offline/static sequence is:

```bash
npm ci
npm run typecheck
npm run build
npm run test:offline
npm run dryrun
npm run test:deployment-controller
npm run check:markdown-links
npm run check:env-coverage
npm run scan:sensitive
npm audit --omit=dev
git diff --check
```

PostgreSQL and bound HTTP suites are opt-in and refuse non-loopback/default targets. Use only uniquely disposable local databases as described in [Testing](docs/TESTING.md). Never run `dryrun:live`, diagnostics, migrations, scheduler/worker, approval decisions, model/image calls, or provider publishing against an unidentified environment or without explicit authority.

The tracked `.DS_Store` is unrelated generated OS metadata. `.gitignore` blocks future copies; remove the tracked file only in a separate explicitly scoped cleanup.

## Documentation and roadmap rules

Both rules are binding and live in [`AGENTS.md`](AGENTS.md); [`CONTRIBUTING.md`](CONTRIBUTING.md) carries the matching definition of done.

**Documentation is part of every change.** A change is not complete until every affected Markdown file, environment example, runbook, diagram, command, path, inline operational note, and external setup description is updated in the same atomic change; instructions that no longer apply are removed or explicitly archived; every modified document is reread whole; documented paths, commands, variables, service names, routes, schedules, links, and identifiers are verified against source; this README is updated whenever architecture, data flow, deployment, security, operations, ownership, recovery, or external dependencies change; and unresolved uncertainty, manual prerequisites, rollout gates, and external-system dependencies are recorded rather than presented as completed.

**Roadmap continuity is mandatory.** [`docs/ROADMAP.md`](docs/ROADMAP.md) is the canonical work sequence and current cursor; [`docs/STATUS.md`](docs/STATUS.md) records verified reality. Any change that implements, reorders, blocks, expands, narrows, supersedes, or completes roadmap scope must update the roadmap in the same change — finishing implementation is itself a roadmap-state change. Phase states (`PLANNED`, `IMPLEMENTED`, `MERGED`, `CONFIGURED`, `ENABLED`, `DEPLOYED`, `PRODUCTION-VALIDATED`, `BLOCKED`, `DEFERRED`, `SUPERSEDED`) stay distinct and are never collapsed into "done".
