# M1 readiness — decision record

**Milestone:** M1, the api deployment that invokes the sanctioned `preDeployCommand`
migration runner and thereby applies `007_evidence_bounds.sql`.

**Purpose of this record:** to assemble, under the accepted
[production-wiring design](PRODUCTION_WIRING_DESIGN.md), the read-only evidence M1 requires, and to
state a verdict. It is **evidence assembly and repository documentation only**. It authorizes no
deployment, applies no migration, mutates no production state, and changes no Render configuration.

---

## Verdict

> # M1 BLOCKED / NO-GO

**M1 is not authorizable.** The blocking reason is singular and structural: **this session has no
read-only production access of any kind** — no Render credential or control-plane tool, no production
database connection, and no live api URL. Every fact that must be *read from running production*
is therefore `NOT YET EXECUTED`, and the design forbids inferring any of them.

Per §4.4.1: *"`L` is UNKNOWN until inspected. It may not be inferred from `main`, from `render.yaml`,
from any dated record in this repository, or from a previous milestone's record. **If `L` cannot be
obtained, M1 stops**."* That condition is met exactly.

**Nothing here establishes that migration 007 is applied, or that it is unapplied.** Its production
state remains **`UNKNOWN` in either direction**. The dated 2026-08-28 reading of `_migrations` at
`001–006` is retained as a dated observation and is **not** treated as current.

---

## What was established, without inference

| # | Fact | Status | Value |
|---|---|---|---|
| 1 | **Candidate artifact**, observed when this package was prepared — **not** an enduring `A` | **OBSERVED, HISTORICAL** | `2f76679afa78721ad9751ea7ce3124c5307b090c` |
| 6 | **`F(candidate)`** — migration files at that candidate | **OBSERVED, HISTORICAL** | `001`–`007`, seven files, **no later migration** |
| — | **`A`** — the artifact M1 would actually deploy | **NOT YET ESTABLISHED** | must be re-read at M1 time; see *The artifact is not pinned* below |
| — | `E_files`, `E_applied_pre`, `E_pending`, `E_applied_post` | **ESTABLISHED** | from §4.4.2's contract table (below) |
| — | Comparison **1** — `F(candidate) == E_files` | **PASS at the candidate only** | verified by `git ls-tree`; carries no forward authority — recompute at the new `A` |
| 2 | **`L`** — commit served by the live api | **NOT YET EXECUTED** | no read-only access to the running service |
| 3 | Commits served by api, worker, scheduler | **NOT YET EXECUTED** | same |
| 4 | **A/L ancestry decision** | **NOT DETERMINABLE** | undefined without `L`; **stop** per §4.4.1 |
| 5 | Same-commit `preDeployCommand` behaviour | **NOT ESTABLISHED** | requires authoritative Render behaviour; **M1 stops** if unproven and the `A == L` path is needed |
| 7 | **`D`** — production `_migrations` set | **NOT YET EXECUTED** | no read-only production database access |
| 8 | **`P = F(A) − D`** | **NOT COMPUTABLE** | depends on `D` |
| 9 | Comparisons **2–7** | **NOT YET EXECUTED** | all depend on `D` |
| 10 | §4.1 fresh aggregate-only audit | **NOT YET EXECUTED** against production | tooling delivered and proven — see below |
| 11 | **`R`** — rollback application artifact | **NOT DETERMINABLE** | `R` is normally the pre-M1 live api artifact, which is `L` |
| 12 | Executed compatibility evidence for `R` | **NOT EXECUTABLE** | cannot test an artifact that is not yet identified |
| 13 | Recovery plan if M1 fails | **NOT SAFE TO CALL SAFE** | see *Recovery* below |

### The four expected sets for M1 (§4.4.2)

| Symbol | Value |
|---|---|
| `E_files` | `001`, `002`, `003`, `004`, `005`, `006`, `007` — and **no later migration** |
| `E_applied_pre` | **exactly** the authorized baseline `001`–`006` |
| `E_pending` | **exactly** `{007_evidence_bounds.sql}` |
| `E_applied_post` | **exactly** `001`–`007` |

### The artifact is not pinned — `A` must be re-established at M1 time

**`2f76679afa78721ad9751ea7ce3124c5307b090c` is the candidate artifact observed while this package
was prepared. It is a historical observation, not an enduring `A`.**

**Merging PR #60 advances `main`**, because this package is itself a change to `main`. The moment it
merges, `main` is a new commit and `2f76679a…` is no longer the head of `main`. Per §4.4, *"the M1
artifact is the **reviewed head of `main` at M1 time**"* — so from that moment `2f76679a…` is
historical, and citing it as the artifact would be citing a superseded commit.

