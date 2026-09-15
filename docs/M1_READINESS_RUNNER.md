# M1 readiness runner — repository and database evidence

A small, repository-native Node 22 command that collects the **repository and
database portions** of M1 readiness evidence from a normal clean checkout.

It is **evidence collection only**. It authorizes no deployment, applies no
migration, rolls back nothing, executes no rollback-compatibility test, contacts
no Render service, enables no executor and enables no production automation. Its
verdict is fixed: **`M1 BLOCKED / NO-GO`**.

- Entrypoint: [`scripts/ops/m1-readiness/cli.mjs`](../scripts/ops/m1-readiness/cli.mjs)
- Orchestration: [`scripts/ops/m1-readiness/runner.mjs`](../scripts/ops/m1-readiness/runner.mjs)
- Offline tests: [`scripts/ops/m1-readiness/offline.selftest.mjs`](../scripts/ops/m1-readiness/offline.selftest.mjs)
- PostgreSQL tests: [`scripts/ops/m1-readiness/postgres.selftest.mjs`](../scripts/ops/m1-readiness/postgres.selftest.mjs)

It does **not** replace the [M1 readiness decision record](M1_READINESS_DECISION_RECORD.md),
which remains the statement of what M1 requires and why it is blocked.

---

## Running it

From a normal clean checkout, **after** the repository's ordinary locked
installation command:

```bash
npm ci
node scripts/ops/m1-readiness/cli.mjs [--out-dir <path>]
```

With no connection string the repository and CI phases run and the two database
phases are recorded as `NOT ATTEMPTED`. To include them, set the **read-only**
connection in your own shell:

```bash
export GCD_AUDIT_DATABASE_URL='postgres://READONLY_USER@host:5432/dbname'
node scripts/ops/m1-readiness/cli.mjs --out-dir ./m1-evidence
```

The variable is deliberately not `DATABASE_URL`, so the runner cannot be run by
accident against whatever happens to be exported in a deploy shell. Never paste a
production credential into chat, into a pull request, or into source control.

