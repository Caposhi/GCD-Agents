# Production-wiring design — making the six dormant executors reachable, safely

**This document is a design. It implements nothing, and it authorizes nothing.** No source, test,
migration, workflow, configuration, `render.yaml`, agent, skill, or prompt file changes with it.
Nothing here enables an executor, applies a migration, deploys a release, contacts a provider, or
publishes content. It is the separately reviewed production-wiring design that
[`docs/ROADMAP.md`](ROADMAP.md) names as the next product cursor. **It is a draft under review and has
not been accepted.**

**Evidence labels used throughout.** Every claim carries one:

| Label | Meaning |
|---|---|
| **VERIFIED** | Read directly from repository source or Git during this design, and reproducible by the reader with the command or path given |
| **PROPOSED** | A design choice made here. Not built, not authorized |
| **UNKNOWN** | Not established by anything this session could inspect. Not to be assumed either way |
| **REQUIRES OPERATOR ACTION** | Can only be established or performed by an authorized operator, outside an agent session |

A reader who cannot tell which label a sentence carries should treat it as **UNKNOWN**.

---

## 1. Current state

### 1.1 What is merged

**VERIFIED** — all six Content Intelligence stage executors are present in source, each with its own
module, prompt asset, and skill asset:

| Stage | Module | Registry id |
|---|---|---|
| 1 | `src/harness/agents/strategyConcept.ts` | `strategy-concept` |
| 2 | `src/harness/agents/automotiveTruth.ts` | `automotive-truth` |
| 3 | `src/harness/agents/hookStoryScript.ts` | `hook-story-script` |
| 4 | `src/harness/agents/productionDirection.ts` | `production-direction` |
| 5 | `src/harness/agents/packagingAdaptation.ts` | `packaging-adaptation` |
| 6 | `src/harness/agents/finalCritic.ts` | `final-critic` |

**VERIFIED** — the payload-contract reconciliation is merged: `src/harness/agents/payloadContract.ts`
is the single import-free bound authority, `src/harness/sdk.ts` carries the stage request boundary,
and `src/harness/evidence/pack.ts` carries `conflictedEvidence` and `assertUsableEvidencePack`.

### 1.2 What is deployed, and what is not established as deployed

**VERIFIED (repository)** — the six executors and the payload contract are on `main`.

**UNKNOWN (production)** — whether any release carrying them is live. Nothing in this session
inspected Render. [`docs/STATUS.md`](STATUS.md) records a **dated** production verification, and a
dated observation is not a statement about now. The correct reading is **not established as
deployed**, which is different from "not deployed" — neither is proven here.

### 1.3 What is dormant, and *why* it is dormant

This is the most important finding in this document, because the reason differs from what a reader
would reasonably assume.

**VERIFIED** — all six registry entries carry `executionEnabled: false`
(`src/harness/agents/registry.ts`), and `grep -rn "executionEnabled: true" src/` returns **zero**
matches.

**VERIFIED — and load-bearing:** `executionEnabled` is a *declarative registry field that no
execution path consults*. `invokeStage` (`src/harness/agents/stageExecution.ts`) never reads it;
neither does any of the six executor modules. The only consumer is `assertPreviewIsInert`
(`src/harness/contentIntelligence.ts`), which reads it to keep the **preview** inert.

Dormancy therefore rests on two *structural* facts, not on the flag:

1. **VERIFIED** — no production path in this repository calls any executor.
2. **VERIFIED** — no executor has a default runner. Every executor requires the caller to supply
   one; `runBrief` additionally refuses injected seams when `config.nodeEnv === "production"`.

### 1.3.1 What the dormancy regressions actually prove — and what they do not

**VERIFIED** — the `AQ18a`–`AQ18e` family in `src/harness/contentIntelligence.selftest.ts` reads a
**fixed list of named source files** and asserts that the text of each matches neither
`executeAutomotiveTruth` nor `agents/automotiveTruth`. Reproduce it at
`src/harness/contentIntelligence.selftest.ts`, `boundaryIsDormant`.

**These are direct-reference smoke checks over fixed files. They are not proofs of transitive
reachability, and not proofs of executed reachability.** Stated precisely:

- They inspect **only the files named in each check**. A file not on the list is not examined.
- They match **only those two literal strings**. A different import spelling, a re-export, a dynamic
  import, or a registry-driven dispatch would not match.
- **An intermediary module defeats them entirely.** If module `X` imported the executor and one of
  the listed files imported `X`, a real call path would exist and **every one of these checks would
  still pass** — they never follow an edge beyond the first file.
- They execute nothing. They do not demonstrate that a disabled or unauthorized entry point refuses;
  they demonstrate only that a fixed set of files does not mention the executor by name.

They are a reasonable smoke check for today's design, in which there is no caller at all. They are
**not** adequate protection for a design that has one.

**PROPOSED — required of the PR that first introduces a caller (P3):** stronger protection replacing
reliance on these checks, specifically both of:

1. **Transitive dependency or call-graph coverage** where practical — a check that resolves the
   import graph from each production entry point and asserts no path reaches an executor module,
   rather than grepping a fixed file list for two strings.
2. **Executed integration tests** proving that a disabled entry point and an unauthorized entry point
   **cannot reach an executor** — tests that call the real entry point and assert **zero** runner
   invocations, rather than tests that read source text.

Until both exist, no claim stronger than "these fixed files do not name the executor" may be made,
in this document or anywhere else.

### 1.3.2 Two consequences an implementer must not get wrong

- Flipping `executionEnabled` to `true` today would, by itself, change **nothing**. It is not the
  gate it appears to be.
- Adding a caller would make a stage reachable **even with `executionEnabled: false`**. The flag
  would not stop it.

**PROPOSED** — an early implementation PR must therefore make `executionEnabled` actually gate
execution, *before* any caller exists (§6, **P2** — after **P1**, which creates the control plane the
same boundary must also consult). Flipping the six flags to `true` is then a separate, separately
reviewed source change of its own (§6, **P8**), performed after the boundary enforces them and while
the runtime authority gate still withholds permission — never a clause inside an operator step.

### 1.4 Production evidence — available versus absent

| Item | State |
|---|---|
| Repository validation of the six executors and the payload contract | **VERIFIED** — offline suites, mutation harness, disposable PostgreSQL 16/18, exact-head CI, all with an **injected fake runner** |
| A production caller for the six-stage chain | **VERIFIED absent** — the repository currently contains none |
| Whether any executor has *ever* been invoked against a real model, in any environment or manual session | **UNKNOWN / NOT ESTABLISHED** — Render histories, provider request histories, and operator session histories were **not inspected**. This is a historical question about systems outside the repository, and a repository read cannot answer it either way |
| Any stage reachable from a production path in the current source | **VERIFIED absent**, subject to the limits in §1.3.1 |
| Live Render service state, versions, health | **UNKNOWN** — not inspected in this session |
| Production database contents | **UNKNOWN** — not inspected; no credential requested or held |
| Production evidence for the six executors | **UNKNOWN — none available to this design** |

The distinction in rows 2 and 3 matters and is easy to blur. "This repository has no caller today" is
checkable and checked. "No stage has ever run against a real model anywhere" is a historical negative
about external systems, and **this design does not assert it**.

### 1.5 Migration 007 — source state and operational prerequisite

**VERIFIED** — `state/migrations/007_evidence_bounds.sql` and
`state/rollback/007_evidence_bounds_rollback.sql` both exist in source. The migration's own header
states that applying it to production is a separate, separately authorized operation and that it has
not been applied.

**VERIFIED** — the repository contains no claim that 007 has been applied to production.

**UNKNOWN / REQUIRES OPERATOR ACTION** — whether the production evidence tables are in a state that
allows 007's immediately validated constraints to pass. A dated aggregate-only audit is recorded in
the roadmap for 2026-09-02; **this design treats that audit as NOT YET EXECUTED for the purpose of
authorizing an apply**, because nothing in this session could independently prove it, and because a
dated emptiness observation is not a standing guarantee about a table that remains writable. A fresh
audit is a precondition regardless of what any document records. See §4.

---

## 2. Proposed execution flow

Everything in this section is **PROPOSED**.

### 2.1 Entry point and stage order

The entry point is a **new deterministic orchestration function** — `runContentIntelligenceRun(...)`
— that lives beside the existing orchestrator rather than inside it. It is *not* `runBrief`. Keeping
it separate means the existing production posting path is unchanged by construction.

