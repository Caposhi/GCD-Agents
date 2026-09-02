# Current status

This file separates four things that are routinely confused: what is in the repository, what is running in production, what phase state each body of work is in, and what the single next safe operation is. **Repository state and production state are separate facts and currently differ.** Production was last independently verified at `44d7336…` on 2026-08-28. The source lineage additionally carries the merged, dormant Phase 0B.1 `strategy-concept`, Phase 0B.2 `automotive-truth`, Phase 0B.3 `hook-story-script`, Phase 0B.4 `production-direction`, Phase 0B.5 `packaging-adaptation`, and Phase 0B.6 `final-critic` executors — **all six are now on `main`**, none established as deployed or production-validated — nothing calls any of them, so the difference changes no production behavior. **The exact current `main` is a Git/GitHub lookup, not a field this file maintains**: run `git rev-parse origin/main`. The dated baseline table below is historical evidence of a verified state, not a live mirror; it is deliberately not refreshed to chase the current tip.

## Repository state

**Verified:** 2026-08-28, by direct Git and GitHub inspection.

**GitHub is authoritative for the exact current `main`.** The row below is a dated verified baseline, not a live mirror: every merge moves `main`, and a merge SHA cannot be known before merging. Read `git rev-parse origin/main` when the exact value matters. A newer `main` than the one recorded here is normal and is **not** by itself a defect to chase — do not open follow-up work merely to refresh this SHA.

| Item | Verified state |
|---|---|
| `main` | `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` |
| That commit is | the merge of PR #40, "feat: add Content Intelligence evidence and agent foundation" |
| Its second parent | `4891bf3d76cc1451cba90b61f9805b232bb045e9`, the reviewed and CI-green head |
| Its first parent | `a6a4316c20f7dfc45921683b59fc042ad7266087`, the merge of PR #38 |
| Migrations on `main` | 001–006; PR #40 added `006_content_evidence.sql` |

## Production state

**Last verified:** 2026-08-28, by a separate final-inspection session using Render and read-only PostgreSQL access, except where a row is explicitly marked as carrying only the older 2026-08-24 21:32 UTC verification.

**Evidence basis:** read-only GitHub PR, workflow, environment, secret-name, variable, and branch-policy metadata; read-only Render workspace, service, deploy, log, metric, and PostgreSQL metadata; the public bounded API health endpoint; and, for the 2026-08-28 rows, read-only PostgreSQL queries. No secret value was retrieved and no write SQL was run.

| Item | State at last verification | Freshness |
|---|---|---|
| API | `srv-d8u0qtpo3t8c73c5o44g`, live at `44d7336…`; `/healthz` healthy with PostgreSQL state and the exact target | independently verified 2026-08-28 |
| Worker | `srv-d8u0qtpo3t8c73c5o440`, live at `44d7336…` | independently verified 2026-08-28 |
| Scheduler | `crn-d8ulb4rtqb8s73bdjctg`, live artifact at `44d7336…`; cron unchanged at `0 13 * * *` | independently verified 2026-08-28 |
| PostgreSQL | `dpg-d8u0qaho3t8c73c5nj40-a`, PostgreSQL 18, available; `_migrations` holds six rows with `006` exactly once; external allowlist confirmed still `0.0.0.0/0` | independently verified 2026-08-28, including the external allowlist |
| Row counts | 71 briefs, 62 approvals, 168 media, 0 content evidence, 0 evidence relations, 0 pending briefs, 0 running briefs, 0 live pending approvals | independently verified 2026-08-28 |
| Deploy activity | None in progress; no API, worker, or scheduler errors during the rollout interval | independently verified 2026-08-28 |
| Render native auto-deploy | Off on all three services (`autoDeploy: no`, `autoDeployTrigger: off`) | independently verified 2026-08-28 |
| GitHub `production` environment | Present; secret name `RENDER_API_KEY`, five expected non-secret variables, `main` restriction | **last verified 2026-08-24 21:32 UTC; not reverified** |
| GitHub automation gate | `RENDER_DEPLOY_AUTOMATION_ENABLED=false` | independently verified 2026-08-28 |
| Deployment authority | **Safe zero-unattended-authority window** | inference from the native auto-deploy and automation-gate rows, both verified 2026-08-28 |

