# Current status

This file separates four things that are routinely confused: what is in the repository, what is running in production, what phase state each body of work is in, and what the single next safe operation is. **Repository state and production state are intentionally different right now** and are expected to stay different until the separately authorized bootstrap release described below.

## Repository state

**Verified:** 2026-08-26, by direct Git and GitHub inspection.

**GitHub is authoritative for the exact current `main`.** The row below is a dated verified baseline, not a live mirror: every merge moves `main`, and a merge SHA cannot be known before merging. Read `git rev-parse origin/main` when the exact value matters. A newer `main` than the one recorded here is normal and is **not** by itself a defect to chase — do not open follow-up work merely to refresh this SHA.

| Item | Verified state |
|---|---|
| `main` | `0828cc91c41c9cd10ad709db30491ada0a52c811` |
| That commit is | the merge of PR #36, "Fence worker ownership and recover interrupted briefs" |
| Its second parent | `281eb8f232995e58e404c916c3ec0a23b62c7acc`, the reviewed and CI-green head |
| Its first parent | `a797f4cbd85c477c1b558168b0a07018120adf64`, the merge of PR #35 |
| Migrations on `main` | 001–005; PR #36 added none |

## Production state

**Last verified:** 2026-08-24 21:32 UTC. **Not reverified since**, except where a later dated observation is recorded explicitly below.

**Evidence basis for that verification:** read-only GitHub PR, workflow, environment, secret-name, variable, and branch-policy metadata; read-only Render workspace, service, deploy, log, metric, and PostgreSQL metadata; and the public bounded API health endpoint. No secret value was retrieved and no SQL was run.

| Item | State at last verification | Freshness |
|---|---|---|
| API | `srv-d8u0qtpo3t8c73c5o44g`, live at `10098de…`; exact service/PostgreSQL/commit health passed | last verified 2026-08-24 21:32 UTC; not reverified |
| Worker | `srv-d8u0qtpo3t8c73c5o440`, live at `10098de…`; exact target-bound readiness observed | last verified 2026-08-24 21:32 UTC; not reverified |
| Scheduler | `crn-d8ulb4rtqb8s73bdjctg`, live artifact at `10098de…` | live deploy unchanged as of the 2026-08-25 run below |
| PostgreSQL | `dpg-d8u0qaho3t8c73c5nj40-a`, PostgreSQL 18, available; external allowlist `0.0.0.0/0` | last verified 2026-08-24 21:32 UTC; not reverified |
| Deploy activity | None in progress; no recent error/critical logs observed | last verified 2026-08-24 21:32 UTC; not reverified |
| Render native auto-deploy | Off on all three services (`autoDeploy: no`, `autoDeployTrigger: off`) | last verified 2026-08-24 21:32 UTC; not reverified |
| GitHub `production` environment | Present; secret name `RENDER_API_KEY`, five expected non-secret variables, `main` restriction | last verified 2026-08-24 21:32 UTC; not reverified |
| GitHub automation gate | `RENDER_DEPLOY_AUTOMATION_ENABLED=false` | last verified 2026-08-24 21:32 UTC; not reverified |
| Deployment authority | **Safe zero-unattended-authority window** | inference from the native auto-deploy and automation-gate rows; only as fresh as they are |

Production API pre-deploy logs for that release showed migrations 001–005 already applied.

**Repository `main` and the live release are separate facts and need not match.** Relative commit distance between them is a dated observation, never durable truth; the per-PR semantic state below is what matters.

- **PR #35** — merged; documentation-only, no runtime or deployment effect.
- **PR #36** — merged; worker ownership and recovery. **Deployed and production-validated** (operator-reported 2026-08-27).
- **PR #37** — merged; documentation and roadmap-continuity governance. No runtime or deployment effect.
- **PR #38** — merged; media publication normalization. **Deployed and production-validated** (operator-reported 2026-08-27).
- **PR #40 / Phase 0B.0** — **merged** 2026-08-27 as `44d7336…`. **Partially deployed 2026-08-28 (operator-verified, not independently verified here):** the API is live at `44d7336…` and **migration 006 was applied exactly once at `2026-08-28T15:24:18Z`**. The rollout **stopped at step 6** under S8/S18 — the runbook's index count was wrong — so the **worker and scheduler remain at `a6a4316…`**. That mixed version is a proven-compatible safe pause state.

Every row above marked "not reverified" must be reconfirmed read-only immediately before any production operation. Do not infer any of them from this file, from `render.yaml`, or from the fact that they were true two days ago.

### Observed: normal scheduled run of the Phase 0D production SHA

**Closed 2026-08-25.** The scheduler resource `crn-d8ulb4rtqb8s73bdjctg`, with its live deploy still at `10098de73667797120da8c7dfa4da83f336ff6ba`, executed a normal scheduled run:

| Time (UTC) | Event |
|---|---|
| 13:00:29.271 | Cron job run started |
| 13:00:52.353 | Running `npm run start:scheduler` |
| 13:00:52.646 | `node dist/scheduler/daily.js` |
| 13:00:52.861 | Scheduler enqueued brief `14616895-78f9-4c7b-a83f-74ecdeb5082e`, theme `Land Rover:oil-leak` |
| 13:00:59.881 | Cron job run finished successfully |

This closes the previously open item requiring observation of a normal scheduled execution of the current production SHA. The evidence is read-only Render cron-run output; no scheduler run was triggered to obtain it, and none should be.

## Phase state

| Work | State |
|---|---|
| Phase 0A Integrity Hardening — PR #33, merge `30d06f95…` | `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED` |
| Phase 0D CI and Deployment Control Foundation — PR #34, merge `10098de…` | `MERGED` · `DEPLOYED` as an application release |
| Phase 0D GitHub controller as the deployment authority | `CONFIGURED` — **not `ENABLED`, not `PRODUCTION-VALIDATED`** |
| PR #35 documentation reconciliation — merge `a797f4c…` | `MERGED`; documentation-only, no runtime effect |
| PR #36 worker ownership and recovery — merge `0828cc9…` | `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED` (operator-reported 2026-08-27) |
| PR #37 documentation and roadmap-continuity governance — merge `3bd638f…` | `MERGED`; documentation-only |
| PR #38 media publication normalization — merge `a6a4316…` | `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED` (operator-reported 2026-08-27) |
| Phase 0B prerequisite — fact and evidence contract | `IMPLEMENTED` — not `MERGED`, not `DEPLOYED` |
| **Phase 0B.0 evidence and agent registry foundation** — merge `44d7336…` | **`MERGED`** · **PARTIALLY `DEPLOYED`** — API live at the target and migration 006 applied 2026-08-28; worker and scheduler still `a6a4316…` (operator-verified) |
| Phase 0B six-stage reasoning execution | `PLANNED` — registered but not wired |
| Worker lease/reaper | `SUPERSEDED` by ownership plus startup recovery; rationale and re-entry condition in [Roadmap](ROADMAP.md) |

These states are not interchangeable. In particular: Phase 0B.0 is **merged and only partially deployed**, and its migration 006 **has** been applied to production while two of the three services still run the previous release. `MERGED` is a repository fact; `DEPLOYED` is a production fact; the two are separated here precisely because they now differ, and `DEPLOYED` is not even uniform across the three services. Completing the release requires the separately authorized rollout in the [Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md), resuming at the worker deployment under fresh authorization — not the ordinary controller path, and never a manual re-run of migration 006.

## Current cursor — the single next safe operation

Two independent tracks, neither blocking the other.

**Rollout (primary).** Phase 0B.0 is merged and **partially deployed**: API at the target with migration 006 applied, worker and scheduler still at `a6a4316…`. The rollout stopped at step 6 under S8/S18 on a documentation defect, now corrected. Resuming requires independent inspection of that correction, a fresh read-only preflight, fresh explicit authorization, and restart **at the worker deployment**. See [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md).

**Product.** Phase 0B continues: wire the six registered reasoning stages as real model calls, one slice at a time. Phase 0B.0 shipped without touching deployment authority and later slices can do the same.