`GITHUB_TOKEN`, if set, raises the GitHub API rate limit. It is used and never
recorded. It must be a real GitHub API token: the runner fails closed on a `401`
rather than silently falling back to an unauthenticated read.

Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` so Node's built-in `fetch`
honours `HTTPS_PROXY`. That is a Node runtime setting; it cannot change the
workflow identity, any deadline, or the artifact.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | every attempted phase established its fact |
| `1` | evidence was written, but something was not established |
| `2` | a repository precondition failed; **no evidence was written** |
| `130` | interrupted |

### Outputs

Two files, in `--out-dir` (default: a new directory under the system temp
directory, so the checkout being read stays clean):

- `m1-readiness-evidence.json` — bounded, machine-readable, validated against a
  closed schema at every depth, and re-read under that same schema before it is
  written;
- `m1-readiness-summary.txt` — the human-readable summary.

---

## The artifact `A`

`A` is the **verified full `HEAD` of the clean checkout**, and nothing else.

There is no flag, no parameter and no environment variable by which a branch
name, a tag, an abbreviation or a separately supplied SHA could be substituted:
[`establishArtifact`](../scripts/ops/m1-readiness/repository.mjs) takes no
artifact input at all, so a different value is unrepresentable rather than merely
rejected. `HEAD` is additionally required to be a **commit** object — `git
ls-tree` will happily enumerate a tree, and a tree has no commit ancestry and
cannot have an exact-head CI run.

Every repository, CI, migration and report field binds to that one value.

---

## What the runner verifies before it collects anything

| Precondition | How |
|---|---|
| Node 22 | the running `process.versions.node`, cross-checked against `.node-version` and `package.json` `engines.node` |
| clean tracked source | `git status --porcelain=v1 -z --untracked-files=no --no-renames` |
| full 40-character `HEAD` | `git rev-parse HEAD` |
| `HEAD` is a commit | `git cat-file -t` |
| package and lockfile belong to `A` | the git blob object name of each file **on disk** is recomputed in Node and compared with the blob at `A` |
| `pg` resolves from this checkout | Node's own resolver, required to land under this checkout's `node_modules`, at the version `package-lock.json` pins |

### The `.DS_Store` allowance

This repository has a tracked `.DS_Store`. Current policy disclosed it as
unrelated generated OS metadata that is intentionally out of scope
([`docs/STATUS.md`](STATUS.md), [`README.md`](../README.md)), and
[`docs/AI_HANDOFF.md`](AI_HANDOFF.md) requires that an existing `.DS_Store`
modification be **preserved** rather than reverted.

So the clean-tree check tolerates exactly one condition: a **modification** whose
path is exactly `.DS_Store`. The runner records that it was tolerated, and it
never opens, hashes, stages, reverts or otherwise touches the file — the
allowance is granted from git's status line alone. Any other dirty entry,
including an added, deleted or renamed `.DS_Store`, a `.DS_Store` in a
subdirectory, or a second modified path, refuses the checkout.

### What the runner never does

It does not clone, check out another tree, install dependencies, modify
`node_modules`, invoke npm, generate or extract an executable helper, or modify
git configuration.

---

## The four phases

1. **Repository preconditions**, which also establish `A`.
2. **Exact-head CI evidence** for `A`.
3. **The §4.4.2 migration-state read**, bound to `A`.
4. **The §4.1 aggregate-only evidence audit**.

Phases 3 and 4 run only when a read-only connection string is supplied; without
one they are `NOT ATTEMPTED`, which is a fact rather than a failure. Phase 2
never blocks the run: a refusal is a recorded verdict.

### Reuse, not reimplementation

The migration-state computation and the aggregate audit are **the repository's
existing logic**, extracted into exported functions:

- [`scripts/ops/lib/migrationState.mjs`](../scripts/ops/lib/migrationState.mjs)
- [`scripts/ops/lib/aggregateAudit.mjs`](../scripts/ops/lib/aggregateAudit.mjs)
- [`scripts/ops/lib/errorCategories.mjs`](../scripts/ops/lib/errorCategories.mjs)

The two operator CLIs, `scripts/ops/migration-state-read.mjs` and
`scripts/ops/evidence-aggregate-audit.mjs`, are now **thin wrappers** over the
same modules. Nothing parses either tool's terminal prose.

### CI evidence

Verified against the repository's actual immutable workflow identity, fixed in
[`scripts/ops/m1-readiness/github.mjs`](../scripts/ops/m1-readiness/github.mjs)
and not replaceable by any environment variable:

- workflow path `.github/workflows/ci.yml`, workflow id `341444424`;
- event `push`; status `completed`; conclusion `success`;
- run attempt **exactly 1**;
- exactly **five** expected jobs — `Node 22 offline quality gates`,
  `PostgreSQL 16 integration`, `PostgreSQL 18 integration`, `AgentShield 1.4.0`,
  `Workflow and YAML static validation`;
- every job `completed` and `success` **on attempt 1**.

Exactly one run may satisfy those conditions. A run whose `run_attempt` is
greater than 1 has been re-run, so **a later successful retry can never satisfy
the gate**. A missing, duplicated, unexpected or unsuccessful job is a refusal,
as is a truncated run or job list — the runner refuses a partial view rather than
paginating through one.

### Database operations

All production-facing SQL is **read-only and aggregate-only**. `statement_timeout`,
`lock_timeout` and `idle_in_transaction_session_timeout` are sent as **startup
parameters**, so they bind the very first statement rather than a later `SET`
that a failure might never reach; they are re-applied as explicit `SET`s (a
connection pooler can refuse startup options) and then **verified with `SHOW`**,
so the evidence records what the server actually enforced. Every statement runs
inside `BEGIN TRANSACTION READ ONLY`, verified with `SHOW transaction_read_only`.

No migration is applied and none is rolled back. The only transaction-ending verb
the runner issues is `ROLLBACK`.

---

## Fixed deadlines

Every deadline lives in
[`scripts/ops/m1-readiness/deadlines.mjs`](../scripts/ops/m1-readiness/deadlines.mjs).
That module reads no environment variable, no argument and no clock. **No
environment variable can extend, shorten or disable any of them**; changing one
means changing that file in a reviewed commit.

| Deadline | Value |
|---|---|
| every GitHub API operation | 20 000 ms |
| the CI-evidence phase in total | 60 000 ms |
| database connection | 10 000 ms |
| lock acquisition (`lock_timeout`) | 5 000 ms |
| every database statement (`statement_timeout`) | 15 000 ms |
| idle in transaction | 20 000 ms |
| total migration-state read | 45 000 ms |
| total aggregate audit | 60 000 ms |
| any single git read | 15 000 ms |
| the repository phase in total | 60 000 ms |
| total runner execution | 240 000 ms |
| child-termination grace | 2 000 ms |

`lock_timeout` is deliberately well under `statement_timeout`: a statement blocked
behind an exclusive lock is refused by PostgreSQL's own lock timeout rather than
by the slower outer guard, so the failure is fast, attributable, and reported as
the fixed category `lock_not_available` with no driver text. That behaviour is
proven against real servers in the PostgreSQL suite, not merely documented.

Deadlines are backed by timers that **keep the event loop alive**.
`AbortSignal.timeout` is not used: its timer is unref'd, so a run whose only
pending work was the deadline itself could let Node exit before the deadline
fired, and the operation would appear to vanish rather than to time out.

---

## Strict data

One implementation, [`strictData.mjs`](../scripts/ops/m1-readiness/strictData.mjs),
serves both external GitHub responses and the runner's own persisted evidence — a
second, laxer parser is how a boundary quietly stops being a boundary.

- **Fatal UTF-8 decoding.** Invalid sequences are errors, never U+FFFD.
- **Decoded-key duplicate rejection.** `JSON.parse` keeps the *last* of a
  duplicated key and offers no way to observe it, so
  `{"conclusion":"failure","conclusion":"success"}` would read as success. Keys
  are compared *after* escape decoding, so `"a"` and `"a"` are one key.
- **Closed schemas at every depth**, with fixed enumerations, safe integers and
  bounded strings, arrays, depth, node count and document size.
- **No unknown fields.** Unknown fields are rejected by default. The **only**
  schemas that discard instead are the external-GitHub ones, because GitHub adds
  response fields without notice and a runner that refuses to start because an
  unrelated field appeared is a runner an operator will bypass. Discarded keys
  are **counted, never read**, and the count is all that reaches evidence. Every
  field the gate consumes is named, typed and bounded, and the evidence schemas
  are closed with no discard at all.

Migration state is **independently recomputed**: the complete artifact migration
inventory, canonical ordering and uniqueness, applied-row and distinct counts,
the pending set, all seven comparisons, the failed set, the decision, and
migration 007's state. The aggregate audit recomputes the **exact current
23-check contract**, with the bounds read from the single authority,
`src/harness/agents/payloadContract.ts` → `EVIDENCE_LIMITS`.

---

## Boundaries the evidence always states

| Field | Value |
|---|---|
| M1 verdict | `M1 BLOCKED / NO-GO` |
| migration 007 production state | from the read result alone, otherwise `UNKNOWN in either direction` |
| Render API identity | `UNKNOWN until separately read` |
| Render worker identity | `UNKNOWN until separately read` |
| Render scheduler identity | `UNKNOWN until separately read` |
| Render state | `NOT ESTABLISHED` |
| rollback artifact `R` | `UNKNOWN` |
| rollback compatibility | `NOT EXECUTED` |
| authorizes deployment | `false` |
| claims production validation | `false` |

There is **no executable Render functionality** in the runner. Render evidence
will be a separately reviewed addendum.

### What can never appear in the outputs

The database URL, username, password or host; any raw database error message or
server-chosen SQLSTATE; the GitHub token; any unfiltered external response.

Two mechanisms enforce that, not one. **Construction**: the document is built
field by field against a closed schema, so free-form external text has no field
to land in — every job name is pinned to the fixed enumeration of expected names,
every check name to the fixed 23, every error to a fixed category, and the run URL
is built from constants and a numeric id rather than copied from the response.
**A final scan**: the serialized bytes are re-read and the write is refused if the
connection string, its user, its password, its host or the token appears. A match
fails the run rather than redacting, because a document that needed redacting was
constructed wrong.

---

## Interruption

`SIGINT`, `SIGTERM` and `SIGHUP` stop new work, abort in-flight GitHub and
database operations, await every registered cleanup, and exit nonzero (`130`).
Each git child process is signalled and then **awaited to its `close` event**;
each database socket is destroyed and awaited, which is what ends the server-side
session.

The runner claims exactly that much and no more. It does **not** read `/proc`, it
does **not** match process names, and it makes no assertion about descendants of
a process it did not create. The PostgreSQL suite proves the database half from
the server's own catalogue: after every runner call it asserts that no backend
named `gcd-m1-readiness-runner` remains in `pg_stat_activity`.

---

## Platform support

macOS and Linux. The only platform-sensitive step is child termination, isolated
in `terminateChild` in
[`gitRead.mjs`](../scripts/ops/m1-readiness/gitRead.mjs): on both platforms the
child is sent `SIGTERM`, given a fixed grace period, then `SIGKILL`, and awaited
either way. No `/proc` entry is read on either platform. No process group is
created, so no containment claim is made that the implementation cannot
establish — every allowlisted git subcommand is a local read that spawns no child
of its own, since the pager is disabled, no hook runs and no transport is
involved.

The offline suite asserts all of this from the source itself: no module reads
`/proc`, no module matches on process names, and no module branches on
`process.platform` (it is recorded in evidence, which is a report, not a branch).

### The git boundary

There is no general command execution framework. There is no exported way to run
an arbitrary executable and no exported way to pass an arbitrary argument vector;
each operation builds its own complete argv in source, and the private helper
refuses any subcommand outside the fixed allowlist `rev-parse`, `cat-file`,
`status`, `ls-tree`.

Every invocation is read-only and passes `--no-optional-locks`. Hooks, templates,
credential helpers, pagers and editors are disabled with inline `-c` overrides,
which configure that one invocation and write nothing. The child environment is
built from scratch, so `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_CONFIG`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_SSH_COMMAND` and everything else
inherited from an operator's shell cannot redirect the read. Output is capped and
an oversized response is refused rather than buffered.

