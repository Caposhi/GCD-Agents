# Current status

**Verified:** 2026-08-24 21:32 UTC

**Evidence:** current source/Git history; read-only GitHub PR, workflow, environment, secret-name, variable, and branch-policy metadata; read-only Render workspace/service/deploy/log/metric/PostgreSQL metadata; and the public bounded API health endpoint. No secret value was retrieved.

## Current snapshot

| Item | Verified state |
|---|---|
| Repository `main` | `10098de73667797120da8c7dfa4da83f336ff6ba` |
| API | `srv-d8u0qtpo3t8c73c5o44g`, live at `10098de…`; exact service/PostgreSQL/commit health passed |
| Worker | `srv-d8u0qtpo3t8c73c5o440`, live at `10098de…`; exact target-bound PostgreSQL readiness observed |
| Scheduler | `crn-d8ulb4rtqb8s73bdjctg`, live artifact at `10098de…` |
| PostgreSQL | `dpg-d8u0qaho3t8c73c5nj40-a`, PostgreSQL 18, available; external allowlist `0.0.0.0/0` |
| Deploy activity | None in progress at verification time; no recent error/critical logs observed |
| Native Render auto-deploy | Off on all three services (`autoDeploy: no`, `autoDeployTrigger: off`) |
| GitHub production environment | Present; secret name `RENDER_API_KEY`, five expected non-secret variables, `main` restriction |
| GitHub automation gate | `RENDER_DEPLOY_AUTOMATION_ENABLED=false` |
| Deployment authority | **Safe zero-unattended-authority window** |

Production API pre-deploy logs for the current release showed migrations 001–005 already applied. No SQL was run during this verification. A normal scheduler run succeeded on 2026-08-24 before Phase 0D deployed; a normal execution of the current scheduler SHA remains unobserved.

## Phase state

- **Complete and deployed:** Phase 0A Integrity Hardening, PR #33, merge `30d06f95f32c46f9952bc63f0bc34a6040d40a09`.
- **Complete, merged, and deployed:** Phase 0D CI and Deployment Control Foundation, PR #34, merge `10098de73667797120da8c7dfa4da83f336ff6ba`.
- **Current:** Phase 0D.1 deployment-authority cutover/proof.
- **Not begun:** Phase 0B Content Intelligence runtime.

Phase 0D is **implemented** and its GitHub/Render identifiers are **configured**. It is not **enabled** and has not been **proven in production** as the deployment authority. These states are not interchangeable.

## Next exact checkpoint

Under separate explicit authorization: immediately reverify current `main`, all three live SHAs, all three native settings off, gate false, GitHub configuration, and no deployment/migration in flight; then set the GitHub gate to exactly `true`, prove the already-current/no-deploy route if possible, and prove one harmless migration-free release. Stop on any discrepancy. Never re-enable Render native auto-deploy while the GitHub gate is true.

## Verified production incident — worker lifecycle interruption

Brief `c5e53afe-2657-4e11-811d-53ce5e793245` was enqueued 2026-08-10 13:01:22Z, claimed at 13:01:29Z, and reached `brief:awaiting_approval` at 13:07:29Z. No later event exists and it is still `running`. Its approval `08ab5c07-4d36-4b66-810a-9856dae4ca5d` was approved by a human at 2026-08-11 12:39:01Z — inside the 24-hour wait — and later revoked by migration 005 on 2026-08-24 15:50:41Z as a legacy non-hash-bound row.

Root cause: the worker process was gone before the approval landed, so nothing was waiting. Publication is only reachable after `waitForApproval` returns `approved`, so no provider request occurred; the approval never left `approved` for `posted`/`failed`, and no publish event exists. The human approved a post that never published, and nothing alerted.

This is the second incident in the same family as the Phase 0A worker/migration-005 race: **worker lifecycle versus durable state**. The row remains unmodified; its reconciliation is a separately authorized production write, and direct account history for Instagram, Facebook, and GBP on 2026-08-11 should be checked for the Mini Cooper check-engine content first — public search was inconclusive and is not sufficient evidence.

## Material unresolved risks

1. No durable provider operation ledger/idempotency or provider reconciliation; timeout/crash/retry can leave unknown or duplicate publication outcomes.
2. Worker interruption stranding is addressed by exclusive ownership plus startup recovery — **implemented in PR, not yet live in production**. Until that release, any worker restart can still strand a `running` brief silently, and the deployment controller cannot detect it.
3. Production PostgreSQL external access is open to `0.0.0.0/0`.
4. Default-path Instagram tokens persist plaintext in `session_state`.
5. Approval uses a bearer URL and generic `human` label; control routes share one secret and process-local direct-socket rate limits.
6. No complete retention program, backup policy evidence, or restore drill; migration 005 intentionally blocks media deletion.
7. External provider ownership, scopes, review status, versions, quotas, billing, backup, and recovery details remain outside repository verification.
8. A current-SHA normal scheduler run is not yet observed.
9. Checked-in facts lack the Phase 0B source/provenance/confidence/freshness/conflict contract.

## Not implemented

- durable provider-operation state/reconciliation and exactly-once guarantees;
- brief leases and stale-work recovery;
- authenticated reviewer/control identities or operator revocation UI;
- encrypted provider-token persistence;
- runtime `AgentRegistry`, skill/reference injection, or research retrieval;
- the target six-stage Content Intelligence reasoning architecture;
- durable fact/evidence records, performance ingestion, active scorecard writes, hypothesis tracking, or governed improvement proposal generation;
- autonomy B/C behavior; every parsed phase still requires the Phase A approval gate; and
- browser-based video editing.

## CI and production observation

PR #34's exact reviewed head passed Node 22 offline quality gates, PostgreSQL 16 integration, PostgreSQL 18 integration, AgentShield 1.4.0, and workflow/YAML validation. After merge, the production workflow's authorization job failed closed because the gate was false, and the deploy job was skipped; this was the intended disabled-state behavior, not a controller release proof.

The current production release was then observed live on all three services through Render's previous native auto-deploy path. API pre-deploy completed with all migrations already recorded, API health returned the exact Phase 0D SHA, and the worker emitted the exact ready marker. This proves current application deployment/health, not GitHub controller authority. See [Testing](TESTING.md) for deterministic coverage and [Deployment control](DEPLOYMENT.md) for release semantics.

## Local workspace note

The tracked `.DS_Store` has a pre-existing local modification and is intentionally preserved and excluded from this documentation change. `.gitignore` already blocks future copies. Remove the tracked file only in a separate explicitly authorized cleanup.
