# Reconciliation release — preflight checklist for closing the M1→M2 interval

**Status: a checklist, not an authorization. Nothing in it has been performed.** It was written on 2026-10-28 by a session with read-only GitHub access and a local checkout only: no Render access, no production database credentials, no provider access. Every item marked **[operator]** is delegated to the owner (or a session that has the access) and is **UNVERIFIED** until someone records its result. Nothing here deploys, migrates, enables or approves anything, and no step may be run against an environment that has not been identified first ([`AGENTS.md`](../AGENTS.md)).

Read with: [Status — the M1→M2 interval](STATUS.md#m1m2-interval--owner-bound-and-monitoring-recorded-2026-09-18), [Production wiring design — M1 and M2](PRODUCTION_WIRING_DESIGN.md), [Deployment control](DEPLOYMENT.md), and the precedent this borrows its shape from, [the Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md) (its §3 preflight and §5 stop conditions).

Evidence labels: **REVIEWER-VERIFIED** — read by the writing session in GitHub through its API or in the repository. **LOCAL** — run in the writing session's container. **OWNER-OBSERVED** — reported by the owner (dashboard, Slack); not independently checked. **UNVERIFIED** — not established.

## 0. Why this document exists, and a terminology warning

The interval's bound, `2026-10-22T18:52Z`, passed six days before this was written. The interval record gives the owner three outcomes at that point — complete M2, re-authorize under a new bound, or take the recovery path — and **the repository records none of them**. `origin/main` was still `282fe54…` when this was written *(updated later the same day: PRs #135, #134 and #133 merged, to `516cf63…`; none of them records an interval decision)*, the daily `Interval monitor` runs #31–#37 (2026-10-21 to 2026-10-27) all concluded `success`, and the monitor is built never to fail on expiry ([`checks.mjs`](../scripts/ops/interval-monitor/checks.mjs): "expiry is a decision point"), so a green run says only that the API artifact, migration set, scheduler freshness and deployment gate still match — it does not say anyone decided. **REVIEWER-VERIFIED.**

**"M2" in this repository has two meanings that must not be conflated.** The design's M2 ([Production wiring design](PRODUCTION_WIRING_DESIGN.md), "M2 — Deploy the inert implementation") deploys P1–P7 and is **migration-bearing** (migration `008`). P1–P7 are not merged and no `008` exists on `main` (migrations `001`–`007` only), so **that M2 cannot be performed from any commit that exists.** What the owner and the sessions have been waiting on — returning the worker and scheduler to one commit with the API and ending the partial-release interval — is the design's *sentence* about M2 ("the controlled reconciliation step that returns all three services to one commit"), not its entry conditions. This document is the checklist for that **reconciliation release**, which is migration-free. Whether it is recorded as "M2", as a re-scoped M2, or under another name is Decision D2 below; it is not for a session to decide.

## 1. The state this checklist assumes — a snapshot, re-read it

| Fact | Value | Evidence |
|---|---|---|
| API `gcd-social-api` (`srv-d8u0qtpo3t8c73c5o44g`) | live at `A` = `d5015236672a02bf8f58d342625c32a4f5acc8a1`, deployed 2026-09-17 | recorded ([Status](STATUS.md)); the monitor checks `/healthz` for `A` daily and last passed 2026-10-27 |
| Worker `gcd-social-worker` (`srv-d8u0qtpo3t8c73c5o440`) and scheduler `gcd-social-scheduler` (`crn-d8ulb4rtqb8s73bdjctg`) | recorded at `R` = `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` since 2026-08-28 | **UNVERIFIED today** — the monitor does not cover either service's commit, and the interval record itself lists their exact deploy commits as "NOT OBSERVED, owed" |
| Migrations applied | exactly `001`–`007`, no `008` | the monitor's check, passing through 2026-10-27 |
| Native auto-deploy | Off on all three services | OWNER-ATTESTED (2026-10-02, 2026-10-10); not re-read |
| `RENDER_DEPLOY_AUTOMATION_ENABLED` | `false` | the monitor's check, passing through 2026-10-27 |
| `main` | `282fe54…` when written; **`516cf63…` after the same day's merges** — #135 (`zod` override, `56bab13…`), #134 (image incidental-text fix, `680468b…`) and #133 (posting cadence, `516cf63…`); none deployed | REVIEWER-VERIFIED 2026-10-28 |
| Posting | daily, with recurring image-QC escalations (Oct 13, 14, 19, 21 observed) | OWNER-OBSERVED (Slack) |
| `A` and `R` are both ancestors of `main`; `R` is an ancestor of `A` | yes | LOCAL (`git merge-base --is-ancestor`) |

## 2. Gate 0 — decisions only the owner can make

Nothing below may be inferred from this document. Record each answer, with the owner's own words, in [Status](STATUS.md) and [Roadmap](ROADMAP.md).

- [ ] **D1 — the interval.** The bound passed. Which outcome did the owner choose on or after 2026-10-22, and under what bound? If none was chosen, say so and choose now: **re-authorize under a new, dated bound with a reason** (the 2026-09-22 form), or proceed to this release. The record must stop saying "interval ends 2026-10-22T18:52Z" without a decision beside it.
- [ ] **D2 — what to call this and which design text governs it.** Recommended: record it as "the reconciliation release that closes the M1→M2 interval", **not** as the design's M2, and record that the design's M2 (P1–P7, migration `008`) remains `PLANNED` and unperformed. The design requires M2 to be preceded by P1–P7; it must not be quietly redefined.
- [ ] **D3 — the target commit.** See §3. Recommended: **`A` itself**, for the worker and the scheduler only, with **no API redeploy**.
- [ ] **D4 — whether the posting-cadence and image-text changes ride this release.** Recommended: **no.** They are not in `A`; they go in a second, ordinary release after the interval is closed (§3, §9).
- [ ] **D5 — the window.** See §5 P13. Name a day and an hour range in UTC, clear of the scheduler's window.
- [ ] **D6 — authorization lines, sent one at a time, at the time of each act, not before.** Suggested wording (the owner's own words govern):
  1. "Reconciliation release authorized: worker to `d501523…`" — then deploy the worker and verify.
  2. "Reconciliation release authorized: scheduler to `d501523…`" — only after step 1's verification is recorded.
  Authorizing one line authorizes only that line.

## 3. Choosing the target — the repository facts

| | `A` = `d501523…` (merge of PR #67) | `main` (`516cf63…`, with #133 and #134 merged) |
|---|---|---|
| Migrations | none beyond what is already applied (`001`–`007`; `007` came with `A`) | none beyond `007` |
| Carries the four plate/badge/QC fixes (`7697bf2`, `ebdcbb2`, `10543d8`, `83a5a7d`) | **yes — all four are ancestors of `A`** (LOCAL) | yes |
| Carries Sonnet 5 for the copywriter, image and SEO agents | **no** — still `claude-sonnet-4-6`; analytics, formatter and posting still the dated Haiku id (LOCAL) | yes (`claude-sonnet-5`; Haiku by alias) |
| Carries the image incidental-text fix (#134), the Mon/Wed/Fri cadence (#133) | **no** | **yes** — both merged 2026-10-28 |
| Live-loaded modules that differ from `R` | **10 changed, 2 new** (`registry`, `contentIntelligence`, `evidence/contract`, `evidence/pack`, `imageQc`, `orchestrator`, `packageMap`, `sdk`, `state`, `fal/models`; new `modelPolicy`, `payloadContract`) | 13 changed, 2 new (adds `approvedFacts`, and now `contentCalendar` and `daily` from #133; `orchestrator` and `fal/models` also carry #134) |
| Already running in production? | **Yes, as the API, since 2026-09-17** (the worker and scheduler entry points have not been run at `A`) | no |
| Needs a monitor change (`API_ARTIFACT_A`) | **no — the API is not redeployed** | only if the API is redeployed |
| Needs the owner to accept a model change | no | **yes** — and that Anthropic access to `claude-sonnet-5` works for the production key (UNVERIFIED) |
| On `main`, so the deployment controller can later build on it | yes (an ancestor) | yes |

**Recommendation: `A`, worker and scheduler only.** It is the smallest reconciliation that exists: it contains the fixes already asked for, it adds no model change, it is the artifact the API has served for six weeks, and it needs no edit to the monitor or the manifest. It also ends the `PARTIAL_RELEASE_STATE` that blocks the deployment controller, so everything after it — the cadence, the image-text fix, the Sonnet 5 migration — can then go out as ordinary releases, one decision at a time, instead of all arriving in a single reconciliation. **Caveat, not a reason to avoid it:** the worker and scheduler have never *run* at `A` in production, so §6's observation is what establishes it. Releasing `main` instead is the larger change and is not recommended as the closing step.

If the owner chooses `main` (D3), this checklist changes in four places: Gate 1 runs against that exact SHA with its CI run; the model change in the table above is acknowledged (D4); `scripts/ci/live-path-manifest.json`'s `LR12` pin and the Studio release checklist's manifest rule must be settled first (settled for the merged work: #134 merged first and #133 then re-hashed and re-pinned `LR12`; any later manifest edit re-pins it again); and the API question below (Gate 3) must be answered for the API as well.

## 4. Gate 1 — repository preconditions, checkable offline by any session

For the target commit `T` (the full 40-character SHA, written out, never `main`):

- [ ] **P1** `git rev-parse origin/main` and `T` recorded; `T` is an ancestor of `origin/main` (`git merge-base --is-ancestor T origin/main`).
- [ ] **P2** `git merge-base --is-ancestor <live worker commit> T` and the same for the scheduler — **ancestry, not equality, and not a rollback** (design §4.4.1). Stop if either live commit is a proper descendant of `T`, or the two are unrelated, or the live commit cannot be obtained.
- [ ] **P3** The complete migration-state check: `git diff --name-only <live API commit>..T -- 'state/migrations/**'` is **empty**, `state/migrations` holds exactly `001`–`007`, and the production `_migrations` holds exactly `001`–`007` (P10). A release carrying any new migration is **not this release** — stop.
- [ ] **P4** CI ran green on `T` itself: `CI_CONCLUSION: success`, `event: push`, `branch: main`, `head_sha: T`. For `A` the record is run `35235152957`, all five required jobs, 2026-09-17 (REVIEWER-VERIFIED from [Status](STATUS.md); re-check it).
- [ ] **P5** At `T` in a clean checkout: `npm ci`, `npm run build`, `npm run typecheck`, `npm run test:offline`, `npm run dryrun` (simulated). **For `A`, LOCAL 2026-10-28:** all pass — nine suites, 1,261 `PASS`-prefixed lines plus render-identity's 1 and ownership/recovery's 112 in summary form (1,374 by that method; the repository's own count at `A` was not re-derived), the simulated dry run `OK`.
- [ ] **P6** The environment is unchanged for the live services between the live commit and `T`: `git diff <live commit> T -- .env.example docs/ENVIRONMENT.md render.yaml`, and the live-service `process.env` references. **For `A`, LOCAL:** no live-service variable was added — the only `.env.example` additions since `R` are Studio-only (`STUDIO_*`); `render.yaml` is unchanged in the `R`→`A` range.
- [ ] **P7** `package-lock.json` differences between the live commit and `T` are understood. **`R`→`main`:** the lockfile adds `jose` (used by the Studio only; no live-loaded module may import it — guarded by the `jose` import check and `CS3`). Render rebuilds with `npm ci --include=dev && npm run build`, so a lockfile change is installed fresh (UNVERIFIED that the install succeeds on Render; CI's `npm ci` is the evidence).
- [ ] **P8** The live-loaded changes were read, not just counted. For `A`: the ten changed and two new modules in §3, and in particular `src/harness/sdk.ts` (+230 lines), `src/harness/packageMap.ts`, `src/harness/state.ts`, `src/harness/evidence/pack.ts`. The Content Intelligence stage modules are dormant (`executionEnabled: false`, reached by no production path — [Architecture](ARCHITECTURE.md)); confirm that against the exact `T`.
- [ ] **P9** `render.yaml` is byte-identical to the state the Blueprint `gcd-agents` last synced (no `render.yaml` edit rides this release; Auto Sync is Yes, so a merged change would sync outside this procedure).

## 5. Gate 2 — live read-only preflight **[operator]**

Re-verify **immediately before acting**, not "as recorded". Use a **read-only** database connection; no `INSERT`, `UPDATE` or `DELETE`, no migration, no `psql -f`, anywhere in this document. The queries are those of [the Phase 0B.0 runbook §3](ROLLOUT_PHASE_0B0.md#3-preflight--must-be-re-verified-immediately-before-executing); copy them from there.

- [ ] **P10** `_migrations` is exactly `001`–`007`, each once, and **no `008`**.
- [ ] **P11** Record the exact commit and deploy ID the API, the worker and the scheduler are each serving. **UNKNOWN until read; not inferred from `main`, `render.yaml` or this document** (the API's `/healthz` `commit` is the one public read; the worker's is its `ready` log line; the scheduler's is its latest deploy). The interval record's own open item: "the exact latest deploy commit of `gcd-social-worker` and `gcd-social-scheduler`" — close it here.
- [ ] **P12** `brief_queue`: **zero `pending`, zero `running`.** `approval_queue`: **zero live pending approvals** (`pending`, not revoked); none `approved` and unpublished. An unexpired approval holds a 24-hour TTL; do not rely on it expiring mid-release. Pending approvals created before the new worker has a marker are revoked by its startup sweep, which is a surprise to avoid ([Deployment control](DEPLOYMENT.md), the Phase 0B.0 preflight).
- [ ] **P13** **The window.** The scheduler fires at `13:00 UTC` (`0 13 * * *`; after #133 it still fires daily and decides in code). **Do not begin inside 12:45–13:30 UTC**, and finish well before 12:45 or start after 13:30. No manual "Trigger Run" is expected during the window. No scheduler run in flight.
- [ ] **P14** The worker holds ownership and reported ready at the live commit; no mid-publication work. No recent fatal API, worker, scheduler or database errors in the logs.
- [ ] **P15** Auto-deploy reads Off on all three services; `RENDER_DEPLOY_AUTOMATION_ENABLED` reads `false`; no deploy in progress on any of them.
- [ ] **P16** Live-service environment present: every variable [Environment](ENVIRONMENT.md) lists for each service is set (read the names, never print the values). Because the target adds no variable (P6), this is a presence check, not a change.
- [ ] **P17** Recent state of the posting itself, for the baseline §7 compares against: the last 14 days of Slack — how many briefs reached approval and how many escalated, and why. (Observed: Oct 13, 14, 19, 21 escalated; Oct 16–18 and 20 reached approval.)
- [ ] **P18** The interval monitor's most recent run is green on the day of the release, and its next scheduled run (14:00 UTC) is known — the release must not leave the monitor red.

## 6. Gate 3 — compatibility, to be answered before the first deploy

- [ ] **C1 — the API is not redeployed** (recommended, with `T = A`). Then worker and scheduler at `A` sit beside an API at `A`: **identical artifacts, the strongest compatibility there is.** If the owner picks a `T` other than `A`, this gate must instead answer: which API-loaded modules differ between `A` and `T` (for `main`, seven: `modelPolicy`, `payloadContract`, `registry`, `approvedFacts`, `pack`, `imageQc`, `sdk`), and is a worker at `T` safe beside an API at `A`, or must the API move too (an ordinary, migration-free API deploy that also forces a monitor edit)?
- [ ] **C2** The worker and scheduler at `T` against the database at `007`: `A` was built for `007`. The `R` worker and scheduler have run against `007` since 2026-09-17 (OWNER-OBSERVED: daily briefs and approvals continued), which is the **rollback** compatibility (§8), not the forward one. The forward one is established by P5 and by the first run (§7), not before.
- [ ] **C3** The scheduler entry point: at `A` it enqueues daily, exactly as at `R` (the cadence change is #133, not in `A`).
- [ ] **C4** Approvals created by the `A` worker are reviewed by the `A` API: same artifact. **UNVERIFIED in production** until the first approval is reviewed through the live approval page.

## 7. The sequence, when — and only when — each line is authorized

This is **not** the deployment controller's path: `RENDER_DEPLOY_AUTOMATION_ENABLED` is `false`, the controller refuses `PARTIAL_RELEASE_STATE`, and it must not be forced past ([Deployment control](DEPLOYMENT.md)). It is an explicitly authorized manual deployment, like M1 (Render dashboard, `trigger: "manual"`), and it carries every gate the controller would otherwise supply.

1. **Record the pre-deploy reading** of §5 P10–P15, with the date and time in UTC and who read it.
2. **Worker first.** In the Render dashboard, deploy the worker at exactly `T`'s full SHA (the commit must be the one in D3; the dashboard's commit picker offers commits on the service's linked branch, and `A` is on `main`). Wait for `live`.
3. **Verify the worker before touching the scheduler.** The `ready` marker carries exactly `[worker] ready {"service":"gcd-social-worker","commit":"<T>","instance":"<Render instance ID or null>","state":"postgres"}` ([Deployment control](DEPLOYMENT.md)); the worker holds exclusive ownership (expect the ~58-second ownership wait); zero fatal errors; no brief was claimed during the deploy. **Stop and take §8 on any failure.**
4. **Scheduler second.** Deploy the scheduler at `T`; Render `live` is the readiness signal (it is a cron job; the deploy does not run it). **Do not press "Trigger Run"** before the verification in step 5 is recorded.
5. **Re-read all three** services' commits and compare with step 1: the worker and scheduler now report `T`, the API still reports `A`. With `T = A`, all three agree — the partial-release interval is demonstrably closed.
6. **First-run observation.** The next scheduled run (or one owner-authorized manual trigger, in a window clear of the scheduler's, with someone watching Slack) should produce an approval message with an authoritative review link that opens, shows the canonical payload, and decides correctly (approve and deny are the owner's act, never a session's). Record: the brief ID; whether it reached approval or escalated, and the reason; the worker log's `[image]` lines (attempt counts, QC findings); the cost line. Then **compare the escalation rate over the next 14 days with P17's baseline** — this is the only thing that can show the plate fixes work in production, and the evidence is the rate, not one post.

Stop conditions, any one of which stops the release at its current step: a P-item fails or cannot be read; the live commit is not an ancestor of `T`; a migration appears in the diff; a pending approval or a running brief exists; the window is wrong; the worker does not report ready at `T` within the Render health window, or ownership is not acquired; any service reports a commit it should not; the authoritative review link does not open at the first approval. Application deploy failures are **not retried blindly** — diagnose first.

## 8. Rollback, decided before starting

- **Application rollback is a redeploy of the prior artifact**, as a separate, explicitly authorized act: the worker and the scheduler back to `R` = `44d7336…`, individually. There is **no database rollback** — this release applies no migration, and `007` stays applied exactly as it has been since 2026-09-17. `R` ran against `007` throughout the interval (OWNER-OBSERVED), which is why this rollback is the compatible one. The rollback leaves the same open question this release set out to close — the plate escalations — and returns the partial-release state.
- **Triggers:** the worker never reports ready at `T`; ownership cannot be acquired; a brief at `T` fails for a non-image reason that `R` did not; an approval at `T` cannot be reviewed; the approval page's payload hash check fails.
- **Not a trigger:** an image escalation. They already occur at `R` (§1) and are the symptom under study; one escalation is data, not a rollback.
- **The recovery path of the interval record** (redeploy the **API** to `R`, leaving `007` applied) is a different act and is not part of this release.

## 9. After the release — what must change in the same stretch of work

Per the binding documentation rule ([`AGENTS.md`](../AGENTS.md)); none of this is done by this document.

- [ ] [Roadmap](ROADMAP.md) completed-phase record (fields required by `AGENTS.md`), recorded with the `DEPLOYED` state only when the release is live and `PRODUCTION-VALIDATED` only after §7 step 6's observation. [Status](STATUS.md) service table rows for the worker and the scheduler. [Deployment control](DEPLOYMENT.md)'s "current status" and "current cutover status" tables, which still say worker and scheduler "remain at `R`". The root [README](../README.md) handoff.
- [ ] **The interval record**: closed, with the date, who, the evidence, and what happened to the bound. The monitor's interval constants (`INTERVAL_EXPIRY`, `SCHEDULER_MAX_AGE_HOURS`, `API_ARTIFACT_A`) and its suite change only if the monitor is retired or re-scoped — decide, and record, which. With the API unredeployed, `API_ARTIFACT_A` stays correct.
- [ ] **The cursor.** The next releases, in the order the owner chooses, each its own decision and each now eligible for the deployment controller *only if* its separate cutover (Deployment control steps 8–10) has been authorized — otherwise manual again: (1) the image incidental-text fix and the posting cadence — **both now `MERGED` on `main` (2026-10-28), not in `A`**, so they reach production only with a release of `main` (or a later one after the reconciliation); (2) the Sonnet 5 migration, with its model-access check; (3) the design's M2 proper, when and if P1–P7 exist.

## 10. What is unknown or unresolved

- The interval decision after 2026-10-22 (D1). The worker's and the scheduler's actual commits today (P11). Whether Render's dashboard offers `A` for the worker and scheduler as a specific-commit deploy (expected, `A` being on `main`; UNVERIFIED). Whether the worker and scheduler run cleanly at `A` in production (never observed). Whether the plate fixes work in production (never observed — the four fixes have not run in the worker). Whether `claude-sonnet-5` is available to the production key (only matters for `main`). Whether the first approval at `T` reviews correctly (C4).
- This document did not read any Render dashboard, deploy history or log, any database, `/healthz`, or Slack. Its facts about those are the records it cites.
