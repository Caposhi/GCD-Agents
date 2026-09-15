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

**PR #60 has merged, and `main` has advanced**, because this package was itself a change to `main`.
It merged as `2a9edb7f86a07ddb7c27bc91e3c214052d0a2dc4`, whose ordered parents are
`2f76679afa78721ad9751ea7ce3124c5307b090c` then the reviewed head
`d67dcb5158bc2847cc8f1b6190a649c89546e26b`. `2f76679a…` is consequently **no longer the head of
`main`** — it is that merge's first parent. Per §4.4, *"the M1 artifact is the **reviewed head of
`main` at M1 time**"*, so `2f76679a…` is now definitively historical, and citing it as the artifact
would be citing a superseded commit.

**This does not make the merge commit `A` either.** `A` is whatever `main`'s reviewed head is when an
M1 decision is actually taken, read at that moment — not this merge SHA, not any SHA recorded here.

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
| **A1** | Exact reviewed commit, named by full SHA, exact-head CI green | **NOT YET SATISFIED** — `A` is not established (see above). The candidate `2f76679a…` was named by full SHA and carried green CI, but PR #60 has merged, so it **is** historical now. A branch name, a tag, a non-commit Git object, and any SHA recorded here are all rejected. |
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
differing filenames by name. It emits `decision: pass` or `decision: stop`, where **`stop` means the
deployment is not triggered**.

**Migration identity is the complete filename, byte for byte — never its numeric prefix, and never a
trimmed form.** `_migrations` stores the
filename, and the general migration runner applies whichever file is present. A migration renamed
`007_anything_else.sql` shares the prefix `007` with the authorized migration while being a different
file containing different SQL. All four expected sets are therefore written as complete canonical
filenames, and every one of the seven comparisons compares filenames verbatim. No numeric-prefix
projection takes part in any authorization decision.

**The artifact must be a COMMIT object.** A 40-hex-character check alone is not enough: `git ls-tree`
enumerates a *tree* SHA just as happily as a commit, so a tree, blob or annotated-tag object would
otherwise be recordable as the deployed artifact — with no commit ancestry, no possible exact-head CI
run, and no reviewable or deployable identity. The tool runs `git cat-file -t` and requires the type
to be exactly `commit` before it enumerates anything. A branch name or tag *name* is still rejected by
the full-SHA check, per **A1**.

**Failures print a fixed category, never the driver's message and never its code.** A raw driver
message routinely embeds the database user and the host:port it tried (`role "…" does not exist`,
`connect ECONNREFUSED 127.0.0.1:1`). The SQLSTATE is no safer: `RAISE … USING ERRCODE = 'ZZZZZ'`
lets the **database** choose it, so matching its shape sanitizes nothing. Both operator scripts map
explicitly recognised PostgreSQL SQLSTATEs and Node/system codes to **fixed category strings defined
in the script**, emit the category in place of the code, and degrade everything unrecognised to
`UNKNOWN`. What reaches the log is therefore always chosen in the script, never by the server — which
matters because operator logs and committed evidence carry whatever is printed.

**Executed proof against the disposable database — every failure mode, each restored afterwards:**

| Case | `D` | `P` | Decision | Comparisons that failed |
|---|---|---|---|---|
| **A** authorized baseline | `001`–`006` | `007` | **pass** | none |
| **B** `007` already applied | `001`–`007` | *(empty)* | **stop** | 2, 3, 6 |
| **C** unauthorized `008` already applied | `001`–`006`, `008` | **`007`** | **stop** | 2, **4**, **6** |
| **D** expected `006` missing | `001`–`005` | `006`, `007` | **stop** | 2, 3, **5** |
| **E** baseline restored | `001`–`006` | `007` | **pass** | none |
| **F** artifact renames `007` → `007_malicious.sql`, canonical `001`–`006` applied | `001`–`006` | `007_malicious.sql` | **stop** | **1**, **3** |
| **G** artifact renames applied baseline `006` → `006_tampered.sql` | `001`–`006` canonical | `006_tampered.sql`, `007` | **stop** | **1**, **3**, **4** |
| **H** database holds renamed baseline `006_tampered.sql`, artifact canonical | `…005`, `006_tampered.sql` | `006`, `007` | **stop** | **2**, **3**, **4**, **5**, **6** |
| **I** artifact's `007` carries a **trailing space** | `001`–`006` | *(007 excluded)* | **stop** | **1**, **3** |
| **J** artifact's `007` carries a **leading space** | `001`–`006` | ` 007…`, `007` | **stop** | **1**, **3** |
| **K** artifact's `007` contains an **embedded newline** | `001`–`006` | `007_evi⏎dence.sql`, `007` | **stop** | **1**, **3** |