The API pre-deploy runner applied migration 006 during this release; `_migrations` now holds `001–006`.

**Repository `main` and the live release are separate facts.** They matched at the dated 2026-08-28 baseline, but later source-only merges mean that equality must not be presented as current truth. Relative commit distance is always a dated observation; the per-PR semantic state below is what matters.

- **PR #35** — merged; documentation-only, no runtime or deployment effect.
- **PR #36** — merged; worker ownership and recovery. **Deployed** — the code is live in the current `44d7336…` release, independently verified 2026-08-28; the behavioral bootstrap evidence (production-validated behavior) remains operator-reported 2026-08-27, not independently re-examined.
- **PR #37** — merged; documentation and roadmap-continuity governance. No runtime or deployment effect.
- **PR #38** — merged; media publication normalization. **Deployed** — the code is live in the current `44d7336…` release, independently verified 2026-08-28; the controlled-brief evidence (production-validated behavior) remains operator-reported 2026-08-27, not independently re-examined.
- **PR #40 / Phase 0B.0** — **merged** 2026-08-27 as `44d7336…`. **Deployed 2026-08-28.** Independently verified by a separate final-inspection session with Render and read-only PostgreSQL access: API, worker, and scheduler all report `44d7336…`; `_migrations` holds `006` exactly once; the evidence tables are empty; row counts unchanged; no errors during the rollout interval. The exact migration timestamp (`2026-08-28T15:24:18.56508Z`, ~53 ms), the ownership-acquisition timings on the two worker deploys (58,142 ms then 60,094 ms), and the single-preview execution details are **operator-reported**, recording what the operator performed and observed rather than a re-derivation by the inspection session. The rollout **stopped at step 6** under S8/S18 mid-flight — the runbook's index count was wrong, not the schema — then resumed under fresh authorization and completed, with one documented, authorization-governed variance at step 13 (see the cursor below). See [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md) for the full operator record.

The row above marked "not reverified" — the GitHub `production` environment variables — must be reconfirmed read-only immediately before any production operation; it is now the only row still carrying just the 2026-08-24 verification. The 2026-08-28 rows, including the PostgreSQL external allowlist, are fresh as of that inspection but are still a point-in-time observation; do not infer any of them from this file, from `render.yaml`, or from the fact that they were true earlier.

### Observed: normal scheduled run of the Phase 0D production SHA

**Closed 2026-08-25.** The scheduler resource `crn-d8ulb4rtqb8s73bdjctg`, with its live deploy still at `10098de73667797120da8c7dfa4da83f336ff6ba`, executed a normal scheduled run:

| Time (UTC) | Event |
|---|---|
| 13:00:29.271 | Cron job run started |
| 13:00:52.353 | Running `npm run start:scheduler` |
| 13:00:52.646 | `node dist/scheduler/daily.js` |
| 13:00:52.861 | Scheduler enqueued brief `14616895-78f9-4c7b-a83f-74ecdeb5082e`, theme `Land Rover:oil-leak` |
| 13:00:59.881 | Cron job run finished successfully |

This closes the previously open item requiring observation of a normal scheduled execution of the **then-current** production SHA (`10098de…`); it does not describe the current `44d7336…` release, which deployed on 2026-08-28. The evidence is read-only Render cron-run output; no scheduler run was triggered to obtain it, and none should be.

## Phase state

