# Migration-bearing rollout runbook — Phase 0B.0

**Target commit — the only commit this runbook authorizes anything about:**

```
44d7336f2c75ff880cff0d8205d2fafe13eb91b5
```

**Status: PARTIALLY EXECUTED — STOPPED AT STEP 6 UNDER S8/S18, THEN PAUSED.** The API is deployed and migration 006 is applied. The worker and scheduler are **not** deployed and remain on `a6a4316…`. See [§0 — rollout checkpoint](#0-rollout-checkpoint--operator-verified-2026-08-28) for exactly what was observed and what is required to resume. Every remaining step requires fresh explicit authorization, and this document grants none.

This is the repository's **first migration-bearing release**. `state/migrations/006_content_evidence.sql` was applied to production on 2026-08-28 by the API pre-deploy runner; the ordinary GitHub controller path is forbidden for this release by design — it stops such a release at `CONTROLLED MIGRATION ROLLOUT REQUIRED`. See [Deployment control](DEPLOYMENT.md).

---

## 0. Rollout checkpoint — operator-verified 2026-08-28

**Attribution.** Everything in this section was **verified by the operator on 2026-08-28** and is recorded as reported. The engineering session that wrote and corrected this runbook has no Render access, no production database credentials, and its egress policy denies both `gcd-social-api.onrender.com` and `api.render.com` (403 at CONNECT). **None of it was independently verified here.** Reconfirm read-only before relying on it to resume.

### Observed

| Item | Observation |
|---|---|
| API | **Live and healthy** at `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` |
| Migration 006 | **Applied exactly once**, at **`2026-08-28T15:24:18Z`** |
| Migration duration | approximately **53 ms** — consistent with the 49 ms measured on disposable PostgreSQL 16 |
| `content_evidence` / `content_evidence_relations` | **Empty**, as required; nothing populates them at deploy time |
| Object inventory | **Matched the migration**, except for this runbook's incorrect index count |
| Active briefs and approvals | **Zero** |
| Worker | **Not deployed** — remains at `a6a4316c20f7dfc45921683b59fc042ad7266087` |
| Scheduler | **Not deployed** — remains at `a6a4316c20f7dfc45921683b59fc042ad7266087` |
| Provider / publication activity | **None** during the rollout |

### Why it stopped

The rollout halted at **step 6** under **S8** (object inventory does not match §2) and **S18** (any result is ambiguous rather than clearly pass or fail).

**The stop was correct, and the defect was in this document, not in the database.** §2 claimed 9 indexes. The catalog reports **10** — the ninth and tenth being the two primary-key-backed indexes, which are separate catalog objects from the two primary-key constraints. The original per-category list also failed to sum: `2 + 9 + 16 + 3 + 2 + 1 = 33`, against a stated total of 34. The total was right because it came from a live catalog query; the category breakdown was miscounted by hand.

So the migration applied exactly as designed and the schema is correct. An operator following the runbook literally could not distinguish "the document is wrong" from "the migration produced the wrong schema", and stopping rather than proceeding on an unexplained discrepancy is precisely the behaviour S8 and S18 exist to produce. §2 is now corrected against a re-derived catalog query.

### Current state — a proven-compatible safe pause

Production now runs a **mixed version**: new API at `44d7336…`, old worker and scheduler at `a6a4316…`, against a database with migrations `001–006`.

**This is one of the configurations proven safe in §2, and it can be held indefinitely.** The compatibility matrix covers it directly: the worker and scheduler import no Phase 0B.0 code and never touch `content_evidence`, and old `a6a4316…` code was built and run against a runner-migrated `001–006` database with its durable startup probe, console snapshot, and event read all succeeding. There is no time pressure to resume, and no need to roll anything back to sit here safely.

### Resuming requires all four

1. **Independent inspection of this corrective documentation delta** — the §2 inventory correction and this checkpoint.
2. **A fresh read-only preflight** — §3, re-run in full. The earlier results are stale, and the `0 13 * * *` scheduler has fired since.
3. **Fresh explicit authorization** — the authorization for the stopped rollout does not carry forward.
4. **Resumption begins at step 8, the worker deployment.** Steps 4–7 are complete.

> **Migration 006 must not be rerun manually.** It is already applied and recorded in `_migrations`. The runner skips a recorded file, so a re-run is a no-op — but running it by hand outside a transaction would also silently disable its `SET LOCAL` timeout guards (§2). There is no circumstance in this resumption where migration 006 should be applied again by any means.

Step 6's verification should be repeated once against the corrected §2 inventory before continuing, to close the check that was stopped rather than to re-apply anything.

---

## 1. What is being released

`a6a4316…` → `44d7336…` is three commits:

| Commit | Change | Runtime effect |
|---|---|---|
| `5a27c73` | Phase 0B.0 evidence contract, agent registry, inert preview, migration 006 | Adds two tables and one authenticated read-only route |
| `45f1365` | Documentation | None |
| `4891bf3` | `/console/*` gate now drains/closes an unread body on auth or rate-limit failure | Fixes an HTTP request-desync exposure |

`4891bf3` deserves explicit attention because it is a **security fix to a live route family**, not part of the Phase 0B.0 feature. It was authored by an independent inspection session, and it was verified here rather than taken on trust:

- `protectControlPlane(req, res, limiter, closeUnreadBodyOnFailure = false)` — the flag defaults to off.
- Line 427 (`/console/*`) now passes `true`, matching line 514 (`/triggers`), which already did.
- Lines 390 and 406 (`/diag/*`) remain `false`; those routes are GET-only and carry no body.

Before this fix, an unauthenticated or rate-limited `POST /console/content-intelligence/preview` left its declared-but-unsent `Content-Length` body unread on a keep-alive connection, so a pipelined follow-up request could be consumed as the remainder of the first. The `/console/*` gate is shared with `/console/state` and `/console/stream`, both live today, so **this rollout closes an exposure that exists in production right now**. That is an argument for the release, not against it.

## 2. Migration 006 — independently inspected

Everything below was measured in this session against disposable PostgreSQL 16, not quoted from the pull request.

### Exact objects created

Confirmed by catalog query after applying `001–005` and then `006` alone — **34 objects, all new, none pre-existing**:

| Kind | Count | Names |
|---|---|---|
| Table | 2 | `content_evidence`, `content_evidence_relations` |
| Primary-key constraint | 2 | `content_evidence_pkey`, `content_evidence_relations_pkey` |
| Index | **10** | the 2 primary-key-backed indexes `content_evidence_pkey` and `content_evidence_relations_pkey`, plus the 8 explicitly created indexes: `content_evidence_kind_lifecycle_idx`, `content_evidence_subject_idx`, `content_evidence_subject_attribute_idx`, `content_evidence_active_idx`, `content_evidence_review_by_idx`, `content_evidence_tags_idx` (GIN), `content_evidence_relations_to_idx`, `content_evidence_relations_kind_idx` |
| CHECK | 16 | `kind_check`, `lifecycle_check`, `source_type_check`, `claim_present`, `subject_present`, `confidence_range`, `verified_requires_source`, `research_requires_source`, `observation_requires_observed_at`, `performance_shape`, `causal_not_certain`, `assumption_low_confidence`, `supersession_shape`, `no_self_supersede`, `relations_kind_check`, `relations_no_self` |
| Foreign key | 3 | `content_evidence_superseded_by_id_fkey` (self), `content_evidence_relations_from_id_fkey`, `content_evidence_relations_to_id_fkey` |
| Trigger | 1 | `content_evidence_touch_updated_at_trigger` on `content_evidence` |
| **Total** | **34** | 2 + 10 + 16 + 3 + 2 + 1 |

**Why the two primary keys are counted twice — once as constraints, once as indexes.** In PostgreSQL a primary key is *two* catalog objects, not one: a constraint row in `pg_constraint` (`contype='p'`) and the unique index that enforces it in `pg_class`/`pg_indexes`. They have the same name but are distinct entries, and the verification query in step 6 unions `pg_indexes` and `pg_constraint` separately, so each primary key legitimately contributes one row to the index category **and** one to the primary-key-constraint category. That is intentional and is why the categories sum to 34 rather than 32. A reviewer expecting 8 indexes is counting only the `CREATE INDEX` statements in the migration file; the catalog reports 10.

**It is purely additive.** It issues no `ALTER TABLE`, no `UPDATE`, and no `DELETE` against any existing table. Every foreign key points at a table the migration itself creates, so no existing table is referenced.

### Transaction and locking behaviour

The repository runner (`src/state/migrate.ts`) applies each file inside `BEGIN … COMMIT` on one dedicated client and records it in `_migrations`. Migration 006 opens with `SET LOCAL lock_timeout = '10s'` and `SET LOCAL statement_timeout = '5min'`.

**Measured:** with `006` applied inside an open transaction, a `pg_locks` join against `approval_queue`, `approval_decisions`, `media`, `brief_queue`, `events`, and `session_state` returned **zero rows**. Migration 006 takes no lock of any kind on any pre-existing table, so it cannot block or be blocked by a running worker, scheduler, or API.

**Measured duration:** **49 ms** standalone on an otherwise idle disposable database; the full `001–006` fresh run reported 156 ms. Production is small and the tables are created empty, so a run measured in seconds — not minutes — is the expectation. **Anything approaching the 10-second lock timeout is abnormal and is a stop condition**, not something to retry.

> **Caveat found while testing.** `SET LOCAL` only takes effect inside a transaction. Applied by hand through `psql -f` without an explicit `BEGIN`, PostgreSQL emits `WARNING: SET LOCAL can only be used in transaction blocks` and **both timeout guards are silently inactive**. Migration 006 must therefore be applied by `npm run migrate` — never pasted into a `psql` session — or it runs without the protections it appears to carry.

### Compatibility matrix

| Scenario | Verdict | Basis |
|---|---|---|
| Old `a6a4316…` services against a database with 006 applied | **Compatible — proven** | See below |
| New `44d7336…` services against a database with 006 applied | Compatible | Fresh and upgrade integration paths, 154 assertions |
| New services against a database *without* 006 | API starts, but `POST /console/content-intelligence/preview` fails | The route is the only reader; startup does not probe for it |
| Mixed version during rollout (new API, old worker/scheduler) | **Compatible** | Worker and scheduler import no Phase 0B.0 code and never touch `content_evidence` |

**The old-code claim was tested, not reasoned about.** `a6a4316…` was checked out into a worktree, built, and pointed at a database migrated `001–006` by the real runner. Its durable startup probe passed (`stateEnabled=true`), `consoleSnapshot()` returned the queue correctly, and `recentEvents()` succeeded.

The reason it works is structural, and worth stating because it is what makes rollback safe: the Phase-0A startup probe in `src/harness/state.ts` is **existence-scoped, not exhaustive**. It counts exactly four triggers restricted by `tgrelid` to `approval_queue`, `approval_decisions`, and `media`, and exactly two CHECK constraints restricted by `conrelid` to `approval_queue`. It never reads `_migrations` and never asserts that no additional objects exist. Migration 006's trigger is on `content_evidence` and its constraints are on the two new tables, so none of them enters either count.

### Rollback posture

**Rolling application code back to `a6a4316…` while leaving migration 006 applied is safe, and is the preferred recovery.** Additive schema that no old code path references is inert to that code.

**Do not write a destructive down-migration.** Dropping `content_evidence` would not restore anything — the old code never used it — so it converts a safe no-op into an irreversible data-destroying operation whose only effect is to delete any evidence rows an operator had since imported. The repository is forward-only by design and has no down-migration mechanism. If the tables must eventually go, that is a reviewed forward migration under its own authorization, never an incident response.

### Fresh and upgrade evidence at the target commit

Re-run in this session against `44d7336…`:

| Check | Result |
|---|---|
| `npm run typecheck` / `npm run build` | pass |
| `npm run test:offline` | 362 checks, 0 failures |
| `npm run test:postgres` (disposable PG16) | **154 checks** — fresh 32, upgrade 53, durable 69 |
| `npm run test:http-e2e` (disposable PG16) | **68 assertions**, 0 failures |

Fresh path applies `001–006`; upgrade path applies `001–004`, seeds legacy rows, then `005–006`. PostgreSQL 18 was covered by CI on this exact head, verified from the job log rather than the summary API.

---

## 3. Preflight — must be re-verified immediately before executing

Steps marked **[operator]** could **not** be verified in the session that wrote this runbook: it has no Render access, no production database credentials, and its egress policy denies `gcd-social-api.onrender.com:443` (403 at CONNECT). They are not optional; they are delegated.

| # | Check | Expected | Status here |
|---|---|---|---|
| P1 | `git rev-parse origin/main` | `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` | ✅ verified |
| P2 | PR #40 merged | merged 2026-08-27T21:35:27Z by `Caposhi` | ✅ verified |
| P3 | PR #39 still open and unmerged | open, draft, `mergeable_state: dirty` | ✅ verified |
| P4 | `RENDER_DEPLOY_AUTOMATION_ENABLED` | `false` | ✅ verified — deploy run `33118928702` echoed `AUTOMATION_ENABLED: false` and failed closed |
| P5 | No deployment triggered for the target | gate job failed, release job skipped | ✅ verified |
| P6 | CI green on the target | `CI_CONCLUSION: success`, `event: push`, `branch: main` | ✅ verified |
| P7 | Render native auto-deploy OFF on all three services | off | **[operator]** |
| P8 | All three services live at `a6a4316…` | equal | **[operator]** |
| P9 | `/healthz` reports `a6a4316…`, `service: gcd-social-api`, `state: postgres` | equal | **[operator]** |
| P10 | `_migrations` contains `001–005` only | 5 rows, no `006` | **[operator]** |
| P11 | Brief queue: zero `pending`, zero `running` | zero | **[operator]** |
| P12 | Zero pending approvals | zero | **[operator]** |
| P13 | No scheduler run in flight; clear of the 13:00 UTC window | clear | **[operator]** |
| P14 | Worker holds ownership and is ready at `a6a4316…` | healthy | **[operator]** |
| P15 | No recent fatal API / worker / scheduler / database errors | none | **[operator]** |

### Timing constraint — read before choosing a window

The scheduler is `0 13 * * *` (`render.yaml`). **Do not begin inside 12:45–13:30 UTC.** A brief enqueued mid-rollout creates exactly the "unexplained `running` row during a deployment" ambiguity the ownership design exists to remove. Choose a window that ends well before 12:45 UTC or begins after 13:30 UTC.

### Read-only preflight queries

Run against production with a **read-only** connection. No `INSERT`, `UPDATE`, or `DELETE` is authorized anywhere in this runbook.

```sql
-- P10: exact migration inventory. Expect 001..005, and NO 006.
SELECT name, applied_at FROM _migrations ORDER BY name;

-- P10b: confirm the evidence tables do not exist yet. Expect 0.
SELECT count(*)::int FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relkind = 'r' AND relname LIKE 'content_evidence%';

-- P11: brief queue totals, and every non-terminal row in full.
SELECT status, count(*)::int FROM brief_queue GROUP BY status ORDER BY status;
SELECT id, status, created_at, claimed_at, goal
FROM brief_queue WHERE status IN ('pending','running') ORDER BY created_at;

-- P12: approvals that could still authorize a publication. Expect 0.
SELECT count(*)::int AS live_pending FROM approval_queue
WHERE status = 'pending' AND revoked_at IS NULL;
SELECT status, count(*)::int FROM approval_queue GROUP BY status ORDER BY status;

-- P13/P15: recent activity, including any scheduler enqueue.
SELECT id, kind, run_id, created_at FROM events
ORDER BY created_at DESC LIMIT 40;

-- P13: did the 13:00 UTC window already fire today?
SELECT id, status, created_at, goal FROM brief_queue
WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
ORDER BY created_at;
```

```bash
# P9: exact deployed identity. Public endpoint, no credentials.
curl -sS --max-time 10 https://gcd-social-api.onrender.com/healthz
# Expect: {"status":"ok","service":"gcd-social-api","state":"postgres","commit":"a6a4316..."}
```

---

## 4. Rollout sequence

Every step is operator-executed and separately authorized. **Stop at the first deviation** — do not improvise, do not retry a failed step, and do not proceed past an ambiguous result.

**1. Freeze and quiet window.** Announce the freeze. Confirm no one will merge to `main` and that PR #39 will not be merged during the rollout. Confirm the window respects §3's timing constraint.

**2. Confirm target and automation controls.** Re-run P1–P8. `origin/main` must still equal the target exactly; `RENDER_DEPLOY_AUTOMATION_ENABLED` must still be `false`; native auto-deploy must still be off on all three services. **Both authorities stay off for the entire rollout** — this is a manual release, and enabling either mid-flight would create the dual-authority condition Phase 0D exists to prevent.

**3. Confirm no conflicting work.** Re-run P11–P15. Zero pending briefs, zero running briefs, zero live pending approvals, no worker mid-publication, no scheduler run in flight. **Do not alter any row to satisfy this check** — a non-zero result is a stop condition to be investigated and separately resolved, not tidied away.

**4. Deploy the API at the exact target. — ✅ COMPLETE 2026-08-28 (operator-verified).** Deploy `gcd-social-api` at `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` and nothing else. Do not touch the worker or scheduler yet.

**5. Let the API pre-deploy command be the only migration authority. — ✅ COMPLETE 2026-08-28: applied exactly once at `2026-08-28T15:24:18Z`, ~53 ms. Do NOT rerun.** `preDeployCommand: npm run migrate` runs migration 006 exactly once. Neither the worker nor the scheduler has a `preDeployCommand`, so deploying the API alone guarantees a single migration runner — the specific failure of the Phase 0A rollout, where the worker started before the API's migration finished. **Do not run `npm run migrate` by hand, and do not apply the SQL through `psql`** (see the `SET LOCAL` caveat in §2).

Expected log, exactly once:

```
[migrate] skip 001_init.sql (already applied)
… 002 … 003 … 004 … 005 …
[migrate] applied 006_content_evidence.sql
[migrate] done
```

**6. Verify migration 006 applied exactly once, with every expected object. — ⚠️ STOPPED HERE under S8/S18 on the runbook's incorrect index count; repeat once against the corrected §2 inventory.**

```sql
-- Exactly one 006 row.
SELECT name, applied_at FROM _migrations WHERE name = '006_content_evidence.sql';
SELECT count(*)::int AS should_be_1 FROM _migrations WHERE name = '006_content_evidence.sql';

-- Full object inventory. Expect 34 rows, matching the table in §2.
SELECT 'TABLE' AS obj, relname AS name FROM pg_class
  WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname LIKE 'content_evidence%'
UNION ALL SELECT 'INDEX', indexname FROM pg_indexes
  WHERE schemaname='public' AND tablename LIKE 'content_evidence%'
UNION ALL SELECT 'CHECK', conname FROM pg_constraint
  WHERE conrelid::regclass::text LIKE 'content_evidence%' AND contype='c'
UNION ALL SELECT 'FK', conname FROM pg_constraint
  WHERE conrelid::regclass::text LIKE 'content_evidence%' AND contype='f'
UNION ALL SELECT 'PK', conname FROM pg_constraint
  WHERE conrelid::regclass::text LIKE 'content_evidence%' AND contype='p'
UNION ALL SELECT 'TRIGGER', tgname FROM pg_trigger
  WHERE tgrelid::regclass::text LIKE 'content_evidence%' AND NOT tgisinternal
ORDER BY 1, 2;

-- Expected category counts, matching the table in §2:
--   2 tables, 10 indexes (including the 2 primary-key-backed indexes),
--   16 CHECK constraints, 3 foreign keys, 2 primary-key constraints,
--   1 trigger  ->  total catalog inventory 34.
-- The 2 primary keys each appear twice on purpose: once in pg_indexes and
-- once in pg_constraint. They are separate catalog objects (see §2).
-- The evidence tables must be EMPTY. Nothing populates them at deploy time.
SELECT (SELECT count(*)::int FROM content_evidence)            AS evidence_rows,
       (SELECT count(*)::int FROM content_evidence_relations)  AS relation_rows;
-- Expect 0 and 0. A non-zero count means something wrote evidence during a
-- deploy, which the design forbids — stop.

-- Pre-existing integrity is untouched: 4 triggers, 2 constraints, as before.
SELECT count(*)::int AS should_be_4 FROM pg_trigger
WHERE NOT tgisinternal AND tgenabled IN ('O','A')
  AND ((tgrelid='approval_decisions'::regclass AND tgname IN ('approval_decision_no_update','approval_decision_no_delete'))
    OR (tgrelid='approval_queue'::regclass AND tgname='approval_subject_immutable')
    OR (tgrelid='media'::regclass AND tgname='media_content_immutable'));
```

**7. Verify API health, identity, and database health. — ✅ COMPLETE 2026-08-28: API live and healthy at the exact target.**

```bash
curl -sS --max-time 10 https://gcd-social-api.onrender.com/healthz
# Expect commit == 44d7336f2c75ff880cff0d8205d2fafe13eb91b5, state == "postgres".
```

Confirm the Render deploy record reports the exact target, review API logs for startup errors, and confirm no abnormal database locks or connection errors. **At this point the old worker and scheduler are still running `a6a4316…` against a database with 006 applied — a state proven compatible in §2.** There is no time pressure to continue; it is safe to pause here.

**8. Deploy the worker at the same exact target. — ⬅️ RESUME HERE, under fresh authorization.** `gcd-social-worker` at `44d7336…`. No other change.

**9. Verify ownership, recovery, and readiness before proceeding.** Render worker deploys are zero-downtime, so **expect the new instance to wait roughly 60 seconds** for the old instance's session to end before it acquires the advisory lock. That wait is the design working, not a hang. Require, in order: exclusive ownership acquired → interrupted-work reconciliation completed → readiness emitted at exactly `44d7336…`. Then observe at least 10 seconds of stable logs with no fatal, crash, or restart signal. Confirm the worker did not contact any provider during recovery.

**10. Deploy the scheduler at the same exact target.** `gcd-social-scheduler` at `44d7336…`. **Do not manually execute the cron job as a smoke test.** A cron deploy does not run the job; the next scheduled firing is the proof, and it can wait.

**11. Verify the exact SHA across all three services.** API, worker, and scheduler must each report `44d7336f2c75ff880cff0d8205d2fafe13eb91b5`. Any divergence is a stop condition.

**12. Exercise only the inert Content Intelligence preview.**

```bash
curl -sS --max-time 15 -X POST \
  -H "Authorization: Bearer $CONSOLE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"goal":"post-rollout inert preview verification"}' \
  https://gcd-social-api.onrender.com/console/content-intelligence/preview
```

Supply `CONSOLE_TOKEN` from the environment. **Never place it in a URL**, and never paste it into a shared log or ticket. This is the only new route exercised, and it is the only functional check of Phase 0B.0 in this rollout.

Expect a six-stage plan with execution disabled and an evidence summary whose classes are all empty — `content_evidence` is empty until an operator separately runs `evidence:sync`, which **is not part of this rollout**.

**13. Prove the preview changed nothing.** Capture counts before and after step 12 and require them equal:

```sql
SELECT (SELECT count(*)::int FROM brief_queue)                  AS briefs,
       (SELECT count(*)::int FROM approval_queue)               AS approvals,
       (SELECT count(*)::int FROM content_evidence)             AS evidence,
       (SELECT count(*)::int FROM content_evidence_relations)   AS relations,
       (SELECT count(*)::int FROM media)                        AS media;
```

Call the preview twice with the same goal and require byte-identical stage plans, ignoring any timestamp field. Confirm the response contains no `Bearer`, no `hooks.slack.com`, and no provider key material. Confirm worker logs show no provider call and no model call in the interval, and that no new `brief:*` or `approval:*` event was written.

**14. Final state checks.** Re-run the §3 read-only queries. Require: `_migrations` = `001–006`; brief queue unchanged from step 3; zero live pending approvals; evidence tables empty; no new errors in API, worker, scheduler, or database logs; all three services still at the target. Record the completion time, the exact SHA, and the operator.

**Nothing in this rollout creates a brief, approves anything, or publishes anything.** No live social-post approval or publication is part of it.

---

## 5. Stop conditions

Stop immediately, take no corrective action beyond halting, and escalate. Each of these is a stop, not a retry.

| # | Condition |
|---|---|
| S1 | `origin/main` ≠ `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` at any check |
| S2 | `main` moves after preflight begins |
| S3 | PR #39 becomes merged at any point |
| S4 | `RENDER_DEPLOY_AUTOMATION_ENABLED` is anything but `false`, or a deploy workflow run appears |
| S5 | Render native auto-deploy is found ON, or turns on, for any service |
| S6 | A deployment not initiated by this runbook appears on any service |
| S7 | `_migrations` shows `006` before step 5, more than one `006` row, or any unexpected migration |
| S8 | The object inventory in step 6 does not match §2 exactly |
| S9 | Migration error, rollback, lock timeout, statement timeout, or a run approaching 10 seconds |
| S10 | Evidence tables are non-empty at any point in this rollout |
| S11 | `/healthz` reports the wrong commit, wrong service, `state` ≠ `postgres`, or fails to respond within bounds |
| S12 | Worker fails to acquire ownership, emits readiness at the wrong SHA, or logs a fatal/crash/restart during stabilization |
| S13 | Any brief transitions to `running`, or any approval appears, during the rollout |
| S14 | Any evidence of provider mutation — an outbound Instagram, Facebook, GBP, Anthropic, or fal call |
| S15 | The scheduler fires, or a brief is enqueued, during the protected window |
| S16 | Any step appears to require manual SQL, a manual migration run, or a schema change not in this runbook |
| S17 | The four Phase-0A integrity triggers or two approval constraints no longer verify |
| S18 | Any result is ambiguous rather than clearly pass or fail |

**S16 deserves emphasis.** If the rollout appears to need hand-written SQL, that means reality has diverged from this plan. The correct response is to stop and re-plan under new authorization — never to improvise a production write.

---

## 6. Rollback matrix

Forward-safe recovery is preferred everywhere. **Migration 006 stays applied in every row below** — it is additive, no old code path references it, and its removal is destructive without being useful (§2).

| Failure point | Database state | Action | Keep 006? |
|---|---|---|---|
| **Before migration** — preflight or step 4 fails before pre-deploy runs | `001–005` | Nothing deployed. Abandon the window; no rollback needed. | N/A |
| **During migration** — pre-deploy fails | `001–005` — the runner wraps each file in one transaction, so a failure rolls that file back **atomically**; a partially applied 006 is not a reachable state | Do not retry blindly. Capture the exact error, confirm `006` is absent from `_migrations` and the tables do not exist, then diagnose. The API deploy will have failed; the old API remains live. | N/A — never applied |
| **After API deployment** — 006 applied, new API unhealthy | `001–006` | Roll the **API only** back to `a6a4316…`. Worker and scheduler were never touched. Old API against 006 is proven compatible. | **Yes** |
| **Current paused state** — API at target, 006 applied, worker/scheduler at `a6a4316…` | `001–006` | **No action required.** This mixed version is a proven-compatible resting state and may be held indefinitely (§0). Roll the API back only if it becomes unhealthy; do not roll back merely to leave the paused state. | **Yes** |
| **After worker deployment** — worker fails ownership, readiness, or stabilization | `001–006` | Roll the **worker** back to `a6a4316…`. Expect the ~60-second ownership handover again in the reverse direction. Leave the API at the target only if it is healthy; otherwise roll it back too. Do not resume or requeue any brief by hand. | **Yes** |
| **After scheduler deployment** — SHA mismatch or scheduler error | `001–006` | Roll the **scheduler** back to `a6a4316…`. It only enqueues; a mismatched scheduler is low-risk but must not be left divergent. | **Yes** |
| **Any point — evidence of provider mutation** | any | Stop everything. Do **not** roll back first: preserve state, logs, and provider IDs, and reconcile against the platforms before any further deployment. | **Yes** |

**Full-stack rollback** is API → worker → scheduler all returned to `a6a4316…` with 006 left applied. That is a proven-compatible resting state, and it is where an ambiguous incident should end up rather than in a partially-migrated or half-rolled-back configuration.

There is no down migration and none should be written as an incident response.

---

## 7. Operator authorization block

Reproduce and complete this before executing. It authorizes exactly one rollout of exactly one commit.

```
PHASE 0B.0 MIGRATION-BEARING ROLLOUT — AUTHORIZATION

Target commit : 44d7336f2c75ff880cff0d8205d2fafe13eb91b5
Services      : gcd-social-api, gcd-social-worker, gcd-social-scheduler
Migration     : 006_content_evidence.sql (additive; applied once, by the API
                pre-deploy command only)
Window        : ______________________  (UTC; must not overlap 12:45–13:30)
Authorized by : ______________________
Executed by   : ______________________
Date          : ______________________

I authorize, for this commit only:
  [ ] Manual Render deployment of the API at the exact target
  [ ] Application of migration 006 via the API pre-deploy command only
  [ ] Manual Render deployment of the worker at the exact target
  [ ] Manual Render deployment of the scheduler at the exact target
  [ ] Read-only production SQL from sections 3, 6-verify, and 13
  [ ] ONE authenticated call to the inert Content Intelligence preview

I explicitly do NOT authorize:
  [x] Enabling RENDER_DEPLOY_AUTOMATION_ENABLED
  [x] Enabling Render native auto-deploy on any service
  [x] Merging PR #39, or any merge to main during the rollout
  [x] Any production SQL that writes, updates, or deletes
  [x] Running npm run evidence:sync against production
  [x] Manually executing the scheduler cron
  [x] Creating a brief, approving anything, or publishing anything
  [x] Any provider call to Instagram, Facebook, GBP, Anthropic, or fal
  [x] Any down migration or DROP against content_evidence

Stop conditions S1–S18 are binding. On any stop condition I will halt and
escalate rather than improvise.
```

---

## 8. After a successful rollout

1. Update [Status](STATUS.md), [Roadmap](ROADMAP.md), [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), [Operations](OPERATIONS.md), and the README: Phase 0B.0 becomes `DEPLOYED`, and migration 006 becomes applied. Record what was **observed**, distinguishing it from what was reported.
2. The documentation pull request prepared alongside this runbook is written for the pre-rollout state and **must not be merged until the rollout completes**. Update it with verified results first, then merge.
3. A first production `evidence:sync` is a **separate** authorized operation. It is not part of this rollout, and until it runs the evidence tables are correctly empty.
4. Enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` remains its own separately authorized step and is unrelated to this release.