**Cases F–K were each added after an independent inspection found a real bypass**, recorded in full
below. Under the previous prefix-based comparison, case F returned **all seven comparisons `true`,
`decision: pass`, exit 0** with an unauthorized `007_malicious.sql` pending. Under the previous
filename *trimming*, case I did the same while migration 007 would **never have been applied at all**.

**Case C is the one that justifies the whole design.** The pending set reads `['007']` — *exactly
what M1 expects* — yet the tool stops, because comparisons 4 and 6 catch the unauthorized
already-applied `008` that the pending difference **cancels out and cannot see**. This is §4.4.2's
central claim, demonstrated rather than asserted.

**Stated limitation, carried from §4.4:** `_migrations` stores `name` and `applied_at` and **no
checksum or content column**. Every comparison above is an **identity** claim. Nothing here
establishes that an applied migration's *content* matches the file of the same name in the artifact.
Comparing complete filenames closes the rename bypass; it does **not** and cannot detect a file
edited in place under an unchanged name.

### Two functional defects found by independent inspection, and corrected

An earlier revision of this package asserted that both operator scripts had **no functional defect**.
**That assertion was false**, and is withdrawn. An independent inspection found two, both reproduced
here before being fixed:

| # | Defect | Reproduction, before the fix | Correction |
|---|---|---|---|
| 1 | Migration identity was reduced to its numeric prefix, so `007_malicious.sql` compared equal to `007_evidence_bounds.sql` | Artifact with `007` renamed, canonical `001`–`006` applied: **all seven comparisons `true`, `decision: pass`, exit 0** — an unauthorized pending migration would have passed G3a/A4 and then been applied by the general runner | All four expected sets are complete canonical filenames; `fFiles`, `dFiles` and `pFiles` compare verbatim; the prefix projection is deleted, not merely bypassed; regression cases **F**, **G** and **H** added |
| 2 | **A1** validated only 40 lowercase hex characters, so any Git object was accepted | Tree SHA `b94c30b9c0b321c8d9f95e6af25acbb0c7aa8a68` was accepted, enumerated migrations, reported comparison 1 `true`, exit 0 — despite being a tree, not a commit | `git cat-file -t` must return exactly `commit` before any enumeration; tree, blob, annotated-tag and non-existent-object SHAs each exit **2** |

The prefix projection was load-bearing for the bypass, not incidental: comparison **4** already
compared full filenames, which is why case G is caught by 4 as well as by 1 and 3, while case F —
where the rename is on the *pending* migration and so never appears in `D` — was caught by **nothing
at all**.

### Two further defects found by a second independent inspection, and corrected

| # | Defect | Reproduction, before the fix | Correction |
|---|---|---|---|
| 5 | Filenames were **trimmed** before comparison, so surrounding whitespace was invisible | Artifact with `007_evidence_bounds.sql` renamed to `007_evidence_bounds.sql ` (trailing space) and canonical `001`–`006` applied: `F(A)` reported the **canonical** name, **all seven comparisons `true`, `decision: pass`, exit 0**. `src/state/migrate.ts` selects `f.endsWith(".sql")` on the **real** name, so the runner would have **skipped the file entirely** — M1 would have been authorized to deploy with **migration 007 never applied** | `git ls-tree **-z**`, split on NUL, **never trimmed**; basenames compared byte for byte. `-z` also matters independently: without it git **quotes** a path containing unusual characters, so the name compared is not the name on disk. Regression cases **I**, **J**, **K** added |
| 6 | The failure filter checked the **shape** of the error code, not its value — and a SQLSTATE is **server-chosen** | A disposable PostgreSQL function raising `ERRCODE='ZZZZZ'` with sensitive text in its message caused both scripts to emit `error_code=ZZZZZ`, **not** `UNKNOWN`. A shape check is not a sanitizer: database-controlled codes entered operator logs and committed evidence, contradicting this record's own guarantee | A fixed table maps **explicitly recognised** PostgreSQL SQLSTATEs and Node/system codes to **fixed category strings**; the category is emitted **in place of** the code, so the emitted value is always chosen in the script and never taken off the wire. Everything unrecognised — every custom SQLSTATE included — degrades to `UNKNOWN`. Custom-SQLSTATE regressions added for **both** scripts |