**Operational follow-up.** The ownership bootstrap and handoff proof are complete (operator-reported 2026-08-27), so enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` and proving the GitHub controller path are now eligible. Each still needs its own authorization and immediate re-verification. **This is explicitly not a blocker to Phase 0B.**

One coupling to respect: migration 006 makes the release that carries Phase 0B.0 **migration-bearing**, so it must go through the separately authorized migration rollout rather than the ordinary controller path. Migration 006 was independently inspected on 2026-08-28: it is purely additive, takes **no lock on any pre-existing table**, applies in about 50 ms, and old `a6a4316…` code was **tested and proven** to start correctly against a database that already has it — which is what makes rollback safe.

[Roadmap](ROADMAP.md) holds the full ordered cursor with the preflight conditions. [Deployment control](DEPLOYMENT.md) holds the exact bootstrap mechanics. Never re-enable Render native auto-deploy while the GitHub gate is true.

## Closed production incident — scheduled content blocked before approval

**Closed 2026-08-27.** Fix `MERGED` (PR #38) · `DEPLOYED` · `PRODUCTION-VALIDATED`.

Since 2026-08-25, scheduled briefs have failed before an approval was created, with `image dimensions 1024x1024 are not an approved cross-platform feed profile`. The Land Rover brief and BMW brief `19811e5f-8899-4134-9634-3dd9a9a90827` (2026-08-26) both escalated. Nothing was published and no approval was orphaned — the pipeline failed closed, upstream of the approval gate — but no scheduled content is reaching a reviewer.

The publication-profile allowlist was being asserted against the raw provider render instead of against the final artifact, and no resize existed. A single authorized live diagnostic on 2026-08-27 confirmed the provider honors the requested **aspect** but not the requested **pixels**: a 1024x1280 request returned a 896x1120 PNG (exactly 4:5) with no width/height metadata at all. See [Roadmap](ROADMAP.md) for the full record and [Architecture](ARCHITECTURE.md) for the corrected media lifecycle.

**Resolution evidence — operator-reported 2026-08-27**, recorded as reported and not independently verified in this engineering session, which has no Render or production database access: a controlled brief ran the full content path, the provider returned a PNG at 896x1120, normalization scaled it uniformly to a 1080x1350 JPEG, image QC passed, and the brief reached a real human approval. Nothing was published automatically.

The approved publication profiles were not widened. No provider size was added.

## Verified production incident — worker lifecycle interruption

Brief `c5e53afe-2657-4e11-811d-53ce5e793245` was enqueued 2026-08-10 13:01:22Z, claimed at 13:01:29Z, and reached `brief:awaiting_approval` at 13:07:29Z. No later event exists and it is still `running`. Its approval `08ab5c07-4d36-4b66-810a-9856dae4ca5d` was approved by a human at 2026-08-11 12:39:01Z — inside the 24-hour wait — and later revoked by migration 005 on 2026-08-24 15:50:41Z as a legacy non-hash-bound row.

Root cause: the worker process was gone before the approval landed, so nothing was waiting. Publication is only reachable after `waitForApproval` returns `approved`, so no provider request occurred; the approval never left `approved` for `posted`/`failed`, and no publish event exists. The human approved a post that never published, and nothing alerted.

This is the second incident in the same family as the Phase 0A worker/migration-005 race: **worker lifecycle versus durable state**.

**Reconciled — operator-reported 2026-08-27, not independently verified in an engineering session.** The operator reports checking authenticated Instagram, Facebook, and Google Business Profile history beforehand and not finding the target post on any destination, then the new protected worker's startup recovery terminalizing the row with `providerMutation = impossible` and no provider replay. The reconciliation therefore rested on account evidence rather than on database absence, which is the correct basis. Recorded as reported.

## Material unresolved risks

1. No durable provider operation ledger, idempotency, or provider reconciliation. Timeout, crash, or retry can leave unknown or duplicate publication outcomes. Provider-level `withRetry` can still reissue a request after an ambiguous network outcome; PR #36 does not change that.
2. Worker interruption stranding is addressed by exclusive ownership plus startup recovery, **merged in PR #36 at `0828cc9…`; deployed and production-validated — operator-reported 2026-08-27, not independently verified in an engineering session**. Treat this risk as reported-closed rather than verified-closed until the live worker's ownership behaviour is reconfirmed read-only.
3. Production PostgreSQL external access was open to `0.0.0.0/0` at last verification.
4. Default-path Instagram tokens persist plaintext in `session_state`.
5. Approval uses a bearer URL and generic `human` label; control routes share one secret and process-local direct-socket rate limits.
6. No complete retention program, backup policy evidence, or restore drill; migration 005 intentionally blocks media deletion.
7. External provider ownership, scopes, review status, versions, quotas, billing, backup, and recovery details remain outside repository verification.
8. Checked-in facts still lack a durable provenance/confidence/freshness/conflict contract **in use**. Phase 0B.0 implements that contract and migration 006 is now applied, but `content_evidence` is empty until an authorized operator runs `evidence:sync`, and no reasoning stage reads it; the risk is unchanged in the live system.

## Not implemented

- durable provider-operation state/reconciliation and exactly-once guarantees;
- authenticated reviewer/control identities or operator revocation UI;
- encrypted provider-token persistence;
- runtime `AgentRegistry`, skill/reference injection, or research retrieval;
- the target six-stage Content Intelligence reasoning architecture;
- durable fact/evidence records, performance ingestion, active scorecard writes, hypothesis tracking, or governed improvement proposal generation;
- autonomy B/C behavior; every parsed phase still requires the Phase A approval gate; and
- browser-based video editing.

Brief leases and stale-work recovery are no longer listed here: stale-work recovery is merged (undeployed) and the lease design was superseded. See [Roadmap](ROADMAP.md).

## CI and production observation

PR #34's exact reviewed head passed Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML validation. After merge, the production workflow's authorization job failed closed because the gate was false, and the deploy job was skipped; this was the intended disabled-state behavior, not a controller release proof.

PR #36's exact reviewed head `281eb8f…` passed all five CI jobs before merge. Its ownership and recovery behavior is proven by offline suites and by disposable local PostgreSQL integration — including real advisory-lock contention and a `pg_terminate_backend` proof that a claim cannot commit after ownership loss — but it has **no production evidence**, because it has not been deployed.

The current production release was observed live on all three services through Render's previous native auto-deploy path. API pre-deploy completed with all migrations already recorded, API health returned the exact Phase 0D SHA, and the worker emitted the exact ready marker. This proves current application deployment and health, not GitHub controller authority. See [Testing](TESTING.md) for deterministic coverage and [Deployment control](DEPLOYMENT.md) for release semantics.

## Local workspace note

The tracked `.DS_Store` is unrelated generated OS metadata and is intentionally out of scope. `.gitignore` already blocks future copies. Remove the tracked file only in a separate explicitly authorized cleanup.