---

## Tests

```bash
npm run test:m1-readiness            # offline, no network, no database
npm run test:m1-readiness-postgres   # requires a disposable server; see below
```

Both run in CI inside the **existing** jobs — the offline suite in `Node 22
offline quality gates`, the PostgreSQL suite in the `PostgreSQL 16/18
integration` matrix. No job was added, so the five-job CI contract the runner
itself verifies is unchanged.

The offline suite covers macOS/Linux-independent operation, helper-generation
absence, exact `A` binding, dirty-tree handling, GitHub success and every failure
state, invalid UTF-8 and duplicate JSON keys, migration applied/unapplied/
inconsistent states, the exact 23-check audit, output bounds, the fixed
deadlines, interruption during GitHub work, credential redaction, and the final
evidence schemas. The GitHub boundary is exercised by replacing the global
`fetch`, so the suite cannot become "usually green because GitHub was up".

The PostgreSQL suite requires an explicit gate and a loopback-only admin URL, so
it cannot be pointed at production by exporting one variable:

```bash
M1_READINESS_DISPOSABLE_POSTGRES=1 \
M1_READINESS_POSTGRES_ADMIN_URL='postgresql://postgres@127.0.0.1:5432/postgres' \
npm run test:m1-readiness-postgres
```

It creates randomly named databases, touches only those databases, and drops
every one of them on exit. Its scenarios are migration 007 absent, migration 007
present, an unexpected migration, a within-bound audit, an exceeded-bound audit,
lock contention, connection failure, and an interrupted read. After **every**
runner call it asserts that `_migrations` is unchanged and that no runner backend
remains in `pg_stat_activity`.