**Scope of the whitespace fix, stated honestly:** comparing exact bytes closes the rename and
whitespace bypasses. It does **not** detect a file edited in place under an unchanged name — that
remains outside what `_migrations` can support, since it stores no checksum.

---

## M1 operator packet — one file, and the dependency blocker it corrects

`scripts/ops/m1-operator-packet.sh` is a single file an authorized operator runs from an **empty
directory**. It generates its own tool set — `m1-env.sh` plus eighteen helpers, nineteen files in
all — binds one isolated clone of this repository at an exact artifact commit `A`, prepares
dependencies inside that clone, runs the two read-only operator scripts from it, runs five
regression groups, writes a fixed-field `RETURN_FORM.txt` and an `EVIDENCE_REPORT.txt`, and removes
the isolated clone together with its dependency tree.

It deploys nothing, applies no migration, contacts no Render control plane, and requests no
production credential. Running it authorizes nothing. The verdict it carries is fixed and preserved:
**M1 BLOCKED / NO-GO**.

### The blocker

The previous revision's database-enabled path created a fresh isolated clone with no `node_modules`,
stopped, and told the operator to run `npm ci --omit=dev` inside that clone and rerun — and the rerun
created another fresh clone with no `node_modules`. There was no executable path by which
`M1_DB_ENABLED=1` could reach either operator script.

The defect was wider than the database path. Both operator scripts carry `import pg from "pg"` at
module top level, so `migration-state-read.mjs --offline` — which contacts no database at all — was
blocked by exactly the same thing.

### The correction: helper 05, dependency preparation

An explicit, automatic step inside the already-bound isolated clone, before either operator script
runs. Its contract is enforced, not documented:

| Property | How it is established |
| --- | --- |
| Manifest and lockfile are artifact `A`'s | `git cat-file blob A:<file>` compared byte for byte with the checked-out file |
| A real Node 22 binary | `v22.*`, a reported V8 version, and an `execPath` resolving to the binary that ran |
| A real npm binary | `npm version --json` — npm's own report of its version and its Node |
| The repository lockfile, unmodified | sha256 before and after, plus `git status --porcelain` on the lockfile |
| `npm ci`, never `npm install` | the only install invocation in the packet |
| No lifecycle scripts | `--ignore-scripts` on the command line, which outranks every config file |
| No audit or funding network call | `--no-audit --no-fund` |
| No development dependencies | `--omit=dev` |
| No global installation | no `-g`; npm's own resolved `global` config asserted to be `false` |
| Isolated cache | `--cache` inside the work directory, removed at cleanup |
| Isolated scope | cwd inside the clone; `--userconfig` and `--globalconfig` pinned to empty files |
| Bounded capture | stdout and stderr through the corrected immutable bounded collector |
| Safe failure | a non-zero exit records `DEP_PREP_STATUS=FAILED` and stops; no operator script runs |
| `pg` resolves from the clone | `require.resolve` asserted to be under the clone, plus the ESM default-import form the scripts actually use |

`npm ci --omit=dev --ignore-scripts --no-audit --no-fund` was verified sufficient at artifact `A`:
101 packages, `pg` 8.22.0 resolving from the isolated clone, both operator scripts running. No
package lifecycle script was enabled to make anything pass. It is also the smallest installation
reachable without editing `package.json` or the lockfile, both of which are forbidden here — a
narrower set cannot be expressed to `npm ci`, whose whole contract is to install the lockfile.

### Correction: output-overflow behaviour, and a claim that is withdrawn

The first revision of this packet stated two properties that cannot both hold. It
said the collector enforced a 1,048,576-byte bound, and it also said an
over-producing child ran to completion with its own exit status preserved — the
regression case even asserted that a 3 MiB producer still reported exit status
42. The second was what the code did. The sinks read the bound and then drained
and counted everything after it, so the bound limited only what was STORED. A
child emitting output forever was stopped by nothing, and a run that had already
breached the bound was reported as an ordinary result.

**That claim is withdrawn.** The statement that the collector "never kills" an
overflowing producer, and the regression assertion built on it, are both gone.
The earlier commit message and the report that accompanied it carry the
incorrect claim; neither is rewritten, and this record is the correction.

The collector now distinguishes five outcomes, and never collapses them:

| Outcome | Meaning | `exit_status` |
| --- | --- | --- |
| `EXIT` | the child stayed below the bound and exited normally | its genuine status, 0-255 |
| `OVERFLOW` | a stream reached 1,048,576 bytes; the process group was terminated | `NOT_APPLICABLE` |
| `SIGNAL` | killed by a signal the collector did not send | `NOT_APPLICABLE`, `signal` names it |
| `COLLECTOR_FAILURE` | the collector could not run or capture — fatal | `NOT_APPLICABLE` |
| `CLEANUP_FAILURE` | the process group could not be proven gone — fatal | `NOT_APPLICABLE` |

`OVERFLOW` is a token, not a number, so no caller can read an overflowed run as
an exit status; a test for `0` fails closed instead.

On overflow the collector terminates the child's **whole process group** —
children and grandchildren — through a bounded escalation of two `SIGTERM`
rounds and two `SIGKILL` rounds, each with its own budget, stopping the moment
the group is observed gone. Failure to prove the group gone is fatal to the run.
Nothing after the bound is stored, parsed, decoded or returned.

The supervisor is Node rather than shell for three reasons that matter here.
`spawn(..., {detached: true})` puts the child in its own session and process
group, so one `kill(-pgid, …)` reaches every descendant. Node reports an exit
status and a terminating signal as separate fields, which a shell's `wait`
cannot — both surface there as 128+N. And group membership is read from `/proc`
by PGID, so a survivor is identified by exact PID and never by matching a
process NAME.

"Gone" is stated precisely. The scan separates members still **running** from
members in state `Z`, which have already exited and are waiting only to be
reaped by init after their group leader died. A zombie runs no code, holds no
descriptor and cannot emit another byte. `survivors` reports the running set and
must be `NONE`; `exited_awaiting_reap` reports the rest rather than hiding it.

The bound is still not `ulimit -f`, and the limit is still immutable: it is a
literal in the supervisor, never read from the environment. Verified with
`M1_STREAM_LIMIT_BYTES=7` and `M1_COLLECTOR_LIMIT=7` in the environment — a
4,096-byte stream was captured whole and the supervisor reported `limit_bytes`
of 1,048,576.

Files are untouched by any of this: under active collection, Git wrote a 3 MiB
object and a full clone whose largest file exceeds the bound, Node wrote a 2 MiB
file, npm's installed tree carries a file above the bound, and a PostgreSQL
client wrote a 4,020,000-byte file — every one an ordinary `EXIT` 0.

### Environment sanitization

Names are recorded; **no value of a sanitized or rejected variable is printed, logged or recorded.**