| Work | State |
|---|---|
| Phase 0A Integrity Hardening — PR #33, merge `30d06f95…` | `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED` |
| Phase 0D CI and Deployment Control Foundation — PR #34, merge `10098de…` | `MERGED` · `DEPLOYED` as an application release |
| Phase 0D GitHub controller as the deployment authority | `CONFIGURED` — **not `ENABLED`, not `PRODUCTION-VALIDATED`** |
| PR #35 documentation reconciliation — merge `a797f4c…` | `MERGED`; documentation-only, no runtime effect |
| PR #36 worker ownership and recovery — merge `0828cc9…` | `MERGED` · `DEPLOYED` (independently verified 2026-08-28) · `PRODUCTION-VALIDATED` (operator-reported 2026-08-27, not independently re-examined) |
| PR #37 documentation and roadmap-continuity governance — merge `3bd638f…` | `MERGED`; documentation-only |
| PR #38 media publication normalization — merge `a6a4316…` | `MERGED` · `DEPLOYED` (independently verified 2026-08-28) · `PRODUCTION-VALIDATED` (operator-reported 2026-08-27, not independently re-examined) |
| Phase 0B prerequisite — fact and evidence contract | `MERGED` · `DEPLOYED` — delivered by Phase 0B.0; migration 006 applied 2026-08-28 |
| **Phase 0B.0 evidence and agent registry foundation** — merge `44d7336…` | **`MERGED`** · **`DEPLOYED`** — API, worker, and scheduler all at the target, migration 006 applied 2026-08-28 (independently verified 2026-08-28) |
| **Phase 0B.1 `strategy-concept` stage executor** — merge `8c8bd5b…` | **`MERGED`** — **not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`**; dormant, no production path reaches it |
| **Phase 0B.2 `automotive-truth` stage executor** — PR #44, merge `52050b4…` | **`MERGED`** — **not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`**; deliberately dormant, no production path reaches it, `executionEnabled: false` |
| **Phase 0B.3 `hook-story-script` stage executor** — PR #46, merge `c129bbf…` | **`MERGED`** — **not `ENABLED`, not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`**; deliberately dormant, no production path reaches it, `executionEnabled: false` |
| **Phase 0B.4 `production-direction` stage executor** — PR #48, merge `5d3b2ca…` | **`MERGED`** — **not `ENABLED`, not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`**; deliberately dormant, no production path reaches it, `executionEnabled: false`; production evidence: none |
| **Phase 0B.5 `packaging-adaptation` stage executor** — PR #50, merge `360f89a…` | **`MERGED`** — **not `ENABLED`, not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`**; deliberately dormant, no production path reaches it, `executionEnabled: false`; production evidence: none |
| **Phase 0B.6 `final-critic` stage executor** — PR #52 (merge `ec2a0b78e84386d5491db96418a53c64ee3a8e08`) | **`MERGED`** — **not `ENABLED`, not established as `DEPLOYED`, not `PRODUCTION-VALIDATED`**; deliberately dormant, no production path reaches it, `executionEnabled: false`; production evidence: none. **All six target stage executors are now merged to `main`.** |
| Worker lease/reaper | `SUPERSEDED` by ownership plus startup recovery; rationale and re-entry condition in [Roadmap](ROADMAP.md) |

These states are not interchangeable. In particular: Phase 0B.0 is **merged and deployed**, and its migration 006 **has** been applied to production and all three services report the target commit. `MERGED` is a repository fact; `DEPLOYED` is a production fact; they happened to diverge for a period during this rollout (API deployed before worker and scheduler) and are recorded here as now reconciled. Migration 006 must never be manually re-run — the runner records it as applied and would skip it, but applying it by hand outside a transaction would silently disable its `SET LOCAL` timeout guards. See the [Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md) for the completion record.

## Current cursor — the single next safe operation

Two independent tracks, neither blocking the other.

**Rollout — complete, with one documented variance.** Phase 0B.0 is merged and **deployed**: API, worker, and scheduler all at the target with migration 006 applied. The rollout stopped once, mid-flight, at step 6 under S8/S18 on a documentation defect (9 vs. 10 indexes); once corrected and independently inspected, it resumed under fresh authorization and completed.

Completion carried a **documented, authorization-governed variance at step 13**: the operator authorization granted exactly **one** authenticated production preview call, and exactly one was made. Step 13's written procedure asks for two calls to compare byte-identical responses; that deterministic-equality check was instead satisfied by the existing automated fixed-input test (`S5. preview is deterministic for a fixed trace and clock`), which runs on every PR and on `main`. **No second production preview was executed**, and none should be inferred. Not every literal subcheck ran as written — this one was met by different, pre-existing evidence, deliberately and within the authorization.

See [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md) for the full record. Remaining separately authorized follow-ups: a first production `evidence:sync` (not yet run), and the Phase 0D.1 authority cutover below.