Stage order is fixed and total; there is no branching, no skipping, no reordering:

```
strategy-concept → automotive-truth → hook-story-script
                 → production-direction → packaging-adaptation → final-critic
```

The run is driven by the caller, not by the model: no stage chooses what runs next.

### 2.2 Typed handoffs

Each stage consumes the complete typed output of its predecessors and is revalidated against the same
evidence pack before any model call, through each owning module's exported revalidator. This is
already how the merged executors behave (**VERIFIED**); the wiring adds no new handoff shape.

| Stage | Receives | Authority boundary |
|---|---|---|
| 1 | goal + evidence pack | `allowedFacts` only |
| 2 | complete Stage 1 output + pack | permits by evidence **id**, never by sentence |
| 3 | Stages 1–2 + pack | Stage 2's whitelist |
| 4 | Stages 2–3 + pack | Stage 3's **used** claims |
| 5 | Stages 2–4 + pack | Stage 3's used claims; Stage 4 is context, never a claim source |
| 6 | Stages 2–5 + pack | Stage 5's per-platform `PLATFORM_CLAIMS` bindings |

**Structural validation is not provenance verification.** A structurally valid, hand-built or
deserialized value passes. That limit is already documented per stage and does not change.

### 2.3 Persistence, restart and recovery boundaries

**PROPOSED** — a run is durable from its first stage, reusing the existing durable phase-marker
discipline rather than inventing a second one:

- A `content_intelligence_runs` row is created **before** stage 1 executes, carrying the run id,
  brief id, evidence-pack `builtAt`, the exact pack digest, the code version, the authority mode
  observed at dispatch (§3.2), and the id of the manual-dispatch grant consumed to accept it, if any
  (§3.2.1) — the grant decrement and this row commit in the same transaction.
- A `content_intelligence_stage_results` row is committed **after each stage returns and validates**,
  before the next stage begins.
- Recovery is **refuse-don't-resume**, matching the merged worker recovery posture: a run whose owner
  is gone is terminalized and never continued. A partially completed run is never resumed against a
  different evidence pack, a different code version, a different owner, or a different authority mode.

### 2.4 Idempotency and duplicate-run protection

**PROPOSED**, three independent layers:

1. **Ownership.** The run executes only on the process holding the existing PostgreSQL session-level
   advisory lock. **VERIFIED** that this mechanism exists and is proven under real contention.
2. **A unique run key.** `(brief_id, pack_digest, code_version)` is unique. A second attempt with the
   same triple is refused, not silently re-run.
3. **Per-stage commit-before-advance.** A stage that already has a committed result is never
   re-executed within a run; the stored output is used.

Model spend makes this stricter than ordinary idempotency: a duplicate run is not merely wasteful, it
produces a second, different set of model outputs for the same brief.

### 2.5 Failure, timeout, cancellation, partial runs

| Condition | **PROPOSED** behavior |
|---|---|
| Stage validation fails | Run terminalizes as `failed`. No retry, no repair call, no partial promotion |
| Model request fails | Already fail-closed as `StageExecutionError` (**VERIFIED**). Run terminalizes |
| Stream deadline expires | `StageStreamDeadlineError` → `StageExecutionError` (**VERIFIED**). Run terminalizes |
| Ownership lost mid-run | Process writes nothing further and exits non-zero (**VERIFIED** mechanism). Reconciled by the next owner's startup recovery |
| Authority gate turned off mid-run | See §3.2 — no further stage starts; the run terminalizes as `operator_disabled` |
| Cancellation requested | Cooperative, checked between stages. A model request already in flight is **not** cancelled; see §3.2 |
| Partial run | Terminal and visible. **Never** promoted, never approved, never published |

**PROPOSED** — no retry is added anywhere. "Exactly one provider request per stage invocation" is a
merged guarantee (**VERIFIED**: `maxRetries: 0`) and the wiring must not weaken it by retrying higher up.

### 2.6 Deterministic versus model-authored

| Deterministic (TypeScript) | Model-authored |
|---|---|
| Evidence pack construction and validation | Stage prose: angles, assessments, scripts, direction, captions, critique |
| Stage ordering and dispatch | — |
| Every validator and revalidator | — |
| Claim binding by evidence id | — |
| Approval creation, subject hashing, decision recording | — |
| Publication and every provider request | — |

No sentence a model writes becomes a claim, a citation, an approval, or a publication.

---

## 3. Authority and safety gates

### 3.1 The seven authority layers

**PROPOSED** — seven layers (layer 4 has two independent halves), each independently switchable,
each proven separately. **No single flag or deployment may satisfy more than one.**

| # | Layer | Satisfied by | Not implied by |
|---|---|---|---|
| 1 | **Code presence** | Merge to `main` | Anything else |
| 2 | **Deployment** | A release carrying that commit observed live on the owning service | Merge |
| 3 | **Database readiness** | Migration 007 applied **and post-apply-validated** (§4) | A deployment having run. An api deploy *does* apply pending migrations (§4.0) — indeed applying 007 **is** an api deployment (§4.4) — so what distinguishes readiness is not that a deploy happened but that the deploy was the authorized artifact, its pending set was verified beforehand, and G7 validated the result afterwards. An apply that happened as an unexamined side effect satisfies this layer no more than not applying it at all |
| 4a | **Bounded manual dispatch** | A caller exists *and* an unexpired manual-dispatch grant with runs remaining exists (§3.2.1) | Code presence; scheduled dispatch being off |
| 4b | **Scheduled / queue dispatch** | A caller exists *and* the scheduled-dispatch ceiling permits *and* the authority gate is `LIVE` | A manual grant. **4a never implies 4b** — a bounded manual grant authorizes exactly the runs it names and nothing recurring |
| 5 | **Execution enablement** | Registry `executionEnabled` **and** the runtime authority gate (§3.2) both permit | Reachability |
| 6 | **Human approval** | A durable, hash-bound approval decision by a person | Everything above |
| 7 | **Publication** | The existing Phase 0A publication guard passing immediately before each provider request | Approval alone |

**PROPOSED invariants:**

- **Layer 5 has two independent components** that must *both* permit: the static registry field, and
  the mutable runtime authority gate. Neither alone suffices. They are changed by different means, by
  different people, at different times, and are audited separately.
- **Layer 6 is mandatory and cannot be bypassed.** **VERIFIED** that the merged code has no
  autonomy/boolean bypass.
- **Layer 7 is per-request, not per-run.** **VERIFIED** merged behavior.
- **Dry-run mode makes provider and publishing actions impossible, not merely skipped.** **VERIFIED**
  that simulated dry run scrubs the sensitive environment and forces test mode before
  configuration-bearing imports.

### 3.2 The runtime authority gate — PROPOSED, does not exist today

**This control does not exist in the repository. It is PROPOSED and requires its own implementation
slice (§6, P1), including a migration. Nothing in this section describes current behavior.**

Environment variables alone **cannot** provide what an emergency disable requires. Stated plainly, so
the earlier draft's error is not repeated:

- A process reads its environment at start. Changing an environment variable does not change the
  behavior of an already-running process.
- On Render, changing a service environment variable triggers a restart or redeploy of that service.
  So an environment variable is **not** a no-deployment control, and it is **not** immediate.
- **Therefore: three environment variables are not sufficient, and the earlier claim that they were
  is withdrawn.** Environment variables remain useful as a *deployment-time ceiling* — a service can
  be built such that it will never permit `LIVE` regardless of the gate — but the operational control
  must be something a process re-reads while running.

**PROPOSED design.** A durable, mutable control-plane value in PostgreSQL, distinct from both static
environment configuration and the registry `executionEnabled` fields:

- A single authoritative row — `content_intelligence_authority` — carrying `mode`, `changed_at`,
  `changed_by`, `reason`, and a monotonically increasing `version`.
- An append-only `content_intelligence_authority_history` table recording every transition. The
  current value is never updated without a history row in the same transaction.

**PROPOSED state model — exactly three modes, no others:**

| Mode | Meaning |
|---|---|
| **`OFF`** | No run may be accepted. No stage may start. No provider request of any kind. This is the default and the failure-safe value: an absent, unreadable, or unrecognized value is treated as `OFF` |
| **`SHADOW`** | Runs may execute stages and make **model-provider** requests. Approval transitions and publication are **prohibited**, and publication-provider requests are impossible |
| **`LIVE`** | Runs may execute stages, and results may proceed to the mandatory human approval gate and, only after it, to the publication guard. `LIVE` does **not** approve or publish anything by itself |