- **Sanitized** (removed from the dependency step's environment): every `npm_config_*`,
  `NPM_CONFIG_*`, `npm_package_*` and `npm_lifecycle_*` variable outside the transport allow-list,
  plus `NODE_OPTIONS`, `NODE_PATH`, `NODE_REPL_*` and `NPM_TOKEN`.
- **Allowed** (transport only): `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and their lowercase
  spellings, `NODE_EXTRA_CA_CERTS`, and the `npm_config_*` proxy spellings. A proxy can carry the
  traffic; it cannot change what is installed, because `npm ci` verifies every tarball against the
  sha512 integrity hash in the lockfile that was just proven to be artifact `A`'s.
- **Rejected** (the packet stops): a variable requesting package lifecycle scripts.

### The fixed output contract

`RETURN_FORM.txt` carries approved fixed fields only. A field name outside the approved list cannot
be recorded, and a value carrying a character outside the approved set cannot be recorded, so no text
from npm, from a database driver, or from a CI capture can reach it. An approved field that nothing
recorded is emitted as `NOT_RECORDED` rather than omitted, so a missing step is visible. Dependency
preparation is reported explicitly: status, command, scope, Node version, npm version, lockfile
sha256, whether the lockfile was modified, whether `pg` resolved and at which version, packages
added, and the sanitized and rejected variable names.

### What the paths establish, and what they do not

- `END_TO_END_CLAIM=NOT A COMPLETE END-TO-END RUN`. The earlier DB-disabled execution was not one and
  is not described as one.
- The **DB-disabled** path establishes the artifact half of the migration-state read and the
  exact-head CI identity. It reads no database.
- The **database-enabled** path reads `D`, `P` and the seven comparisons and runs the aggregate audit,
  against a **disposable** database only.
- The combination "migration 007 present over data that exceeds the bounds" is **not reachable**:
  007's constraints validate immediately, so applying it to such data fails and 007 is never recorded
  as applied. Demonstrated on disposable PostgreSQL 16 and 18 rather than assumed.

Migration 007's production application state remains **`UNKNOWN in either direction`**; Render remains
**`NOT ESTABLISHED`**; the api/worker/scheduler service identities remain unknown; rollback
compatibility remains **not executed**; all six registry executors remain `executionEnabled: false`.

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
evidence about **the historical candidate — this branch's base — not about `A`, and not about `R`.**
`A` does not yet exist, so no evidence here can be evidence about it. This suite **must be rerun
against the newly established `A`** at M1 time; the run recorded here carries no forward authority
and may not be reused merely because the migration file set appears unchanged.

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

At this package's merge, **`CC5-SYNTAX-001` was open and deferred**; this package did not
advance or bypass it. It has since been resolved in repository source by the independently accepted
whole-file SQL-authority replacement recorded in
[Known issues and hardening](KNOWN_ISSUES_AND_HARDENING.md), not by making the bounded English
recogniser semantically complete. That later repository control changes no M1 prerequisite:
migration 007's production state remains `UNKNOWN in either direction`.

---

## Post-merge record — PR #60 merged, and what that did and did not establish

**PR #60 is `MERGED`.** Base `2f76679afa78721ad9751ea7ce3124c5307b090c`; reviewed head
`d67dcb5158bc2847cc8f1b6190a649c89546e26b`; merge commit
`2a9edb7f86a07ddb7c27bc91e3c214052d0a2dc4`, whose **ordered parents are exactly that base then that
reviewed head**. Five files, +1138/−1; five linear commits on the branch, zero merges. This record
and the two operator scripts are present on `main`.

**What the merge delivered:** this decision record, the roadmap and status reconciliation, and the two
read-only operator scripts — `scripts/ops/evidence-aggregate-audit.mjs` (§4.1) and
`scripts/ops/migration-state-read.mjs` (§4.4.2).

**What the merge did NOT do — none of this is changed by it being on `main`:**

- It **did not authorize or execute M1**, and merging an evidence package is never an authorization.
- Migration 007's production application state remains **`UNKNOWN` in either direction**.
- The operational verdict remains **`M1 BLOCKED / NO-GO`**.
- It established **none** of: `A`; `L`; the api/worker/scheduler service identities; `D`, `P`, or
  comparisons 2–7; the §4.1 aggregate audit against production; or rollback-artifact `R` and its
  compatibility evidence. Every one of those remains `NOT YET ESTABLISHED` or `NOT YET EXECUTED`.
- It **deployed nothing**, applied no migration, queried no production database, contacted no Render
  control plane, enabled no automation, and enabled no executor.

### Post-merge workflow evidence, observed read-only

| Fact | Evidence |
|---|---|
| CI at the merge commit | Run **`34712320198`**, `push`, `head_sha 2a9edb7f…` — **five jobs, all `success`, each `run_attempt: 1`** |
| Deployment workflow | Run **`34712586222`**, `workflow_run`, attempt 1, conclusion **`failure`** |
| Its provenance step | **Accepted** — `CI_WORKFLOW_NAME: CI`, `CI_CONCLUSION: success`, `CI_EVENT: push`, `CI_HEAD_BRANCH: main`, repository and repository-id matched |
| Why it then refused | `AUTOMATION_ENABLED: false` → *"Production deployment refused: `RENDER_DEPLOY_AUTOMATION_ENABLED` must be exactly true."*, exit 1 |
| Release selection | **Skipped** — no release commit was ever selected |
| `Serialized API, worker, scheduler release` | **Skipped — zero steps executed** |
| `scripts/render/deployment-controller.mjs` | **Never ran** — the skipped job is its only caller |
| `MIGRATION_ROLLOUT_REQUIRED` | **Not evaluated in that run** — the controller is its only site |

**No GitHub-driven Render deployment occurred through that workflow.** The gate is closed and behaved
correctly; the refusal is the designed outcome, and it was not re-run, bypassed, or forced.

**Render-side activity through any unrelated path is `NOT ESTABLISHED`** — the session that recorded
this had no Render control-plane access, so it can state what GitHub did and did not do, and cannot
state anything about Render from Render's own side. That is a limit of the evidence, not a finding of
absence.

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