**`A` is therefore defined as: the exact reviewed head of `main` immediately before the eventual M1
authorization decision.** It is **`NOT YET ESTABLISHED`** and must be **re-established by full SHA at
M1 time**, never inherited from this record, from `main` as of any earlier date, or from a branch
name (which requirement **A1** rejects outright).

**Everything artifact-dependent must be recomputed against that newly established `A`:**

- `F(A)` — the migration filenames enumerated at the new `A`;
- the **A/L ancestry predicate** of §4.4.1, evaluated afresh with `A` and the immediately preceding
  live reading `L`;
- the **complete migration-state reading** of §4.4.2 — `D`, `P = F(A) − D`;
- **all seven comparisons** against the four expected sets;
- requirements **A1–A5** in full, including **A3** approval of the application code actually present
  at the new `A`.

**No result derived from `2f76679a…` may be reused merely because the migration file set appears
unchanged.** A matching file set is not evidence that the artifact is the same commit, that its
application code is unchanged, or that a reading taken against it is current. §4.4.1 is explicit that
*"a stale reading is not a reading"*, and that a result obtained earlier *"is never reused"*. The
comparison-1 pass recorded above is a fact **about the candidate**, and carries no forward authority.

**This does not change the verdict.** M1 remains **BLOCKED / NO-GO** for the reasons already stated;
re-establishing `A` is one of the prerequisites, not a route around them.

### Artifact requirements A1–A5 (§4.4)

| # | Requirement | Status |
|---|---|---|
| **A1** | Exact reviewed commit, named by full SHA, exact-head CI green | **NOT YET SATISFIED** — `A` is not yet established (see above). The candidate `2f76679a…` was named by full SHA and carried green CI, but it becomes historical once PR #60 merges. A branch name or tag is rejected outright. |
| **A2** | `state/migrations/` contains `001`–`007` and no later migration | **PASS at the candidate** — enumerated, not assumed; **re-enumerate at the new `A`** |
| **A3** | Application code separately approved as safe to deploy **and** safe to serve | **NOT GRANTED** — no such approval exists; this record does not grant it |
| **A4** | Complete §4.4.2 migration-state check passes against the target database | **NOT YET EXECUTED** — `D` unavailable |
| **A5** | A/L ancestry predicate satisfied | **NOT YET EXECUTED** — `L` unavailable ⇒ **stop** |

---

## Preflight discrepancy, recorded rather than smoothed over

The task authorizing this package expected the PR #57 merge commit's **ordered parents** to be the
base `53e2c2bb…` followed by the reviewed head `6afe6ce9…`. **They are not.** The actual ordered
parents of `2f76679a…` are:

| Position | SHA | What it is |
|---|---|---|
| parent[0] | `8cd14f92df3b2ffcfcf33ff6b2e526c4875983bd` | the merge of **PR #59** |
| parent[1] | `6afe6ce91914de0b2eb45d4257e10bb784f0d0b3` | the PR #57 reviewed head — **as expected** |

**Cause, verified:** **PR #59** ("Improve license plate handling in image generation") merged to
`main` at 2026-09-11T15:52:24Z, between PR #57's base and PR #57's merge. Its own merge commit
`8cd14f92…` has `53e2c2bb…` as *its* first parent, so the expected base is still an ancestor — it is
simply no longer the immediate first parent.

**Content of PR #59, enumerated:** 2 files, +12/−4 — `agents/image.md` and
`src/harness/orchestrator.ts`. It introduces **no migration**, **no executor enablement**, **no
production wiring**, and **no deployment configuration**. Checked at `origin/main`: migrations are
`001`–`007` with no `008` or later; all six registry `executionEnabled` values remain `false`;
`MIGRATION_ROLLOUT_REQUIRED` is intact; `.DS_Store` is unchanged.

**What PR #59's `orchestrator.ts` change does and does not imply for M1 — corrected after an
independent module-graph inspection.**

- The change is in `src/harness/orchestrator.ts`, inside `resolveImage`, which is the default image
  resolver used by `runBrief`. `runBrief` is imported by `src/worker/index.ts`, so the change is
  **reachable on the worker**.
- An independent inspection traversed the module graph from the **api entry point**
  (`dist/api/server.js`, the target of `npm run start:api`) and found the orchestrator **not present
  in the api module graph**.
- **Therefore PR #59's change is not presently shown to affect what the api-only M1 deployment
  serves.** M1 deploys the api alone; the worker and scheduler are unchanged by it.
- **PR #59 is accordingly NOT recorded as an independent M1 api blocker**, and must not be treated as
  one merely because it is present in the repository artifact. Presence in the artifact is not
  reachability on the service being deployed.
- **It must still be reviewed before the later worker deployment at M2**, where the code *is*
  reachable. That review is outstanding: PR #59 has **zero reviews**, and CI-green is its only
  evidence. No deployment-safety approval exists for it.