**PROPOSED — the gate is read at five points, every time, never cached across them. Every checkpoint
has a named owning implementation PR; a checkpoint with no owner is a checkpoint nobody builds:**

| # | Checkpoint | Enforced in | Owning PR (§6) |
|---|---|---|---|
| **C1** | Before accepting a new run | `runContentIntelligenceRun` run-acceptance path | **P3** |
| **C2** | Before **every** stage starts | `invokeStage` (`src/harness/agents/stageExecution.ts`) | **P2** |
| **C3** | Before **every** provider request of any kind | the stage request boundary (`src/harness/sdk.ts`) | **P2** |
| **C4** | Before any approval transition | the approval decision path on the api | **P5** |
| **C5** | Before any publication | the publication handoff on the worker, in front of the existing Phase 0A guard | **P6** |

**C4 and C5 are not implied by C1–C3.** A run that legitimately produced stage results under `SHADOW`
must still be refused at the approval and publication boundaries, and those boundaries are reached by
existing production code paths that know nothing about this gate today. They therefore need their own
implementation PRs (**P5** and **P6**), in the services that own them — approval on the api,
publication on the worker. Adding C4 and C5 is the only part of this design that touches an existing
production path, which is why each is its own separately reviewed PR rather than a clause inside
another.

Turning the gate to `OFF` therefore prevents a new run from being accepted, prevents any subsequent
stage from starting, and prevents any subsequent provider request — without a deployment, and taking
effect at the next check rather than at the next restart.

**PROPOSED — what disabling cannot do, stated honestly.** A network request already in flight is
**not cancellable by this gate**, and this design does not claim otherwise. The guarantee is narrower
and precise:

> When an in-flight request resolves after the gate has moved to `OFF`, its result **must not**
> authorize a subsequent stage, an approval transition, or a publication. The result may be persisted
> for audit. The run then terminalizes in an explicit `operator_disabled` state, distinct from
> `failed` and from `completed`.

So the honest promise is: **no new work after the switch, and no forward progress from work already
in flight** — not "the in-flight request stops."

**PROPOSED — how the control is changed, audited, authorized, and rolled back:**

- **Changed by:** an authenticated console route on the API (behind the existing `/console/*` gate),
  or by an authorized operator statement against the database. Both write the history row in the same
  transaction as the value.
- **Audited by:** the append-only history table, plus a durable event. Every transition records who,
  when, from what, to what, and why.
- **Authorized by:** a named human per transition. `OFF → SHADOW` and `SHADOW → LIVE` are separate
  authorizations and must not be granted together (§6, M3 and M7).
- **Rolled back by:** setting the mode back to `OFF`, which requires no deployment and no code change.
  Rolling *back* needs no authorization ceremony; rolling *forward* always does.

### 3.2.1 The bounded manual-dispatch grant — PROPOSED, does not exist today

**This is the second thing the earlier draft was missing.** It said shadow runs would be "operator
triggered, not scheduled", but named no control that *permits* an operator-triggered run — while the
dispatch ceiling denied dispatch outright. Under that draft, checkpoint C1 would have refused every
shadow run, so shadow execution was unreachable.

**PROPOSED** — a durable, bounded, expiring grant, stored in the same control plane as the authority
gate and created by the same authenticated route:

| Field | Meaning |
|---|---|
| `runs_remaining` | A positive integer, decremented **transactionally at run acceptance**, in the same transaction that creates the run row. At zero the grant is spent |
| `granted_by`, `granted_at`, `reason` | Who authorized it, when, and why. Recorded in the append-only history |
| `expires_at` | A wall-clock expiry. An expired grant is spent whatever `runs_remaining` says |
| `max_authority` | The highest authority mode this grant may run under. For a shadow grant this is `SHADOW`, never `LIVE` |

**PROPOSED invariants:**

- **A grant is consumed, not merely checked.** Decrementing in the run-acceptance transaction makes a
  bounded grant genuinely bounded under concurrency and under retry; a grant that were only *read*
  would authorize an unbounded number of runs.
- **A grant authorizes nothing recurring.** It is checked only on the manual acceptance path. The
  scheduler and the queue consumer consult the **scheduled-dispatch** ceiling (layer 4b) and never a
  grant, so an unspent grant can never make a schedule fire.
- **A grant cannot raise authority.** The effective mode remains the *lower* of the deployment-time
  ceiling, the gate, and the grant's `max_authority`. A grant issued while the gate reads `OFF`
  permits nothing.
- **A grant cannot bypass C4 or C5.** It authorizes run *acceptance* only. Approval and publication
  remain governed by their own checkpoints and by layers 6 and 7.
- **Revocation is immediate and needs no deployment:** set `runs_remaining` to zero, or set the gate
  to `OFF`, which denies at C1 regardless of any grant.

Schema and reader land in **P1**; consumption at run acceptance lands in **P3**.

### 3.3 Distinguishing the four controls

These are four different things and must never be collapsed:

| Control | Where it lives | Who changes it | When it takes effect | Changed at |
|---|---|---|---|---|
| Registry `executionEnabled` | Source (`registry.ts`) | A reviewed, merged PR — **P8** | On deployment of that commit | M3 |
| Proposed environment variables | Render service configuration | An operator, per service | On service restart/redeploy — a deployment-time **ceiling**, not an operational switch | manual ceiling at M3; scheduled ceiling at M7 |
| **Proposed runtime authority gate** | Durable control-plane row | An authorized human via console route or authorized statement | At the next gate check — **no deployment** | `SHADOW` at M3, `LIVE` at M7 |
| **Proposed manual-dispatch grant** (§3.2.1) | Durable control-plane row, bounded and expiring | An authorized human, per grant | At the next run acceptance, which **consumes** it — **no deployment** | issued at M3, spent during M4 |

The registry field and the gate are the two halves of layer 5; the environment variables are ceilings
over both dispatch halves and over the gate; the grant is what actually admits an individual manual
run. **None of the four implies another**, and no single act changes more than one.

### 3.4 Rollback and emergency disable

**PROPOSED**, least to most disruptive:

1. **Set the authority gate to `OFF`.** No new runs; no further stages; no further provider requests;
   no approval transition and no publication (C4, C5); in-flight work cannot progress. **No
   deployment.**
2. **Zero any outstanding manual-dispatch grant** (§3.2.1), which denies at C1 independently of the
   gate. **No deployment.** Either of steps 1 and 2 alone stops new runs; doing both is the default.
3. **Lower the dispatch ceilings** — scheduled first, then manual. Requires a service restart, so it
   is slower than steps 1 and 2 and is a follow-up to them, never the first response.
4. **Revert P8**, returning every registry `executionEnabled` to `false`. A one-file change, but it
   needs a deployment, so it ranks below the gate and the grant.
5. **Revert the release.** Ordinary application rollback, safe only if the code being rolled back
   to tolerates the applied migration set — the property that was tested for 006.
6. **Revert the merge.** Repository-level.

**PROPOSED** — 007's rollback file relaxes the **database only**. The TypeScript contract still
refuses an oversized record, so the system continues to fail closed after a rollback. Rolling back 007
is not a way to accept larger evidence.

---

## 4. Migration 007

**This design treats the production audit as NOT YET EXECUTED.**

### 4.0 How 007 actually reaches production — VERIFIED, and load-bearing

**VERIFIED** — `src/state/migrate.ts` is a forward-only runner that applies **every** not-yet-applied
`state/migrations/*.sql` in lexical order, recording each in `_migrations`. It has no per-file
selector: `npm run migrate` applies whatever is pending.

**VERIFIED** — `render.yaml` gives `gcd-social-api` `preDeployCommand: npm run migrate`.

**Therefore, and this governs §6's ordering:**

- **007 is not separately triggerable by deployment.** The *first* `gcd-social-api` deployment of any
  commit containing `007_evidence_bounds.sql` will apply it, along with anything else pending.
- **Any release carrying an unapplied migration is a migration-bearing release** and must go through
  the separately authorized migration-bearing rollout — not the ordinary controller path. **VERIFIED**
  that the deployment controller already stops before any service action when the release range
  touches `state/migrations/**`, which is the mechanism that makes this enforceable rather than
  merely intended.
