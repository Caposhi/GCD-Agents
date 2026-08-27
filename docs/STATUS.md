# Current status

This file separates four things that are routinely confused: what is in the repository, what is running in production, what phase state each body of work is in, and what the single next safe operation is. **Repository state and production state are intentionally different right now** and are expected to stay different until the separately authorized bootstrap release described below.

## Repository state

**Verified:** 2026-08-26, by direct Git and GitHub inspection.

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

**The live release is `10098de…`, which is two merges behind `main`** (PR #35 and PR #36; seven commits by `git rev-list`). That is expected and deliberate: PR #35 was documentation-only and PR #36 is merged but not deployed. Do not treat repository `main` and the live SHA as facts that ought to match.

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
| **PR #36 worker ownership and recovery — merge `0828cc9…`** | **`MERGED` — not `DEPLOYED`, not `PRODUCTION-VALIDATED`** |
| Phase 0B Content Intelligence runtime | `PLANNED` — not begun |
| Worker lease/reaper | `SUPERSEDED` by ownership plus startup recovery; rationale and re-entry condition in [Roadmap](ROADMAP.md) |

These states are not interchangeable. In particular: the worker currently running in production does **not** contain the ownership code and does **not** participate in the advisory-lock protocol.

## Current cursor — the single next safe operation

Phase 0D.1, the deployment-authority cutover, is paused between authorities. **PR #36 changed what comes next.** Enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` is no longer the next step, because the worker it would deploy to is still the unprotected one.

The next operation, under its own explicit authorization, is a **read-only production reverification** of every row marked "not reverified" above. After that, and only under separate authorization each time, the ordered path is: reconcile the August 10 incident against provider account history; resolve the stale `running` row; perform a **manually controlled Render bootstrap release of the ownership fix while the GitHub gate stays `false`**; verify ownership acquisition, reconciliation, and readiness at that SHA; prove worker handoff with both versions holding the lock; and only then consider enabling the gate and proving the controller path.

[Roadmap](ROADMAP.md) holds the full ordered cursor with the preflight conditions. [Deployment control](DEPLOYMENT.md) holds the exact bootstrap mechanics. Never re-enable Render native auto-deploy while the GitHub gate is true.

## Verified production incident — worker lifecycle interruption

Brief `c5e53afe-2657-4e11-811d-53ce5e793245` was enqueued 2026-08-10 13:01:22Z, claimed at 13:01:29Z, and reached `brief:awaiting_approval` at 13:07:29Z. No later event exists and it is still `running`. Its approval `08ab5c07-4d36-4b66-810a-9856dae4ca5d` was approved by a human at 2026-08-11 12:39:01Z — inside the 24-hour wait — and later revoked by migration 005 on 2026-08-24 15:50:41Z as a legacy non-hash-bound row.

Root cause: the worker process was gone before the approval landed, so nothing was waiting. Publication is only reachable after `waitForApproval` returns `approved`, so no provider request occurred; the approval never left `approved` for `posted`/`failed`, and no publish event exists. The human approved a post that never published, and nothing alerted.

This is the second incident in the same family as the Phase 0A worker/migration-005 race: **worker lifecycle versus durable state**. The row remains unmodified. Its reconciliation is a separately authorized production write, and direct account history for Instagram, Facebook, and GBP on 2026-08-11 should be checked for the Mini Cooper check-engine content first — public search was inconclusive and is not sufficient evidence.

The code that prevents a recurrence is merged but not deployed, so **this failure mode is still live in production today**.

## Material unresolved risks

1. No durable provider operation ledger, idempotency, or provider reconciliation. Timeout, crash, or retry can leave unknown or duplicate publication outcomes. Provider-level `withRetry` can still reissue a request after an ambiguous network outcome; PR #36 does not change that.
2. Worker interruption stranding is addressed by exclusive ownership plus startup recovery, **merged to `main` in PR #36 at `0828cc9…` but not deployed and not production-validated**. Until that release is live, any worker restart can still strand a `running` brief silently, and the deployment controller cannot detect it. Any manual worker restart before then needs a quiescent queue.
3. Production PostgreSQL external access was open to `0.0.0.0/0` at last verification.
4. Default-path Instagram tokens persist plaintext in `session_state`.
5. Approval uses a bearer URL and generic `human` label; control routes share one secret and process-local direct-socket rate limits.
6. No complete retention program, backup policy evidence, or restore drill; migration 005 intentionally blocks media deletion.
7. External provider ownership, scopes, review status, versions, quotas, billing, backup, and recovery details remain outside repository verification.
8. Checked-in facts lack the Phase 0B source/provenance/confidence/freshness/conflict contract.

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