---

## Why the self-extracting candidate was superseded

An earlier candidate, `scripts/ops/m1-operator-packet.sh`, exists on the branch
`claude/m1-db-blocker-fix-gp7psx` at exact head
`db0c833160f12d5102cdf60eb6e125baffcc5a4d`. It is a 2 088-line single-file
self-generating bash packet.

**That branch is not merged, not accepted and not production-ready.** It has no
pull request, it is not on `main`, and nothing in it has been run against
production. It is retained unchanged as historical evidence of the approach that
was tried; this runner replaces it architecturally rather than patching it.

The reasons, each verified against that exact head:

1. **Linux `/proc` dependency.** The packet refuses to start without `/proc`
   (`[ -d /proc/self ] || m1_die "/proc is not mounted; the collector cannot
   verify process-group exit"`), and it establishes process-group membership by
   reading `/proc/<pid>/stat`. macOS has no `/proc`, so the packet cannot run on
   one of the two platforms an operator actually uses, and its central
   containment claim has no macOS equivalent at all.

2. **Mutable generated-helper boundary.** The packet describes itself as
   "one file, self-generating": it writes `m1-env.sh` plus eighteen helpers, and
   writes further helpers (`tree.sh`, `stubborn.sh`) into a working directory at
   runtime, then executes them. What a reviewer reads in a diff is a *generator*;
   what runs is a set of files that existed nowhere at review time and that
   anything with write access to that directory could alter between generation
   and execution. It also clones the repository and prepares dependencies inside
   the clone, so the tree it measures is not the tree that was reviewed.