- **Consequently the §4 gates below must be satisfied *before* that deployment, not after it.** A
  deployment performed first would apply 007 as a side effect, with no audit, no decision record, and
  no post-apply validation. That is why §6 places the 007 rollout (M1) **before** the inert-code
  deployment (M2) **and before P1 merges at all**, and why M2 — which carries migration 008 from P1 —
  is itself migration-bearing.
- **The runner cannot be told to apply one file, and cannot be run on its own.** It is reached only
  through the api `preDeployCommand`, so **applying a migration is an API deployment**; selecting a
  migration is expressed by controlling what the deployed artifact contains, never by an argument.
  See §4.4, including the requirements that follow from it being a deployment.
- The same reasoning applies to 008 and to every future migration; nothing here is specific to 007.

### 4.1 Prerequisite — a fresh, read-only, aggregate-only operator audit

**REQUIRES OPERATOR ACTION.** Run independently by an authorized operator, not from an agent session.
The checked-in, read-only, aggregate-only audit shape is the prerequisite. It must:

- run in read-only transactions;
- return **aggregates only** — counts, existence, maxima — and **never** raw claim text, subject text,
  PII, or credential values;
- request and receive **no** database credential on behalf of any agent session;
- establish, for `content_evidence` and `content_evidence_relations`: row counts; the maximum length
  of every text column 007 constrains, in **both** characters and UTF-8 bytes; the maximum canonical
  `jsonb::text` byte length of `detail`; tag-array cardinality and per-element length maxima,
  including NULL elements; and relation-note maxima.

**PROPOSED** — bounds are **not** chosen from this audit, and not from any document. They are already
derived in `payloadContract.ts` from the product contracts. The audit answers exactly one question:
*can the immediately validated constraints pass against the data actually stored?* If any measured
maximum exceeds its bound, the answer is no and the apply does not proceed.

### 4.2 The decision record

**PROPOSED** — after the audit, before any apply, a decision record is committed to the repository
containing: the audit date and operator; the exact aggregate results; each measured maximum against
its bound; the explicit go/no-go; the named authorizer; and the planned rollback trigger. **An apply
with no committed decision record is unauthorized by definition.**

### 4.3 Apply, validate, rollback, collision and reapply gates

**PROPOSED / REQUIRES OPERATOR ACTION**, in order, each a stop point:

| Gate | Requirement | Stop condition |
|---|---|---|
| **G1 Audit** | §4.1 complete, results committed | Any measured maximum exceeds its bound |
| **G2 Decision** | §4.2 record committed and authorized | Missing, unsigned, or stale |
| **G3 Rollout path** | The separately authorized migration-bearing rollout, **not** the ordinary controller path | **VERIFIED** the controller already stops before any service action when the release range touches `state/migrations/**` |
| **G3a Pending-set verification** | The exact pending set is computed and recorded **immediately before** the runner is invoked, and equals the authorized set **exactly** — see §4.4. Required before **every** use of the general migration runner, including the one the api `preDeployCommand` triggers | The computed set differs from the authorized set by **even one file** → stop; do not run the runner, do not trigger the deploy |
| **G3b Controlled artifact** | The **deployed artifact** is a named exact reviewed commit meeting every requirement A1–A5 of §4.4 — its `state/migrations/` contains exactly the authorized set, its application code is approved to deploy and serve, and it is not an ancestor of what is live. Applying a migration **is an API deployment** (§4.4); selection comes only from what the artifact contains, never from the runner | Any of A1–A5 fails; or the artifact's migrations directory contains a file outside the authorized set |
| **G4 Single runner** | Exactly one migration authority; no schema-dependent consumer racing it | More than one runner, or a consumer started early |
| **G5 Transactional apply, by the only sanctioned authority** | Applied by `npm run migrate` **through the api `preDeployCommand`**, which wraps each file in `BEGIN…COMMIT`. **VERIFIED** ([`ROLLOUT_PHASE_0B0.md`](ROLLOUT_PHASE_0B0.md) §5) that this is the repository's standing rule and the one under which 006 was applied | Applied by hand via `npm run migrate` or `psql -f` — both are prohibited by that rule, and `psql -f` additionally disables the `SET LOCAL` timeout guards silently. Neither is an escape hatch for applying one file: **G3b is**, by controlling what the artifact contains |
| **G6 Collision** | 007's helper uses plain `CREATE`, so an exact-name collision aborts without overwriting | Collision detected → abort, do not force |
| **G7 Post-apply validation** | `_migrations` holds `007` exactly once; **`_migrations` contains no file that was not in the authorized set**; every constraint present; a boundary record inserts and an over-bound one is rejected | Any check fails → rollback per `state/rollback/007_evidence_bounds_rollback.sql`. An unauthorized file having been applied is an incident, not a variance |
| **G8 Reapply** | Only after the cause is fixed and the audit re-run | Reapplying over unexplained failure |

**PROPOSED** — 007 must **not** be applied in the same change as deployment, enablement, or
publication (§6).

### 4.4 Applying 007 is an API deployment — there is no selective runner and no standalone run

**VERIFIED** — `npm run migrate` applies *every* pending file. There is no flag, argument, or
environment variable that selects one. "Apply only 007" cannot be expressed to the runner.

**VERIFIED** — `render.yaml` gives `preDeployCommand: npm run migrate` to `gcd-social-api` and to no
other service.

**VERIFIED** — [`docs/ROLLOUT_PHASE_0B0.md`](ROLLOUT_PHASE_0B0.md) §5 states the operating rule this
repository already follows: *"Let the API pre-deploy command be the only migration authority… **Do not
run `npm run migrate` by hand, and do not apply the SQL through `psql`**."* That rule is what makes
gate G4's "exactly one migration runner" true, and it is the rule migration 006 was actually applied
under.

**Therefore, stated plainly and without euphemism:**

> **Applying a migration to production is an API deployment.** The runner is reached only through the
> api's `preDeployCommand`, so the commit whose migrations are applied is also the commit whose
> **application image is deployed to `gcd-social-api`**. There is no sanctioned way to run the
> migration alone.

**Selection is therefore achieved only by controlling the deployed artifact's migration set.** It is
**not** a selective runner, and this design must not be read as describing one: nothing selects a
migration; the artifact simply does not contain any migration beyond the authorized set.

#### The invariant that keeps this simple

**PROPOSED, and the only path this design sanctions:**

> **P1 — and therefore migration 008 — must not merge until M1 is complete and verified** (§6, P1
> entry gate; M1 prohibitions).

With that invariant held, the M1 artifact is the **reviewed head of `main` at M1 time**: it contains
`001`–`007` and no later migration, its application code is the current reviewed code, and deploying
it is an **ordinary forward deployment, not a version rollback**. The pending set is `{007}` at M1 and
`{008}` at M2 by construction. No older artifact is needed, and this design does not propose one.

**If 008 has already merged, the invariant was violated and M1 does not proceed under this
procedure.** Deploying an older artifact to force the pending set would be an application-version
rollback dressed up as a migration, and this design does not sanction it. The correct response is to
stop, re-plan, and obtain a fresh authorization and decision record covering **every** file in the
actual pending set — because at that point both files really are pending and pretending otherwise is
the failure this section exists to prevent.

#### Requirements on the M1 artifact — all five, each a stop point

| # | Requirement | Stop condition |
|---|---|---|
| **A1** | An **exact reviewed commit**, named by full SHA in the §4.2 decision record, with exact-head CI green | Any ambiguity about which commit; a branch name or tag instead of a SHA |
| **A2** | Its `state/migrations/` contains **`001`–`007` and no later migration** — enumerated and recorded, not assumed | Any file beyond `007` present |
| **A3** | Its **application code is approved as safe to deploy and safe to serve**, both before the migration and after it — reviewed as a deployment on its own terms, not waved through because the point of the exercise is the schema | Application code not separately approved for deployment |
| **A4** | A **production pending-set check returning exactly `{007_evidence_bounds.sql}`** (G3a), computed against the target database immediately before the deploy is triggered | The set differs by even one file |
| **A5** | The artifact is **not an ancestor of the currently deployed commit** — established by read-only verification of the running service, never assumed | The artifact is older than what is live ⇒ this is a version rollback ⇒ stop; it needs its own authorization and its own review |