- **A3 is unchanged in force and is service-scoped**: every service deployment must be reviewed
  against the code actually reachable **on that service**, both before and after the migration.

**Stated limit of the module-graph check:** it followed static relative `from "./…"` imports from the
api entry point only. It does **not** establish anything about dynamic `import()`, runtime
require-style loading, configuration-driven dispatch, or reachability on any other service. It is
evidence about the inspected static graph, and nothing wider.

---

## §4.1 aggregate-only audit — tooling delivered, execution pending

The audit is **REQUIRES OPERATOR ACTION** by design and cannot be run from an agent session. What
this package delivers is the checked-in, executable shape §4.1 names as the prerequisite:

**`scripts/ops/evidence-aggregate-audit.mjs`**

```bash
# On the operator's own machine, with a READ-ONLY role.
# Never paste a production credential into chat, a pull request, or source control.
export GCD_AUDIT_DATABASE_URL='postgres://READONLY_USER@host:5432/dbname'
node scripts/ops/evidence-aggregate-audit.mjs
```

It runs `SET default_transaction_read_only = on` and `BEGIN TRANSACTION READ ONLY`; issues a fixed
query set with nothing interpolated from argv or environment; and returns **counts, existence and
maxima only**. It reads its bounds from the single authority
(`src/harness/agents/payloadContract.ts` → `EVIDENCE_LIMITS`) rather than from any document, so it
cannot drift from the contract it checks. The variable is deliberately **not** `DATABASE_URL`.

**Executed proof against a disposable PostgreSQL 16.13 database, not production:**

| Probe | Result |
|---|---|
| Migrated through `007`, empty tables | `WITHIN BOUNDS`, exit 0 |
| Migrated through `006`, one deliberately over-bound row (1001-char claim, 17 tags, 61-char tag) | **`EXCEEDS BOUNDS`, exit 1**, failing: claim chars, claim bytes, tag cardinality, tag element chars, tag element bytes |
| Leakage check on the emitted JSON | **no claim text, no tag text** — aggregates only |
| Read-only enforcement | a `DELETE` inside the audit's transaction shape is **refused**: *"cannot execute DELETE in a read-only transaction"*; row count unchanged |

---

## §4.4.2 complete migration-state reading — tooling delivered, execution pending

**`scripts/ops/migration-state-read.mjs`**

**`A` is supplied by the operator at M1 time.** The examples below take it from
`M1_ARTIFACT_SHA` and use `${M1_ARTIFACT_SHA:?…}`, which **aborts the command** with the named
message if the variable is unset or empty — so a copy-paste with nothing supplied **fails closed**
rather than silently reading some other commit. **No commit SHA is hard-coded here on purpose**: a
literal SHA in an operator command is exactly how a superseded artifact gets deployed.

```bash
# Set this, deliberately, to the full 40-character SHA of the reviewed head of `main`
# established at M1 time. Do NOT reuse a SHA from this record, and do NOT use a branch
# name — `migration-state-read.mjs` rejects anything that is not a full SHA (A1).
export M1_ARTIFACT_SHA=''   # e.g. export M1_ARTIFACT_SHA=<40-hex-char full SHA>

# Artifact half only — no database, no credential:
node scripts/ops/migration-state-read.mjs --milestone M1 \
  --artifact "${M1_ARTIFACT_SHA:?set M1_ARTIFACT_SHA to the full SHA of A, established at M1 time}" \
  --offline

# Complete reading, immediately before the deployment is triggered:
export GCD_AUDIT_DATABASE_URL='postgres://READONLY_USER@host:5432/dbname'
node scripts/ops/migration-state-read.mjs --milestone M1 \
  --artifact "${M1_ARTIFACT_SHA:?set M1_ARTIFACT_SHA to the full SHA of A, established at M1 time}"
```

It computes `F(A)`, `D` and `P`, and evaluates **all seven** comparisons individually, printing the
differing identifiers by name. It rejects a branch name or tag as the artifact, per **A1**. It emits
`decision: pass` or `decision: stop`, where **`stop` means the deployment is not triggered**.

**Executed proof against the disposable database — every failure mode, each restored afterwards:**

| Case | `D` | `P` | Decision | Comparisons that failed |
|---|---|---|---|---|
| **A** authorized baseline | `001`–`006` | `007` | **pass** | none |
| **B** `007` already applied | `001`–`007` | *(empty)* | **stop** | 2, 3, 6 |
| **C** unauthorized `008` already applied | `001`–`006`, `008` | **`007`** | **stop** | 2, **4**, **6** |
| **D** expected `006` missing | `001`–`005` | `006`, `007` | **stop** | 2, 3, **5** |
| **E** baseline restored | `001`–`006` | `007` | **pass** | none |