3. **Strict-data validation gaps.** The packet does have a duplicate-key-aware
   JSON reader, which was the right instinct. But it reads its inputs with
   `fs.readFileSync(path, "utf8")`, which substitutes U+FFFD rather than failing,
   so two different byte strings can become one identifier; and it has no closed
   schema, no fixed enumerations, no safe-integer enforcement and no document
   size ceiling. It also has no GitHub API phase, so exact-head CI evidence for
   `A` is simply not covered.

4. **Missing deadlines.** The packet has no wall-clock deadline on any
   operation. Its one time budget bounds waiting for a process group to exit;
   there is no deadline on a GitHub call, a database connection, a lock, a
   statement, the migration-state read, the audit, or the run as a whole, and no
   `statement_timeout` or `lock_timeout` is set on any session. A statement that
   blocks behind an exclusive lock blocks indefinitely.

5. **Interruption and process containment.** The packet installs no `INT`, `TERM`
   or `HUP` handler; the only `trap` in the file is `trap '' TERM` inside a
   deliberately stubborn generated child. There is no path by which an operator's
   interrupt cancels an in-flight read, awaits cleanup and exits nonzero, and the
   containment it does assert rests entirely on the `/proc` PGID walk that item 1
   makes unavailable on macOS.

This runner keeps the parts of that approach that were right — read-only
everything, sanitized failure categories, identity by complete filename,
aggregate-only SQL, refusing to infer migration 007's state — and moves them into
ordinary committed source that a reviewer can read in the diff and a test suite
can hold in place.

---

## Scope

This runner covers the **repository and database** portions of M1 readiness only.
It does not begin Render integration, rollback-compatibility execution, M1
authorization, deployment, migration application, or any later rollout milestone.
Migration 007's production state remains **`UNKNOWN in either direction`** until a
read result says otherwise, and M1 remains **`BLOCKED / NO-GO`**.