#### Because it is a deployment, these must also be satisfied

**REQUIRES OPERATOR ACTION**, recorded:

- **Exact deployed identity before.** Read the currently deployed commit from each running service,
  read-only, and record it. **UNKNOWN until read** — see below.
- **Exact deployed identity after.** Read it again and confirm `gcd-social-api` reports the artifact
  commit, and that the worker and scheduler are **unchanged** — M1 deploys the api alone, which is
  what makes it a single migration runner (G4).
- **Health verification.** The api's `healthCheckPath: /healthz` must pass after the deploy, and the
  durable health/readiness checks the repository already exercises must be observed green before the
  milestone is called complete.
- **Safe to serve after the migration.** 007 tightens database constraints that the TypeScript
  contract in the same artifact already enforces more strictly, so the artifact is expected to serve
  correctly under the tightened schema — but that expectation is **verified after the apply**, by the
  health check and by G7's boundary-record probe, not assumed from the derivation.
- **Rollback.** Redeploy the exact commit recorded as previously deployed. Note the two rollbacks are
  independent: redeploying the prior application image does **not** unapply 007, and
  `state/rollback/007_evidence_bounds_rollback.sql` relaxes the database only. If both are needed they
  are two separately authorized operations, in that order.

#### The pending-set verification itself (G3a)

Performed immediately before the deployment is triggered, against the exact artifact commit:

```
applied  := SELECT name FROM _migrations ORDER BY name;      -- read-only, from the target database
present  := the *.sql files in state/migrations/ at that exact commit
pending  := present − applied
```

The operator records `applied`, `present`, `pending`, and the artifact SHA, then compares `pending` to
the set named in the §4.2 decision record. **They must be equal as sets.** Larger, smaller, or
differently composed all stop the milestone — no partial run, no "apply it and check after". **There
is no opportunity to intervene once the deploy starts**, which is why this check precedes the trigger
rather than the apply.

#### What is not known

**UNKNOWN** — the commit each service currently runs, and the current contents of `_migrations`.
Neither was inspected by this design, and neither may be inferred from `render.yaml`, from any dated
record in this repository, or from the fact that a commit is merged to `main`. **Repository state is
not evidence of live deployment identity or live migration state.** Both must be established by
read-only verification at the time of the milestone, and A5 and A4 both depend on that reading.

---

## 5. Render topology

**Everything about live Render state in this section is UNKNOWN.** No Render inspection was performed
in this session, and none was authorized.

### 5.1 Repository blueprint — VERIFIED from `render.yaml`

| Service | Type | Start command | Role today |
|---|---|---|---|
| `gcd-social-api` | web | `npm run start:api` | Health, protected control/console routes, approval review/action, media. Runs `npm run migrate` as `preDeployCommand` |
| `gcd-social-worker` | worker | `npm run start:worker` | Queue consumption, orchestration, approval wait, the only publication handoff |
| `gcd-social-scheduler` | cron `0 13 * * *` | `npm run start:scheduler` | Enqueues one brief daily; does not publish |
| `gcd-social-db` | PostgreSQL | — | Durable state |

### 5.2 Proposed ownership — prefer existing infrastructure

**PROPOSED** — no new Render service:

| Responsibility | Owner | Rationale |
|---|---|---|
| Run dispatch / orchestration | **worker** | Already holds exclusive ownership, recovery, and the long-running execution model |
| Manual-dispatch grants | **api** | Already owns the authenticated `/console/*` surface, alongside the authority gate |
| Stage execution | **worker** | Already the only service with `ANTHROPIC_API_KEY` |
| Scheduling | **scheduler** | Already enqueues; would enqueue a run request, never execute one |
| Approval review/decision | **api** | Already owns the approval routes and the hash-bound decision |
| Authority-gate changes | **api** | Already owns the authenticated `/console/*` surface |
| Publication | **worker** | Already the only publication handoff |
| Migration authority | **api** `preDeployCommand` | Already the single migration runner |

### 5.3 Proposed configuration — described, not created

**PROPOSED, NOT CREATED.** No variable below exists; none was added; `render.yaml` is unmodified.

| Proposed variable | Owner | Purpose | Default |
|---|---|---|---|
| `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED` | worker, scheduler | Deployment-time ceiling on **layer 4b only** — scheduled and queue-driven dispatch. It governs no manual run | absent ⇒ disabled |
| `CONTENT_INTELLIGENCE_MANUAL_DISPATCH_ENABLED` | worker, api | Deployment-time ceiling on **layer 4a** — whether a bounded manual-dispatch grant may be honoured at all. A ceiling, not a grant: with this `true` and no grant, nothing runs | absent ⇒ disabled |
| `CONTENT_INTELLIGENCE_MAX_AUTHORITY` | worker, api | Deployment-time **ceiling** on the authority gate (`OFF`/`SHADOW`/`LIVE`); the effective mode is the *lower* of this, the gate, and any grant's `max_authority` | absent ⇒ `OFF` |

**The two dispatch ceilings are deliberately separate variables, not one.** Collapsing them would
make authorizing a single shadow run also authorize the daily schedule — precisely the conflation
this design exists to prevent. Manual dispatch is raised at M3 and scheduled dispatch not until M7.

**These variables are ceilings, not the operational control.** The mutable runtime authority gate
(§3.2) is what an operator turns off in an emergency, and the bounded grant (§3.2.1) is what actually
permits a run. Every value defaults to *off when absent*, so a service that never received the
variable is safe rather than enabled.

**Deployment ordering:** every migration reaches production through an api deployment (§4.4), so
"database first" means **an api-only deployment first**. 007 under M1, at an artifact meeting A1–A5
and **before P1 merges**, deploying the api alone so it is the single migration runner; then 008 as
part of the migration-bearing release in M2, again with the pending set verified against the exact
commit **before the deploy is triggered** → api → worker → scheduler, matching the merged controller's
existing serialized order. **Manual dispatch is permitted at M3 and scheduled dispatch only at M7**,
each under its own authorization, and neither is implied by any deployment.

**UNKNOWN** — whether the deployment automation gate is currently on, whether native auto-deploy is
off, and what the services currently run. Each must be re-verified read-only immediately before any
production operation; none may be inferred from `render.yaml` or from this document.

---

## 6. Rollout sequence

**PROPOSED.** The sequence contains **eight implementation PRs (P1–P8)** and **seven operator
milestones (M1–M7)**. They are different kinds of thing and are numbered separately: a PR is reviewed
and merged; a milestone is performed by an authorized operator and produces an evidence record, not a
diff. **Every source change is a numbered PR — including the one that activates the stages.** A code
change hidden inside a milestone is a code change nobody reviewed as code.

**No step combines enablement or publication with anything else.** Migration application and
deployment cannot be fully separated — §4.0 establishes that the api `preDeployCommand` applies
whatever migration is pending — so where a release is unavoidably migration-bearing (M2), it is
declared as such, takes the migration-bearing rollout with pending-set verification (§4.4), and gets
post-apply validation, rather than being described as a plain deploy.

### The sequence at a glance

| Step | Kind | What changes | Dispatch after it | Authority after it |
|---|---|---|---|---|
| **M1** | operator | **API deployed at the artifact commit**; migration 007 applied and validated by its `preDeployCommand` | none | `OFF` |
| **P1** | PR | Control plane + migration 008 + grant schema. *Must not merge before M1* | none | `OFF` |
| **P2** | PR | Checkpoints **C2, C3** at the execution boundary | none | `OFF` |
| **P3** | PR | Dispatch skeleton + checkpoint **C1** + grant consumption | none | `OFF` |
| **P4** | PR | Worker integration behind both dispatch ceilings | none | `OFF` |
| **P5** | PR | Checkpoint **C4** — approval transition (api) | none | `OFF` |
| **P6** | PR | Checkpoint **C5** — publication (worker) | none | `OFF` |
| **P7** | PR | Observability, audit records, metrics | none | `OFF` |
| **M2** | operator | API, worker and scheduler deployed at P1–P7, inert; migration 008 applied and validated by the api `preDeployCommand` | none | `OFF` |
| **P8** | PR | **Activation:** registry `executionEnabled` → `true` | none | `OFF` |
| **M3** | operator | Deploy P8; raise authority to `SHADOW`; issue a bounded manual grant | **manual only, bounded** | `SHADOW` |
| **M4** | operator | Execute the granted shadow runs | manual, grant draining | `SHADOW` |
| **M5** | operator | Collect and review evidence | none (grant spent) | `SHADOW` or `OFF` |
| **M6** | operator | Promotion decision | none | `SHADOW` or `OFF` |
| **M7** | operator | Raise scheduled dispatch and authority to `LIVE` | **scheduled + manual** | `LIVE` |