**Product.** Phase 0B continues, one stage at a time. **Phase 0B.1 is `MERGED`** through PR #42 (merge `8c8bd5b0fd500f9a28247f472fd6626bb05c6ebd`, reviewed head `2dc416f…`, base `aec3e805…`) and is **not established as deployed or production-validated**. It is dormant by design: no worker, scheduler, orchestrator, approval path, or HTTP route calls it, the preview stays inert, and all six registry entries still have `executionEnabled: false`. Phase 0B.0 shipped without touching deployment authority and 0B.1 did the same — no route, migration, environment variable, publishing path, approval path, or provider authority was added.

**Phase 0B.2 is `MERGED`, deliberately dormant, and not established as deployed or production-validated.** PR #44 merged the `automotive-truth` executor without changing reachability: the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, and evidence-write paths cannot reach it, and all six stages remain `executionEnabled: false`. It receives the complete typed Stage 1 result as bounded untrusted data and structurally whitelists exact ids from an evidence projection that includes authoritative `kind`. Its guarantee is that **no sentence the model writes becomes a claim the pipeline may make** — not that either stage's prose or a restatement is semantically proved true; see [Roadmap](ROADMAP.md).

**Phase 0B.3 is `MERGED`, deliberately dormant, not enabled, and not established as deployed or production-validated.** PR #46 merged the `hook-story-script` executor without changing reachability: the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, and evidence-write paths cannot reach it, and all six stages remain `executionEnabled: false`. Its guarantee is that **stage 2's whitelist is the boundary — a fact's presence in the evidence pack is not permission to say it** — not that the script's prose is checked for truth or that a paraphrase is proved faithful. Merge is repository evidence, not deployment or production-validation evidence; see [Roadmap](ROADMAP.md).

**Phase 0B.4 is `MERGED`, deliberately dormant, not enabled, and not established as deployed or production-validated.** PR #48 merged the `production-direction` executor to `main` without changing reachability: the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image-generation, Slack, database, and evidence-write paths cannot reach it, and all six stages remain `executionEnabled: false`. It changed no `executionEnabled` field and added no route, migration, environment variable, credential, dependency, workflow change, `render.yaml` change, deployment authority, or provider mechanism. **Merge is a repository fact, not a deployment fact — nothing establishes that Render is running this code, and there is no production evidence for it.** Its boundary narrows again: **stage 3's *used* claims are the authority — not stage 2's whitelist and not the evidence pack** — and stage 2's prose is never shown to the model. What it does not do is prove that a shot represents reality, that a requested asset exists or may lawfully be used, or that an action is safe; see [Roadmap](ROADMAP.md).

**Phase 0B.5 is `MERGED` through PR #50, deliberately dormant, not enabled, and not established as deployed or production-validated.** It is present on `main`; merge is repository evidence only, and **production evidence is none**. Nothing reaches the `packaging-adaptation` executor through the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, or evidence-write paths. It changed no `executionEnabled` field and added no route, migration, environment variable, credential, dependency, workflow change, `render.yaml` change, provider payload, or scheduling behaviour. **Stage 3's actually used claims remain the complete factual authority** — stage 4's direction is creative context, never a claim source, and stage 4's narrower visual selection does not shrink the caption authority. Independent review strengthened three deterministic boundaries without widening scope: exhaustive bidirectional platform maps, caption-only hashtag refusal plus combined provider-text limits, and one recognizable-URL syntax guard across all model-authored prose channels while dedicated URL/destination fields remain structurally absent. It still does not prove caption faithfulness, hashtag or keyword relevance/truth, timing usefulness, or the absence of obfuscated or semantic destination language; see [Roadmap](ROADMAP.md).