**Case C is the one that justifies the whole design.** The pending set reads `['007']` — *exactly
what M1 expects* — yet the tool stops, because comparisons 4 and 6 catch the unauthorized
already-applied `008` that the pending difference **cancels out and cannot see**. This is §4.4.2's
central claim, demonstrated rather than asserted.

**Stated limitation, carried from §4.4:** `_migrations` stores `name` and `applied_at` and **no
checksum or content column**. Every comparison above is an **identity** claim. Nothing here
establishes that an applied migration's *content* matches the file of the same name in the artifact.

---

## Rollback artifact `R` and recovery

**`R` is NOT DETERMINABLE in this package.** `R` is normally the pre-M1 live api artifact — which is
`L`, and `L` has not been read. An artifact that has not been identified cannot be compatibility-tested.

**The required evidence for `R` is therefore `NOT YET EXECUTED`:** startup/readiness; every
production-reachable read and write path touching `content_evidence` and
`content_evidence_relations`; boundary, inside-boundary and outside-boundary values; existing valid
rows; and restart behaviour — each against a disposable database migrated through `007`, on
PostgreSQL 16 **and** 18.

**Redeploying `R` must not be called safe.** Until that evidence exists and passes, the recovery path
is unproven. Two further facts constrain it, both from §4.4:

- The two rollbacks are **independent**. Redeploying the prior application image does **not** unapply
  `007`; `state/rollback/007_evidence_bounds_rollback.sql` relaxes the database only. If both are
  needed they are **two separately authorized operations, in that order**.
- `007` tightens constraints that the artifact's TypeScript contract already enforces more strictly,
  so the artifact is *expected* to serve correctly afterwards — but that expectation is **verified
  after the apply**, by the health check and G7's boundary probe, never assumed from the derivation.

**Supporting, and explicitly not a substitute:** the repository's disposable-PostgreSQL suite passed
**208 checks** (fresh 59, upgrade 80, durable 69) on PostgreSQL 16.13 at this branch's base. That is
evidence about **`A`**, not about `R`.

---

## What must happen before M1 can be reconsidered

Each item is separately authorized work. None of it is granted by this record.

1. **Read-only production identity.** Read the commit served by the api, worker and scheduler.
   Establishes `L`, and with it the candidate `R`. **If `L` cannot be obtained, M1 stops.**
2. **Establish `A`** — the exact reviewed head of `main` at M1 time — **by full SHA**, then
   **evaluate the A/L predicate** against that newly established `A`: allow only `A == L` or `L`
   strictly ancestral to `A`; stop on rollback, divergence, or unknown identity. `A` is **not** any
   SHA recorded here, **not** the readiness branch head, and **not** a predicted merge commit — it
   is read from `main` at the time of the decision.
3. **If and only if `A == L`:** establish from authoritative Render behaviour that the exact deploy
   action intended for M1 actually invokes the api `preDeployCommand`, and record the exact action
   used. If it cannot be proven, **M1 stops and is re-planned**.
4. **Run the §4.1 aggregate audit** against production, read-only, and commit its results.
5. **Run the complete §4.4.2 reading** immediately before any deployment; all seven comparisons must
   pass against the four expected sets.
6. **Identify `R` and produce its executed compatibility evidence** on PostgreSQL 16 and 18.
7. **Obtain A3 approval** for the application code reachable **on the api**, at the newly
   established `A`, as safe to deploy and safe to serve. A3 is service-scoped: the api review covers
   api-reachable code. **PR #59's `orchestrator.ts` change is not api-reachable on the graph
   inspected**, so it is not an api-deployment blocker — but it is unreviewed (zero reviews) and
   **must be reviewed before the worker deployment at M2**, where it is reachable.
8. **Complete Part 1** of the §4.4.2 operator record, with `decision: pass`, **before** triggering
   anything; complete **Part 2** afterwards. A deployment without **both parts** is unauthorized by
   definition.

**`CC5-SYNTAX-001` is OPEN and deferred**, and its compensating controls require it to be **rechecked
before any production enablement**. It is not resolved, not harmless, and not production-validated.

---

## Explicit non-actions taken in producing this record

**No** deployment; **no** migration applied or rolled back; **no** production write; **no**
unrestricted or raw production query; **no** production database contacted at all; **no** Render
action, inspection, mutation or settings change; **no** migration `008`; **no** P1–P8 implementation;
**no** provider or model call; **no** executor enablement; **no** dispatch grant; **no** approval;
**no** publication; **no** operator milestone performed or authorized; **no** GBP work; **no**
hardening-parser expansion or new grammar fuzzing; **no** executable migration SQL change.

Every database operation in this record ran against a **disposable local PostgreSQL 16.13 cluster**
that was created for the purpose, used only with synthetic probe rows, then stopped and deleted. No
postgres process remains.