**Scheduled and queue dispatch is off at every step until M7. Approval and publication are refused at
C4 and C5 at every step until the authority gate reaches `LIVE`, and even then remain governed by
layers 6 and 7 independently.**

### Implementation PRs

#### P1 — Durable schema: runs, stage results, the authority control plane, and dispatch grants

**Entry gate — P1 must not merge until M1 is complete and verified.** P1 introduces migration 008. If
it merges first, the pending set at M1 becomes `{007, 008}` and the deployment that applies 007 would
apply 008 with it, unaudited (§4.0, §4.4). **This ordering is the whole mechanism, not a preference:**
because the runner is reachable only through the api `preDeployCommand`, keeping 008 out of the
repository is what lets M1 be an ordinary forward deployment of current reviewed code. §4.4 states
what happens if the invariant is broken — M1 stops and is re-planned; it is not worked around by
deploying an older artifact.

**This PR is first among the PRs because P2 cannot enforce a gate that has nowhere to live.** The
boundary checks in P2 read the authority value; the table, the grant, and their contract must exist
before those checks can be written or tested.

- **Change:** additive migration (008) for `content_intelligence_runs`,
  `content_intelligence_stage_results`, `content_intelligence_authority` and its append-only history,
  and `content_intelligence_dispatch_grants` (§3.2.1) — plus rollback file, TypeScript contracts, and
  a reader that resolves the effective mode as the lower of ceiling, gate, and grant. The authority
  row is seeded `OFF`; **no grant row is seeded.**
- **Exit:** disposable PostgreSQL 16/18 apply / enforce / rollback / reapply coverage; regressions
  prove an absent, unreadable, or unrecognized mode resolves to `OFF`, that an absent grant authorizes
  nothing, and that an expired or zero-`runs_remaining` grant is spent.
- **Rollback:** revert; 008 has not been applied to production by this PR.
- **Prohibited:** applying **any** migration to production; wiring a caller; changing any
  `executionEnabled` value; touching `render.yaml`.

#### P2 — Checkpoints C2 and C3 at the execution boundary *(no caller yet)*

- **Entry:** P1 merged.
- **Change:** `invokeStage` refuses unless **both** the stage's registry `executionEnabled` is true
  **and** the runtime authority gate permits (**C2**); the stage request boundary re-reads the gate
  immediately before the provider request (**C3**). Layer 5 becomes real in both halves.
- **Exit:** regressions prove a stage refuses with **zero** runner calls when either component
  withholds permission, that neither alone suffices, and that C3 refuses even when C2 passed and the
  gate moved in between.
- **Tests:** offline suite plus mutations removing each half, each failing its owning check.
- **Rollback:** revert.
- **Prohibited:** adding any caller; changing any `executionEnabled` value; touching `render.yaml`.

#### P3 — Dispatch skeleton and checkpoint C1, inert, with real reachability protection

- **Entry:** P1, P2 merged.
- **Change:** `runContentIntelligenceRun` exists. Its run-acceptance path enforces **C1** and consumes
  a manual-dispatch grant transactionally (§3.2.1) — decrement and run-row creation commit together or
  not at all. **This is the PR that introduces a caller**, so it carries the stronger protection
  required by §1.3.1: transitive dependency/call-graph coverage where practical, **and** executed
  integration tests proving disabled and unauthorized entry points reach no executor with **zero**
  runner invocations.
- **Exit:** with the gate `OFF` (the seeded default) and no grant, a dispatch attempt refuses before
  any stage, proven by execution rather than by source text; a grant with `runs_remaining: 1` admits
  exactly one run and the second is refused, proven under concurrent acceptance.
- **Prohibited:** changing the authority gate; issuing any grant; any provider call; any promotion of
  output.

#### P4 — Worker integration behind both dispatch ceilings

- **Entry:** P3 merged.
- **Change:** the worker can execute an accepted run. The scheduler and queue consumer consult the
  **scheduled**-dispatch ceiling only and never a grant.
- **Exit:** with both ceilings at their defaults, worker and scheduler behavior is byte-identical to
  today, proven by the existing suites; a regression proves an unspent grant cannot make the scheduler
  fire.
- **Prohibited:** permitting either dispatch ceiling anywhere; publication paths.

#### P5 — Checkpoint C4: the approval-transition gate *(api)*

**This PR exists because C4 had no owner.** Nothing in P1–P4 touches the approval path, so without it
a `SHADOW` run's output could reach the approval boundary and be transitioned by the existing code,
which knows nothing about the gate.

- **Entry:** P1 merged (needs the reader).
- **Change:** the approval decision path reads the authority gate immediately before any approval
  transition and refuses unless the mode is `LIVE`. `SHADOW` and `OFF` both refuse.
- **Exit:** executed tests prove an approval transition is refused under `OFF` and under `SHADOW`,
  with the existing hash-bound decision behavior unchanged under `LIVE`; a mutation removing the check
  fails its owning test.
- **Touches an existing production path**, so it is reviewed on its own and ships with no behavior
  change while the gate is `OFF` — which it is until M3.
- **Prohibited:** weakening or bypassing layer 6; changing approval semantics beyond adding refusal.

#### P6 — Checkpoint C5: the publication gate *(worker)*

**This PR exists because C5 had no owner**, for the same reason as P5.

- **Entry:** P1 merged.
- **Change:** the publication handoff reads the authority gate immediately before each publication and
  refuses unless the mode is `LIVE`, **in front of** — never instead of — the existing Phase 0A
  publication guard. Layer 7 is unchanged and still per-request.
- **Exit:** executed tests prove publication is refused under `OFF` and under `SHADOW`; the existing
  guard's own refusals are unchanged; a mutation removing the check fails its owning test; the
  publication-provider request count is **zero** in both refused cases.
- **Prohibited:** replacing, relaxing, or reordering the existing publication guard.

#### P7 — Observability, audit records, metrics

- **Change:** structured run/stage audit records and metrics (§7), including grant issuance and
  consumption and every C1–C5 refusal by checkpoint. No behavior change.
- **Prohibited:** logging prompts, model prose, credentials, or evidence text.

#### P8 — Activation: registry `executionEnabled` → `true`

**This is a source change and is numbered as one.** The earlier draft buried it inside milestone M3
while claiming the sequence held five implementation PRs — so the single change that arms every stage
was the one change with no PR number, no stated entry gate, and no review record of its own.

- **Entry:** P1–P7 merged; **M2 complete and verified** (the inert implementation deployed, all gates
  reading `OFF`).
- **Change:** the six registry entries' `executionEnabled` values, and nothing else. No logic, no
  schema, no configuration, no `render.yaml`.
- **Why it is safe to merge before shadow is authorized:** with P2 merged, `executionEnabled: true`
  satisfies only *half* of layer 5. The authority gate still reads `OFF`, so C1–C3 refuse, and the
  registry flag alone changes nothing observable — the same fact §1.3.2 records about today's flag,
  now true in the opposite direction.
- **Exit:** the offline suite passes with all six `true`; a regression proves that with the gate `OFF`
  a dispatch attempt still refuses with **zero** runner invocations; the dry run is unchanged.
- **Deployed at M3, not at merge.** Merging arms nothing; deployment arms nothing either, because the
  gate is what withholds permission.
- **Rollback:** revert this PR — a one-file change — and redeploy; or set the gate to `OFF`, which is
  faster and needs no deployment.
- **Prohibited:** any other change in the same PR; changing the authority gate; issuing a grant.

### Operator milestones

#### M1 — Migration 007 rollout, which is an API deployment *(REQUIRES OPERATOR ACTION)*

**This is first because of §4.0 and §4.4.** The runner sweeps every pending file and is reachable only
through the api `preDeployCommand`, so applying 007 **is a deployment of `gcd-social-api` at the
artifact commit** — not a standalone database operation. Doing it first, while `main` still carries no
migration beyond `007`, is what keeps that deployment an ordinary forward deployment of current
reviewed code rather than anything more complicated.