**Phase 0B.6 is `MERGED` through PR #52 (merge `ec2a0b78e84386d5491db96418a53c64ee3a8e08`), deliberately dormant, not enabled, and not established as deployed or production-validated.** It is present on `main` on the same terms as Phase 0B.1–0B.5; merge is repository evidence only, and **production evidence is none**. With it, **all six target stage executors are merged and every registry entry reports `executionEnabled: false`.** Nothing reaches the `final-critic` executor through the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, or evidence-write paths. It changed no `executionEnabled` field and added no route, migration, environment variable, credential, dependency, workflow change, `render.yaml` change, provider payload, approval logic, or scheduling behaviour. **Stage 3's actually used claims remain the complete factual authority, narrowed further by stage 5's own per-platform bindings (`PLATFORM_CLAIMS`)** — the entire prior chain (stages 2–5) is revalidated before any model call, and the requested-platform sequence is separately checked against stage 5's own package sequence. Its critique carries five literal-`false` fields (`authoritative`, `approvalGranted`, `publishable`, `executable`, `productionValidated`) that the output contract gives a model no field to escape; it does not replace the existing `brand-compliance-critic` publishing gate, which is unchanged. It still does not prove a finding correct, that the package actually has the described problem, or that the verdict is the right call. **Payload boundary at that merge — since addressed, on a draft pull request that is not merged:** as merged, Stage 6 did not accept every structurally valid Stage 5 handoff, because the shared assembled-payload boundary `MAX_PAYLOAD_CHARS` (120,000) refused a maximal Stage 5 output before any model call, and no fixed packaging envelope existed to quote while `EvidenceRecord.claim` was unbounded. The same producer/consumer guard mismatch existed between merged Stages 1–5, and an equivalent one between the stage output contracts and their configured model token budgets. **The payload-contract reconciliation that closes all of that is implemented on a draft pull request** — see the next paragraph. See [Roadmap](ROADMAP.md).

**The payload-contract reconciliation is implemented on draft PR #54 — not merged, not deployed, not enabled, and not production-validated.** Its single authority derives the **370,000** assembled boundary and exact handoff guards. It enforces 64 projected records and, separately, 64 conflict entries; exhaustive detection still emits all 2,016 pairs for 64 mutually conflicting facts, then every consumer refuses that intact over-bound pack before a model call. Evidence records are revalidated at pack construction, durable-row reconstruction, pack projection, and the shared pre-model boundary. Text limits also cap UTF-8 bytes. The 4,000-byte `detail` contract is PostgreSQL-canonical `jsonb::text`, including the 327-byte signed `-5e-324` worst case; relation notes are validated in TypeScript, NULL tag elements are rejected, and migration 007's uniquely versioned helper is collision-safe. Disposable PostgreSQL 16.15 and 18.6 each pass 208 apply/enforce/rollback/reapply and collision checks (fresh 59, upgrade 80, durable 69); **neither 007 nor its rollback has run in production**. The six output budgets are derived from escaping-aware serialized byte ceilings at one token per byte: 40,000 / 79,000 / 73,000, below the centralized 128,000-token caps. The typed centralized stage policy explicitly disables Anthropic thinking because adaptive thinking shares `max_tokens`; the exact production request is tested, while legacy `runAgent` and vision behavior remain unchanged. Stage 5's 2,200-character caption narrowing and Stage 6's ids-only projection remain. `CC1`–`CC38` and nineteen mutations across eight files prove the corrections load-bearing. **Production evidence remains only the operator's 2026-09-02 aggregate read-only audit**, which found both evidence tables empty and retrieved no raw claims, PII, credentials, or secrets. **Next: a production-wiring design and review**, only after this reconciliation is accepted. All six stages remain unreachable and `executionEnabled: false`; deployment-authority work remains separate.