- **Entry:** §4 gates G1–G2 satisfied; decision record committed, naming the authorized set as exactly
  `{007_evidence_bounds.sql}` **and naming the artifact commit by full SHA**. **P1 has not merged** —
  that is this milestone's protecting invariant, not a convenience.
- **The artifact** is the reviewed head of `main` at this time and must satisfy **A1–A5** of §4.4:
  an exact reviewed commit with exact-head CI green; `001`–`007` and no later migration, enumerated;
  application code separately approved as safe to deploy **and safe to serve**; a production
  pending-set check of exactly `{007_evidence_bounds.sql}`; and **not an ancestor of the currently
  deployed commit**. **Any mismatch stops the milestone.**
- **Action:**
  1. **Record exact deployed identity before** — read the commit each of the three services is running
     from the running system, read-only. It is **UNKNOWN until read** and may not be inferred from
     `main`, from `render.yaml`, or from any dated record here.
  2. **A5** — confirm the artifact is not an ancestor of what `gcd-social-api` currently runs. If it
     is, this would be an application-version rollback: **stop**, and obtain its own authorization and
     review before going further.
  3. **G3a** — compute and record `applied`, `present`, `pending` and the artifact SHA per §4.4,
     against the target database, **before triggering the deploy**. **Stop unless `pending` is exactly
     `{007_evidence_bounds.sql}`.** There is no intervention point once the deploy starts.
  4. **Deploy `gcd-social-api` at the artifact commit, and nothing else** — not the worker, not the
     scheduler. Its `preDeployCommand` is the single migration authority (G4, G5), which is exactly
     why only the api is deployed.
- **Exit, all required:**
  1. G6 and G7 pass; `_migrations` holds `007` exactly once and **no file outside the authorized set**;
  2. **exact deployed identity after** — `gcd-social-api` reports the artifact commit; the worker and
     scheduler report **unchanged** commits;
  3. **health verification** — `/healthz` passes and the durable health/readiness checks are observed
     green;
  4. **safe to serve under the tightened schema** — confirmed by the health check and by G7's
     boundary-record probe, not assumed from the derivation.
- **Rollback, defined before proceeding — two independent operations, in this order:** redeploy the
  exact commit recorded in step 1 as previously deployed (this does **not** unapply 007); then, only if
  separately authorized, apply `state/rollback/007_evidence_bounds_rollback.sql`, which relaxes the
  database only — the TypeScript contract still refuses an oversized record.
- **Prohibited:** combining with any code change beyond the artifact itself, any new behavior, or any
  enablement; deploying the worker or scheduler; running `npm run migrate` or `psql -f` by hand;
  **merging P1 before this milestone is verified.**

#### M2 — Deploy the inert implementation, and verify it *(REQUIRES OPERATOR ACTION)*

**This milestone exists because deployed behavior cannot be tested before it is deployed.** P1–P7 are
merged but, until this milestone, not running anywhere.

- **Entry:** M1 complete and verified; P1–P7 merged; exact-head CI green. **P8 is deliberately not
  included** — this milestone deploys inert code, and P8 is what arms the registry.
- **This release is migration-bearing.** P1 adds migration 008, and the api `preDeployCommand` will
  apply it (§4.0). So this deployment uses the **separately authorized migration-bearing rollout**,
  not the ordinary controller path, and 008 gets the same G3a–G7 discipline 007 received:
  1. **G3a before triggering the deploy** — compute and record the pending set **against the exact
     commit about to be deployed**. **Stop unless it is exactly `{008_...sql}`.** There is no
     opportunity to intervene once the deploy starts.
  2. one runner, transactional apply, post-apply validation.
  008 needs no data audit — it creates new tables and validates nothing against existing rows — but it
  still needs its own authorization and its own post-apply check.
- **Action:** **record the exact deployed commit of each service first, read-only** — it is UNKNOWN
  until read and may not be inferred from `main` or from M1's record — then deploy **only** the
  reviewed inert code, in the order api → worker → scheduler.
- **Leaves unauthorized:** both dispatch ceilings, live execution, approval, publication. Nothing is
  enabled and no grant exists.
- **Verify, and record:**
  1. the exact deployed commit on each of the three services, compared against the reading taken
     before the deploy, and `/healthz` plus the durable health/readiness checks observed green;
  2. that the new entry point is **unreachable through normal production traffic** — no route, no
     schedule, and no queue path invokes it;
  3. that **every effective runtime gate reads `OFF` or disabled** — the seeded authority row, both
     dispatch ceilings, and the authority ceiling, each read from the running system rather than from
     configuration files;
  4. that all six registry `executionEnabled` values remain `false` in the deployed commit;
  5. that `_migrations` holds `007` and `008` exactly once each, and nothing unauthorized;
  6. that `content_intelligence_dispatch_grants` holds **zero** rows.
- **Rollback, defined before proceeding:** revert to the prior release, then — only if required —
  apply 008's rollback file by hand under its own authorization. Because 008 is purely additive and
  the prior release neither reads nor writes its tables, the prior release tolerates 008 remaining
  applied; that is the intended rollback, and dropping the tables is not part of it.
- **Prohibited:** enabling anything; any provider request; permitting either dispatch ceiling.

#### M3 — Pre-shadow authorization *(REQUIRES OPERATOR ACTION, separately reviewed)*

**This is the step the earlier draft was missing, and its absence made shadow execution impossible.**
It required stage results while every registry flag stayed `false`, and it named no control that would
permit an operator-triggered run.

- **Entry:** M1 and M2 complete and verified (007 and 008 applied and validated; the inert
  implementation deployed, verified, and reading `OFF`); **P8 merged with exact-head CI green.**
- **Exactly which controls change here, and nothing else — four acts, each separately authorized:**
  1. **Deploy P8**, arming the registry. This is a code deployment, performed and verified with the
     same discipline M2 defines, and it is **not** yet an enablement: with the gate `OFF`, C1–C3 still
     refuse. **This is why the earlier "every executor stays disabled while shadow produces stage
     results" sequencing was impossible: with P2 enforcing the registry field, stage results require
     the field to be true.**
  2. **Raise `CONTENT_INTELLIGENCE_MANUAL_DISPATCH_ENABLED`** on the worker and api — the layer-4a
     ceiling only. A ceiling, not a grant: with it raised and no grant, nothing runs.
  3. **Set the runtime authority gate to `SHADOW`**, by a named authorized human, recorded in the
     append-only history. `CONTENT_INTELLIGENCE_MAX_AUTHORITY` is raised to `SHADOW` — **never
     `LIVE`** — so the deployment-time ceiling cannot be exceeded even by mistake.
  4. **Issue exactly one bounded manual-dispatch grant** (§3.2.1) with an explicit small
     `runs_remaining`, an explicit `expires_at`, a named `granted_by`, a stated `reason`, and
     `max_authority: SHADOW`.
- **What deliberately does not change here:** `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED`
  remains **disabled**, so no schedule and no queue path can start a run; the authority ceiling is not
  raised to `LIVE`; approval and publication code is untouched, and C4 and C5 refuse under `SHADOW`.
- **Why this cannot permit scheduled live execution or publication:**
  - The **scheduled** dispatch ceiling is untouched and still disabled, and layer 4a never implies 4b
    (§3.1). The grant is consulted only on the manual acceptance path, so nothing recurring can start.
  - The grant is **bounded and expiring**, and consumed transactionally, so it authorizes exactly the
    runs it names — not a standing permission.
  - `SHADOW` refuses at **C4** and **C5**, which now have owning implementations (P5, P6), so no
    result can reach an approval transition or a publication regardless of what else is true.
  - Publication-provider requests are impossible: C5 refuses before the publication handoff, and the
    existing Phase 0A guard still sits behind the approval that `SHADOW` forbids.
  - Layer 6 remains mandatory and unbypassable regardless of mode.
- **Rollback:** set the gate to `OFF`, or zero the grant — either denies at C1, neither needs a
  deployment. Lower the manual ceiling and revert P8 if a fuller stand-down is wanted.

#### M4 — Operator-triggered shadow execution *(REQUIRES OPERATOR ACTION)*

- **Entry:** M3 complete; a grant exists with `runs_remaining > 0` and unexpired.
- **Action:** an authorized operator explicitly triggers runs through the manual acceptance path,
  **bounded by the grant** — each acceptance decrements it, and the run after the last is refused
  without further action. **Not scheduled, not queue-driven.**