**Operational follow-up.** The ownership bootstrap and handoff proof are complete (operator-reported 2026-08-27) and the Phase 0B.0 rollout is complete (independently verified 2026-08-28), so enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` and proving the GitHub controller path are now **eligible** — they remain separately unauthorized, and the gate was confirmed `false` on 2026-08-28. Each still needs its own authorization and immediate re-verification. **This is explicitly not a blocker to Phase 0B.**

One coupling that remains relevant for future migration-bearing work: a release carrying a new migration must go through the separately authorized migration rollout rather than the ordinary controller path. Migration 006 was independently inspected on 2026-08-28: it is purely additive, takes **no lock on any pre-existing table**, applies in about 50 ms, and old `a6a4316…` code was **tested and proven** to start correctly against a database that already has it — which is what made rollback safe throughout this rollout.

[Roadmap](ROADMAP.md) holds the full ordered cursor with the preflight conditions. [Deployment control](DEPLOYMENT.md) holds the exact bootstrap mechanics. Never re-enable Render native auto-deploy while the GitHub gate is true.

## Closed production incident — scheduled content blocked before approval

**Closed 2026-08-27.** Fix `MERGED` (PR #38) · `DEPLOYED` · `PRODUCTION-VALIDATED`.

Since 2026-08-25, scheduled briefs have failed before an approval was created, with `image dimensions 1024x1024 are not an approved cross-platform feed profile`. The Land Rover brief and BMW brief `19811e5f-8899-4134-9634-3dd9a9a90827` (2026-08-26) both escalated. Nothing was published and no approval was orphaned — the pipeline failed closed, upstream of the approval gate — but no scheduled content is reaching a reviewer.

The publication-profile allowlist was being asserted against the raw provider render instead of against the final artifact, and no resize existed. A single authorized live diagnostic on 2026-08-27 confirmed the provider honors the requested **aspect** but not the requested **pixels**: a 1024x1280 request returned a 896x1120 PNG (exactly 4:5) with no width/height metadata at all. See [Roadmap](ROADMAP.md) for the full record and [Architecture](ARCHITECTURE.md) for the corrected media lifecycle.

**Resolution evidence — operator-reported 2026-08-27**, recorded as reported and not independently verified in this engineering session, which has no Render or production database access: a controlled brief ran the full content path, the provider returned a PNG at 896x1120, normalization scaled it uniformly to a 1080x1350 JPEG, image QC passed, and the brief reached a real human approval. Nothing was published automatically.

The approved publication profiles were not widened. No provider size was added.

## Verified production incident — worker lifecycle interruption

Brief `c5e53afe-2657-4e11-811d-53ce5e793245` was enqueued 2026-08-10 13:01:22Z, claimed at 13:01:29Z, and reached `brief:awaiting_approval` at 13:07:29Z. No later event existed from that period, and the row was still `running` at the time of the pre-reconciliation observation. Its approval `08ab5c07-4d36-4b66-810a-9856dae4ca5d` was approved by a human at 2026-08-11 12:39:01Z — inside the 24-hour wait — and later revoked by migration 005 on 2026-08-24 15:50:41Z as a legacy non-hash-bound row. The brief itself was subsequently terminalized during the operator-reported startup recovery described below (`providerMutation = impossible`). **Current production has zero running briefs — independently verified 2026-08-28.**

Root cause: the worker process was gone before the approval landed, so nothing was waiting. Publication is only reachable after `waitForApproval` returns `approved`, so no provider request occurred; the approval never left `approved` for `posted`/`failed`, and no publish event exists. The human approved a post that never published, and nothing alerted.

This is the second incident in the same family as the Phase 0A worker/migration-005 race: **worker lifecycle versus durable state**.

**Reconciled — operator-reported 2026-08-27, not independently verified in an engineering session.** The operator reports checking authenticated Instagram, Facebook, and Google Business Profile history beforehand and not finding the target post on any destination, then the new protected worker's startup recovery terminalizing the row with `providerMutation = impossible` and no provider replay. The reconciliation therefore rested on account evidence rather than on database absence, which is the correct basis. Recorded as reported.

## Material unresolved risks

1. No durable provider operation ledger, idempotency, or provider reconciliation. Timeout, crash, or retry can leave unknown or duplicate publication outcomes. Provider-level `withRetry` can still reissue a request after an ambiguous network outcome; PR #36 does not change that.
2. Worker interruption stranding is addressed by exclusive ownership plus startup recovery, **merged in PR #36 at `0828cc9…`; deployed — the code is live in the current `44d7336…` release, independently verified 2026-08-28**. The behavioral closure (production-validated) remains **operator-reported 2026-08-27, not independently re-examined**. Treat that specific behavioral claim as reported-closed rather than verified-closed until the live worker's ownership behaviour is reconfirmed read-only.
3. Production PostgreSQL external access remains open to `0.0.0.0/0` — independently reverified 2026-08-28; unchanged and still a high-priority, separately authorized follow-up.
4. Default-path Instagram tokens persist plaintext in `session_state`.
5. Approval uses a bearer URL and generic `human` label; control routes share one secret and process-local direct-socket rate limits.
6. No complete retention program, backup policy evidence, or restore drill; migration 005 intentionally blocks media deletion.
7. External provider ownership, scopes, review status, versions, quotas, billing, backup, and recovery details remain outside repository verification.
8. Checked-in facts still lack a durable provenance/confidence/freshness/conflict contract **in use**. Phase 0B.0 implements that contract and migration 006 is now applied, but `content_evidence` is empty until an authorized operator runs `evidence:sync`, and no reasoning stage reads it; the risk is unchanged in the live system.

## Not implemented

- durable provider-operation state/reconciliation and exactly-once guarantees;
- authenticated reviewer/control identities or operator revocation UI;
- encrypted provider-token persistence;
- production execution through `AgentRegistry`, production skill/reference injection, or research retrieval;
- the complete target six-stage Content Intelligence reasoning architecture — all six executors are merged to `main` (`final-critic` through PR #52), but no stage is production-wired; the payload-contract reconciliation that gates enablement is **implemented on a draft pull request and not merged**, so it is not yet satisfied, and production wiring has not been designed or reviewed;
- populated production fact/evidence records, performance ingestion, active scorecard writes, hypothesis tracking, or governed improvement proposal generation;
- autonomy B/C behavior; every parsed phase still requires the Phase A approval gate; and
- browser-based video editing.

Brief leases and stale-work recovery are no longer listed here: stale-work recovery is merged and deployed, and the lease design was superseded. See [Roadmap](ROADMAP.md).

## CI and production observation

PR #34's exact reviewed head passed Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML validation. After merge, the production workflow's authorization job failed closed because the gate was false, and the deploy job was skipped; this was the intended disabled-state behavior, not a controller release proof.

PR #36's exact reviewed head `281eb8f…` passed all five CI jobs before merge. Its ownership and recovery behavior is proven by offline suites and by disposable local PostgreSQL integration — including real advisory-lock contention and a `pg_terminate_backend` proof that a claim cannot commit after ownership loss. It is **deployed**, and its production evidence is the operator-reported 2026-08-27 bootstrap (a ~58-second ownership wait before readiness, and reconciliation of the August 10 stranded brief). That specific evidence was **not** re-examined by the 2026-08-28 final inspection, which verified current service SHAs, health, control settings, migration state, inventory, queue counts, and error absence — not the earlier bootstrap's provider-history reconciliation.

PR #44's exact reviewed head `5b2ed96663643fe68d3cc72a64137cb9abd87e4e` passed all five GitHub CI jobs before merge: Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML static validation. That is repository validation for the dormant Phase 0B.2 source, not deployment or production evidence.

PR #48's exact reviewed head `9be76b0126052150b2d408c6996c7103126d3b46` passed all five GitHub CI jobs before merge: Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML static validation. That is repository validation for the dormant Phase 0B.4 source, not deployment or production evidence.

PR #46's exact reviewed head `b46a70ffbb60711085f5d48679c9a2ad20e5db13` passed all five GitHub CI jobs before merge: Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML static validation. That is repository validation for the dormant Phase 0B.3 source, not deployment or production evidence.

The Phase 0D release (`10098de…`) was, at the time, observed live on all three services through Render's previous native auto-deploy path: API pre-deploy completed with all migrations already recorded, API health returned the exact Phase 0D SHA, and the worker emitted the exact ready marker. That observation proved application deployment and health for that historical release, not GitHub controller authority — it does not describe the current release. **The current production release, `44d7336…`, was reached through the separately authorized manual migration-bearing rollout** in [ROLLOUT_PHASE_0B0.md](ROLLOUT_PHASE_0B0.md), not through the GitHub controller path, and was independently verified live on all three services on 2026-08-28. See [Testing](TESTING.md) for deterministic coverage and [Deployment control](DEPLOYMENT.md) for release semantics.

## Local workspace note

The tracked `.DS_Store` is unrelated generated OS metadata and is intentionally out of scope. `.gitignore` already blocks future copies. Remove the tracked file only in a separate explicitly authorized cleanup.