- **Expected:** stage results and audit records are produced; model-provider requests occur and are
  counted (§7.4); **zero** approval transitions and **zero** publication-provider requests, both
  refused at C4 and C5 rather than merely not attempted.
- **Rollback:** set the gate to `OFF`, or zero the grant.

#### M5 — Shadow evidence collection and review *(REQUIRES OPERATOR ACTION)*

- **Entry:** the grant is spent or expired.
- **Action:** collect the evidence defined in §7.4 and review it. No system change. Returning the gate
  to `OFF` while reviewing is encouraged and costs nothing.

#### M6 — Post-shadow promotion decision *(REQUIRES OPERATOR ACTION, separately reviewed)*

- **Action:** a separate, recorded decision on whether the shadow evidence supports `LIVE`
  *eligibility*. A decision to promote is **not** itself a promotion.
- **Exit:** a committed decision record naming the authorizer, the evidence relied on, and the
  conditions.

#### M7 — Live dispatch authorization *(REQUIRES OPERATOR ACTION)*

- **Action:** raise `CONTENT_INTELLIGENCE_MAX_AUTHORITY` and the gate to `LIVE`, and raise
  `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED` — **three separate authorizations, not granted
  together.** This is the first step at which layer 4b is satisfied.
- **Still independent:** `LIVE` authorizes neither approval nor publication. It removes the C4 and C5
  refusals; layer 6 remains mandatory and layer 7's per-request guard is unchanged, so an approval
  still requires a person and a publication still requires the Phase 0A guard to pass.

---

## 7. Testing and observability

**PROPOSED**, extending the existing contract rather than replacing it.

### 7.1 Offline and mutation

- Every new boundary gets offline coverage that **executes** the boundary rather than asserting on
  source text — the standard this repository already applies, and the reason a validator that was
  never called went unnoticed for five phases.
- Every load-bearing branch gets a mutation whose owning check must fail. **A mutation that fails to
  compile proves nothing** and is not accepted as coverage.
- The reachability protection required by §1.3.1 lands with P3 and is not deferred.
- **Each of the five checkpoints gets its own mutation**, removing that checkpoint alone and
  requiring its owning check to fail by name — C1 and the grant decrement in P3, C2 and C3 in P2,
  C4 in P5, C5 in P6. A checkpoint with no failing mutation is not proven load-bearing.

### 7.2 Disposable PostgreSQL 16/18

Migration 008 (P1) gets the same apply / enforce / documented-rollback / compiled-reapply /
collision-refusal coverage that 007 has, on both versions — including that an absent or unrecognized
authority mode is treated as `OFF`.

### 7.3 Dry-run and unreachable-provider guarantees

- Simulated dry run must continue to make provider and publishing actions **impossible**, not skipped.
- The offline suite must continue to pass with a **nonempty** `ANTHROPIC_API_KEY` exported, and with
  `ANTHROPIC_BASE_URL` pointed at an unreachable port — so a real request would fail loudly rather
  than pass silently.

### 7.4 Provider-request accounting — the two kinds are not the same

The earlier draft said a shadow run makes "zero provider requests". **That was wrong**, and the
correction matters because it is the difference between a meaningless shadow and a real one.

| Kind | In shadow | Counted how |
|---|---|---|
| **Model-provider requests** (Anthropic) | **Expected.** A real-model six-stage run makes them — normally **one per executed stage**, so six for a complete run | Counted per stage and per run. A count other than one for an executed stage means a documented failure or an unexpected retry, and is investigated, not averaged away |
| **Publication-provider requests** (Instagram / Facebook / GBP) | **Exactly zero** | Asserted from durable state, not from logs |
| **Approval transitions** | **Prohibited** | Asserted from durable state |
| **Publications** | **Prohibited** | Asserted from durable state |

**Fake-runner validation is not production evidence.** Every offline and CI test uses an injected
fake runner; those results are labelled **fake-runner validation** and must never be counted as
real-model evidence. Only M4 produces real-model evidence.

**PROPOSED — evidence expected from a real-model shadow run**, recorded without exposing prompts,
credentials, or sensitive evidence:

- per run: run id, brief id, pack digest, code version, authority mode at dispatch, terminal state,
  total duration;
- per stage: stage id, ordinal, validation outcome, **model-provider request count**, token usage,
  duration, terminal error class;
- aggregate: model-provider request total; publication-provider request total (**must be 0**);
  approvals created (**must be 0**); publications (**must be 0**).

**Never recorded:** prompt text, model prose, evidence claim text, credentials, approval tokens,
provider payloads.

### 7.5 Metrics and alerts

**PROPOSED** — counts and rates only, owned by **P7**. **Recorded**: refusals broken out **by
checkpoint** (C1–C5), grant issuance and each consumption with `runs_remaining` after it, and the
effective authority mode at each decision. **Alerts on**: any publication-provider request during
shadow (must be zero), any approval transition permitted during shadow (must be zero), any run
accepted with no grant, any scheduled or queue-driven acceptance before M7, deadline aborts, and any
run terminalizing `operator_disabled`. No metric label may carry evidence text, a goal string, or a
credential.

### 7.6 Acceptance criteria for production validation

**PROPOSED** — a stage is `PRODUCTION-VALIDATED` only when *all* hold, each as evidence:

1. It executed in production against a real model, observed in durable state.
2. Its output validated deterministically; refusals were correct refusals.
3. Its model-provider request count matched one per executed stage, or the deviation is documented.
4. No approval was created except through the mandatory human gate, and **C4 was observed refusing**
   an approval transition under a non-`LIVE` mode.
5. No publication occurred except behind a passing publication guard, and **C5 was observed refusing**
   a publication under a non-`LIVE` mode, with a publication-provider request count of zero.
6. Recovery was exercised: an interrupted run terminalized correctly and resumed nothing.
7. An authority-gate `OFF` transition was exercised and behaved as §3.2 specifies.
8. A bounded manual-dispatch grant was observed **exhausting**: the run after the last granted one was
   refused at C1 with no operator action.
9. Scheduled and queue-driven dispatch was observed **not** starting a run at any point before M7.

Anything less is `DEPLOYED` or `ENABLED`, never `PRODUCTION-VALIDATED`.

---

## 8. Deferred: the Google Business Profile expansion

**Recorded as a future proposal only. Not begun, not designed here, and deliberately not imported.**

- **PROPOSED constraints for whenever it is taken up:** read-only and dry-run **first**; a **reviewed
  page list** as its input; **view/CSV output** initially, with no write path and no publication path;
  and its own separate review and authorization.
- **It must not begin during production-wiring work.**
- **No external proposal file is imported by this document**, and no GBP functionality exists in this
  change. `ACTIVE_PLATFORMS` is unchanged.

---

## 9. Unresolved questions

These are genuinely open. None is closed by this revision:

1. **UNKNOWN** — current live Render service versions, health, and control settings.
2. **UNKNOWN** — the true current contents of the production evidence tables.
3. **UNKNOWN** — whether any executor has ever been invoked against a real model historically (§1.4).
4. **PROPOSED, undecided** — whether a shadow run should build its evidence pack from
   `config/approved-facts.json` via the adapter, or require `evidence:sync` to have populated
   `content_evidence` first. This changes what shadow evidence proves and should be decided
   explicitly, not defaulted.
5. **PROPOSED, undecided** — cost ceiling per run and per day, and what happens on breach. Six stages
   at the derived output budgets is materially more spend than the current path, and §7.4 makes the
   model-request count explicit rather than hiding it.
6. **UNKNOWN** — whether one brief per day remains the right cadence once six stages run per brief.
7. **PROPOSED, undecided** — retention for `content_intelligence_stage_results`. Stage outputs contain
   model prose; the repository has no complete retention program yet.

---

## 10. What this document does not do

It does not implement production wiring, enable any executor, deploy anything, apply migration 007,
run production SQL, contact a provider or model, approve or publish content, change `render.yaml` or
any workflow, create any environment variable, mutate or inspect anything in Render, or begin the GBP
expansion. It changes no source, test, migration, configuration, agent, skill, or prompt file.

**It grants no authorization, and it has not been accepted.** Every layer in §3, every gate in §4, and
every PR and milestone in §6 still requires its own review, authorization, and evidence.
