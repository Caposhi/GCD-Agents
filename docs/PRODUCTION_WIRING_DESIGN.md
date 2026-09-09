# Production-wiring design — making the six dormant executors reachable, safely

**This document is a design. It implements nothing, and it authorizes nothing.** No source, test,
migration, workflow, configuration, `render.yaml`, agent, skill, or prompt file changes with it.
Nothing here enables an executor, applies a migration, deploys a release, contacts a provider, or
publishes content. It is the separately reviewed production-wiring design that
[`docs/ROADMAP.md`](ROADMAP.md) names as the next product cursor.

## Status — accepted as design, and unimplemented

**ACCEPTED AND MERGED AS DESIGN.** This document was reviewed and merged to `main` through **PR #56**
(merge `53e2c2bb6115e457670c1f99956d11a1a54530cd`, whose ordered parents are base
`e6f9b0275fc25f0c508708f5e421a474daeebbae` then reviewed head
`42f83a122910981f6af3bc9b9024d27ac8b839ff`). It is no longer a draft, and it is no longer under
review as a proposal. **Accepted means exactly one thing: this design document is present on `main`
as the repository's accepted production-wiring design.**

**It is `UNIMPLEMENTED`, and acceptance changed nothing operational.** Specifically, merging it did
**not**:

- implement any production wiring, or create any of the eight implementation PRs (P1–P8) it proposes;
- execute, authorize, or schedule **any** operator milestone — **no milestone M1–M7 has been
  performed**, and M4's five single-control acts are likewise unperformed;
- deploy anything, apply migration 007 or 008, or grant authority to apply either;
- enable an executor, change any `executionEnabled` value, raise any dispatch ceiling, issue any
  manual-dispatch grant, or move the runtime authority gate off `OFF`;
- contact a provider or model, approve content, or publish anything;
- establish deployment, production validation, or database readiness.

**Every live fact remains `UNKNOWN` unless separately verified.** Nothing in this document — before
or after merge — establishes live Render service identity, health or control settings; the commit
each service runs; the contents of `_migrations`; whether migration 007 is applied; or any other
production state. **A merged document is repository evidence, never production evidence**, and no
live fact may be inferred from the fact that this design is accepted. Each such fact must be
established by its own read-only verification, dated as the observation it is.

**Operational execution requires separate authorization, per named unit.** Acceptance of this design
is not authorization to execute it. **Each implementation PR (P1–P8) and each operator milestone
(M1–M7), including each of M4's five acts, still requires its own review, its own explicit
authorization, and its own evidence** — no single approval covers more than the one unit it names,
and none of them is implied by this merge.

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
states that applying it to production is a separate, separately authorized operation and that 007's
live application state is `UNKNOWN` in either direction, retaining the 2026-08-28 read-only reading
of `_migrations` at `001–006` as an explicitly dated observation.

**VERIFIED** — the repository asserts nothing about 007's live application state in either
direction. Repository state is not production evidence: it establishes neither that 007 has been
applied nor that it has not, and the current state requires fresh read-only verification.

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
| 3 | **Database readiness** | Migration 007 applied **and post-apply-validated** (§4) | A deployment having run. An api deploy *does* apply pending migrations (§4.0) — indeed applying 007 **is** an api deployment (§4.4) — so what distinguishes readiness is not that a deploy happened but that the deploy was the authorized artifact, **its complete migration state — `F(A)`, `D` and `P`, all seven comparisons of §4.4.2 — was verified beforehand**, and G7 plus the recorded post-deployment comparison and decision validated the result afterwards. An apply that happened as an unexamined side effect satisfies this layer no more than not applying it at all |
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
  authorizations and must not be granted together (§6, **M4.2** and **M7**), and neither may be
  granted together with a ceiling change or a dispatch change.
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
| Registry `executionEnabled` | Source (`registry.ts`) | A reviewed, merged PR — **P8** | On deployment of that commit | **M3** |
| Proposed environment variables | Render service configuration | An operator, per service, **one variable per act** | On service restart/redeploy — a deployment-time **ceiling**, not an operational switch | authority ceiling at **M4.1**; manual dispatch ceiling at **M4.3**; authority ceiling → `LIVE` and scheduled dispatch ceiling at **M7**, as separate acts |
| **Proposed runtime authority gate** | Durable control-plane row | An authorized human via console route or authorized statement | At the next gate check — **no deployment** | `SHADOW` at **M4.2**, `LIVE` at **M7** |
| **Proposed manual-dispatch grant** (§3.2.1) | Durable control-plane row, bounded and expiring | An authorized human, per grant | At the next run acceptance, which **consumes** it — **no deployment** | issued at **M4.4**, consumed at **M4.5**; **not reissued by M7** |

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
- **Consequently every api deployment in this rollout — including configuration-only restarts —
  reaches the runner, and every one carries the §4.4.2 preflight.** The expected pending set is
  `{007}` at M1, `{008}` at M2, and **empty** everywhere after that.
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
| **G3a Complete migration-state verification** | **`F(A)`, `D` and `P = F(A) − D` are all computed and recorded immediately before the runner is invoked**, and **all seven comparisons of §4.4.2 pass** against that deployment's four expected sets — `E_files`, `E_applied_pre`, `E_pending`, `E_applied_post`. **Validating `P` alone is not sufficient**: an unexpected *already-applied* migration cancels out of `P` and is invisible to it, so the complete applied set `D` is checked in its own right. Required before **every** use of the general migration runner, including the one the api `preDeployCommand` triggers, and including configuration-only restarts of a service that carries the api | **Any** of the seven comparisons fails — an unexpected pending file, a missing expected one, **an unexpected or unauthorized already-applied migration**, an applied identifier absent from the artifact, an extra artifact file, or a duplicate → stop; do not run the runner, do not trigger the deploy; the discrepancy needs its own §4 treatment |
| **G3b Controlled artifact** | The **deployed artifact** is a named exact reviewed commit meeting every requirement A1–A5 of §4.4 — its `state/migrations/` contains exactly the authorized set, its application code is approved to deploy and serve, and it satisfies the **A/L ancestry predicate** of §4.4.1. Applying a migration **is an API deployment** (§4.4); selection comes only from what the artifact contains, never from the runner | Any of A1–A5 fails; or the artifact's migrations directory contains a file outside the authorized set |
| **G4 Single runner** | Exactly one migration authority; no schema-dependent consumer racing it | More than one runner, or a consumer started early |
| **G5 Transactional apply, by the only sanctioned authority** | Applied by `npm run migrate` **through the api `preDeployCommand`**, which wraps each file in `BEGIN…COMMIT`. **VERIFIED** ([`ROLLOUT_PHASE_0B0.md`](ROLLOUT_PHASE_0B0.md) §5) that this is the repository's standing rule and the one under which 006 was applied | Applied by hand via `npm run migrate` or `psql -f` — both are prohibited by that rule, and `psql -f` additionally disables the `SET LOCAL` timeout guards silently. Neither is an escape hatch for applying one file: **G3b is**, by controlling what the artifact contains |
| **G6 Collision** | 007's helper uses plain `CREATE`, so an exact-name collision aborts without overwriting | Collision detected → abort, do not force |
| **G7 Post-apply validation** | `_migrations` holds `007` exactly once; **`_migrations` contains no file that was not in the authorized set**; every constraint present; a boundary record inserts and an over-bound one is rejected | Any check fails → rollback per `state/rollback/007_evidence_bounds_rollback.sql`. An unauthorized file having been applied is an incident, not a variance |
| **G8 Reapply** | Only after the cause is fixed and the audit re-run | Reapplying over unexplained failure |

**PROPOSED — the rule about what 007 may and may not be combined with.** An earlier revision said
007 "must not be applied in the same change as deployment", which **contradicts §4.4**: the only
sanctioned migration authority is the api's `preDeployCommand`, so a deployment is not merely
permitted, it is *required* to invoke it. **That wording is withdrawn.** The correct rule:

- **007 may be applied only through the separately reviewed and explicitly authorized M1 api
  deployment**, and through no other route.
- **That deployment exists in order to invoke the api's sanctioned pre-deploy migration authority** —
  a *deployment required to reach the migration runner*, which is a different thing from an
  *unrelated behavioural deployment*. M1 is emphatically **not** a no-deployment action, and must
  never be described as one.
- **007 must not be combined with** executor enablement, runtime-authority promotion, dispatch
  activation, approval or publication changes, migration 008, or any unrelated application behaviour.
- **The artifact may contain only the authorized migration set through 007** (A2), and its application
  code must be separately approved as safe to deploy and serve (A3) — reviewed as a deployment on its
  own terms, precisely because it is one.
- **M1 must complete and be verified before P1 — which introduces migration 008 — may merge.**

So the prohibition is on *combining 007 with unrelated change*, never on deploying at all. Deploying
is the mechanism; combining is the hazard.

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
`001`–`007` and no later migration, and its application code is the current reviewed code. The
artifact's file set yields a pending set of `{007}` at M1 and `{008}` at M2 **only if** the target
database's applied set is exactly the authorized baseline. Because 007's live application state is
`UNKNOWN` in either direction, each pending set is an **expectation the milestone's own read-only
gate must establish** (`G3a`, §4.4.2 and §7), never a present fact. No older artifact is needed, and
this design does not propose one.

**That invariant does not by itself make M1 a forward deployment.** Whether deploying the artifact
moves the api forward, backward, or sideways is a fact about the **live** commit, which this design
cannot know. M1 may be called an ordinary forward deployment **only after** `L` has been obtained by
read-only verification and the predicate in §4.4.1 is satisfied — never before, and never as an
inference from repository ordering. The invariant keeps the *migration set* correct; the predicate is
what keeps the *application version* correct. Both are required.

**If 008 has already merged, the invariant was violated and M1 does not proceed under this
procedure.** Deploying an older artifact to force the pending set would be an application-version
rollback dressed up as a migration, and this design does not sanction it. The correct response is to
stop, re-plan, and obtain a fresh authorization and decision record covering **every** file in the
actual pending set — because at that point both files really are pending and pretending otherwise is
the failure this section exists to prevent.

#### 4.4.1 The A/L ancestry predicate

Two commits, named explicitly and used with these meanings everywhere in this document:

| Symbol | Meaning |
|---|---|
| **`A`** | The exact **artifact** commit proposed for the api deployment **currently under consideration** |
| **`L`** | The exact commit **currently served by the live api immediately before that deployment**, obtained through the required read-only identity check |

**These are general, not M1-only.** The predicate is evaluated afresh for **every** api deployment in
this rollout — M1, M2, M3, and each configuration deployment or restart in M4 — with `A` and `L` bound
to that deployment's own artifact and its own immediately-preceding live reading. **A result obtained
at an earlier milestone is never reused**: live state can change between milestones, and a stale
reading is not a reading.

**`L` is UNKNOWN until inspected.** It may not be inferred from `main`, from `render.yaml`, from any
dated record in this repository, or from a previous milestone's record. **If `L` cannot be obtained,
M1 stops** — there is no default, and "presumably the latest" is not a reading.

**PROPOSED — M1 may proceed without a separate rollback or divergence authorization only when:**

- **`A == L`** — the artifact is already what is live, so the deployment does not move the
  application version. **Whether it re-invokes `preDeployCommand` is UNKNOWN — see below**; **or**
- **`L` is an ancestor of `A`** — the artifact is strictly ahead of live, so the deployment moves the
  api forward.

**Reject and stop when:**

- **`A` is a proper ancestor of `L`** — deploying `A` would move the live api **backward**. That is a
  runtime rollback, and it requires its own authorization and its own review, not this milestone's.
- **Neither commit is an ancestor of the other** — the histories **diverge**. The deployment would
  simultaneously add and remove application behavior, and it requires its own authorization and its
  own review.

**Operationally, and in this order** (`--is-ancestor` is true for a commit and itself, so equality is
tested first and the two directional tests are only meaningful for a non-equal pair):

```
if A == L                                  -> ALLOW    (same image)
elif git merge-base --is-ancestor L A       -> ALLOW    (L strictly behind A: forward)
elif git merge-base --is-ancestor A L       -> REJECT   (A strictly behind L: runtime rollback)
else                                        -> REJECT   (divergent histories)
```

**The earlier wording "`A` is not an ancestor of `L`" is withdrawn as ambiguous** — read literally it
rejects the legitimate `A == L` case and accepts the illegitimate divergent case, which is backwards
in both directions.

**UNKNOWN — whether a same-commit api deployment re-runs `preDeployCommand`.** Live Render behaviour
was not inspected by this design, so it is **not established** that requesting a deploy of an
already-live commit re-executes the pre-deploy command. The `A == L` path therefore carries an extra
precondition:

- **Before relying on `A == L`**, the operator must establish — from authoritative Render
  documentation, or from a safe read-only / control-plane check — that **the specific deploy action
  they intend to use invokes `preDeployCommand`**.
- The operator must **record the exact deployment action used** (its name and how it was invoked), not
  merely that "a deploy was triggered".
- **If that behaviour cannot be established, M1 stops and is re-planned.** There is no standalone
  runner and no manual-SQL fallback: both remain prohibited (§4.4, G5).
- Re-planning must not invent a throwaway commit to force a version difference. Any commit introduced
  for this purpose would itself have to be separately reviewed, exact-head CI green, safe to deploy
  and serve, carry no migration later than the authorized set, and be **represented explicitly in this
  rollout** — it is not a workaround this design grants in advance.
- **The path fails closed either way:** G7 requires `_migrations` to hold `007` exactly once, so a
  deploy that silently skipped the runner leaves the milestone unmet rather than falsely complete.

**VERIFIED — the *rejection* half of this predicate is the rule this repository's automated deployment
controller already enforces.** Read from `scripts/render/deployment-controller.mjs`:

- it resolves the live api commit and stops with `LIVE_SHA_UNKNOWN` if it cannot;
- **on `LIVE_SHA == TARGET_SHA` it does not simply return.** It first checks that **all three
  services — api, worker and scheduler — report the target**, stopping with `PARTIAL_RELEASE_STATE`
  if any does not. **Only after confirming that full three-service identity** does it return
  reporting that **no deployment was triggered**;
- otherwise it stops with `DIVERGED_RELEASE_BASE` unless
  `git merge-base --is-ancestor <liveSha> <targetSha>` succeeds.

[`docs/DEPLOYMENT.md`](DEPLOYMENT.md) records the same rule in prose: *"Divergence, rollback,
force-push, and unknown history are not ordinary automatic releases."*

**Where this design agrees, and where it deliberately departs — stated rather than blurred:**

| Case | Automated controller | This design's M1 |
|---|---|---|
| `A` proper ancestor of `L` | stops (`DIVERGED_RELEASE_BASE`) | stops — **same** |
| Divergent histories | stops (`DIVERGED_RELEASE_BASE`) | stops — **same** |
| `L` unobtainable | stops (`LIVE_SHA_UNKNOWN`) | stops — **same** |
| `L` ancestor of `A` | proceeds | proceeds — **same** |
| **`A == L`** | confirms all three services at target, then **deploys nothing** | **requests an api deployment anyway**, in order to invoke `preDeployCommand` — **a deliberate, explicitly authorized departure** |

**The `A == L` case is therefore not a restatement of the controller's behaviour; it is an authorized
exception to it.** The controller declines to deploy because, for an ordinary release, there is nothing
to release. M1's purpose is not to change the image but to reach the migration runner, which is the
one thing the controller's equality path never does. That exception is why the `A == L` path carries
its own extra precondition (the UNKNOWN above) and its own authorization, and why it may not be taken
as "the controller would have done this too."

**M1's manual execution bypasses the automated controller entirely**, which is why the predicate,
the complete migration-state gate, health verification and rollback all have to be carried by the
milestone itself
rather than inherited.

**This predicate proves only that the version movement is acceptable. It proves nothing about the
artifact's safety.** A1–A4 below still apply in full and independently: `A` must be fully reviewed
with exact-head CI green, contain migrations `001`–`007` and no later migration, carry application
code separately approved as safe to deploy **and** safe to serve, and pass the **complete production
migration-state check of §4.4.2** — not a pending-set check alone, since an unexpected already-applied
migration is invisible to `P` — and the health, identity, boundary and rollback checks in M1 remain
required regardless of how the predicate resolves.

#### Requirements on the M1 artifact — all five, each a stop point

| # | Requirement | Stop condition |
|---|---|---|
| **A1** | An **exact reviewed commit**, named by full SHA in the §4.2 decision record, with exact-head CI green | Any ambiguity about which commit; a branch name or tag instead of a SHA |
| **A2** | Its `state/migrations/` contains **`001`–`007` and no later migration** — enumerated and recorded, not assumed | Any file beyond `007` present |
| **A3** | Its **application code is approved as safe to deploy and safe to serve**, both before the migration and after it — reviewed as a deployment on its own terms, not waved through because the point of the exercise is the schema | Application code not separately approved for deployment |
| **A4** | The **complete migration-state check of §4.4.2** (G3a) passes against the target database immediately before the deploy is triggered: `F(A) == E_files` (`001`–`007`, no later migration), `D == E_applied_pre` (exactly the baseline `001`–`006`), `P == E_pending` (exactly `{007_evidence_bounds.sql}`), and **all seven comparisons hold** | **Any** of the seven comparisons fails — including an **unexpected already-applied** migration, which `P` alone cannot detect |
| **A5** | The artifact **satisfies the A/L ancestry predicate** of §4.4.1 — either `A == L`, or `L` is an ancestor of `A`. `L` is obtained by read-only verification of the running api, never assumed | `A` is a proper ancestor of `L` ⇒ a runtime rollback ⇒ stop. Neither is an ancestor of the other ⇒ divergent histories ⇒ stop. `L` cannot be obtained ⇒ stop. Each needs its own authorization and its own review |

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

#### The migration-state verification itself (G3a)

**VERIFIED — what the migration table actually records.** `src/state/migrate.ts` creates
`_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())` and inserts the
**filename** of each applied file. So the identifier is the file name, `name` is a **PRIMARY KEY** —
which makes a duplicate identifier structurally impossible rather than merely checked — and **there is
no checksum, hash, or content column.**

> **Stated limitation:** only migration **identifiers** can be verified against production. This design
> **cannot** establish that the *content* of an applied migration matches the file of the same name in
> the artifact, because the table stores nothing that would support that comparison. Every claim below
> is an identity claim, and none of it is a content-integrity guarantee.

Performed immediately before the deployment or restart is triggered, against the exact artifact:

```
F(A)  := the *.sql file names in state/migrations/ at artifact commit A
D     := SELECT name FROM _migrations ORDER BY name   -- read-only, from the target database
P     := F(A) − D                                     -- the computed pending set
```

#### 4.4.2 The deployment preflight — required before *every* api deployment in this rollout

**PROPOSED.** G3a says the migration-state check is required before **every** use of the general
migration runner, including the `preDeployCommand`-triggered one. Because §4.4 establishes that *every*
api deployment reaches that runner, the rule binds every api deployment in this rollout — not only the
two that intend to apply something.

**Do not assume a configuration-only change avoids the runner.** §3.2 records that on Render,
**changing a service environment variable triggers a restart or redeploy of that service**; where the
**api** is among the services carrying that variable, that runs `preDeployCommand` and therefore the
sweeping runner. Whether the api is a target is decided by the ownership table in §5.2/§5.3 and stated
per act — **a worker-or-scheduler-only change is not an api deployment and does not invoke the api
migration runner** (§6, M7).

**Comparing the pending set alone is not sufficient.** An unexpected migration that is **already
applied** appears in both `F(A)` and `D`, so it cancels out of `P` and leaves the pending set looking
exactly as expected. The pending difference cannot see it. **The complete applied set must therefore be
validated in its own right**, against an expected inventory, before every deployment.

**Four expected sets are named per milestone, and all three observed/computed sets are compared:**

| Symbol | Meaning |
|---|---|
| `E_files` | the migration identifiers expected to be **present in the artifact** |
| `E_applied_pre` | the identifiers expected to be **already applied** before this deployment |
| `E_pending` | the identifiers expected to be **pending** for this deployment |
| `E_applied_post` | the identifiers expected to be **applied afterwards** |

**Before every api deployment or restart, all of the following must hold. Any one failing stops the
deployment:**

1. `F(A) == E_files` — **exactly** the expected files are in the artifact; **no extra migration file
   exists in the artifact**, and none expected is missing.
2. `D == E_applied_pre` — the production applied set is **exactly** the expected inventory.
3. `P == E_pending` — the computed pending set matches exactly.
4. **Every identifier in `D` corresponds to a migration present in `F(A)`** — nothing applied in
   production is absent from the artifact.
5. **No expected applied migration is absent** from `D`.
6. **No unexpected or unauthorized applied migration exists** in `D` — this is the check the pending
   difference cannot make.
7. **No duplicate identifier exists.** `name` is a PRIMARY KEY, so the database enforces this
   structurally; the operator records the row count alongside the distinct-identifier count so the
   invariant is observed rather than assumed.

**The exact contract, per deployment:**

| Deployment | `E_files` | `E_applied_pre` | `E_pending` | `E_applied_post` |
|---|---|---|---|---|
| **M1** | `001`–`007`, and **no later migration** | **exactly** the authorized baseline `001`–`006` | exactly **`{007_evidence_bounds.sql}`** | **exactly** `001`–`007` |
| **M2** | **exactly** through `008` | **exactly** through `007` | exactly **`{008_…sql}`** | **exactly** through `008` |
| **M3** | the exact authorized inventory for that milestone | the same inventory | **empty** | unchanged, equal to `E_applied_pre` |
| **M4.1** (authority ceiling — api is a target) | as above | as above | **empty** | unchanged |
| **M4.3** (bounded-manual ceiling — api is a target) | as above | as above | **empty** | unchanged |
| **M7's authority-ceiling act** (api is a target) | as above | as above | **empty** | unchanged |
| **Any other api deployment or restart in this rollout** | as above | as above | **empty** | unchanged |

*(M7's scheduled-dispatch act targets only the worker and scheduler and is therefore **not** an api
deployment — see §6, M7. It takes no migration gate, because it reaches no migration runner.)*

**Any mismatch stops the deployment before it is triggered — including an unexpected migration that is
already applied.** It is not a variance to note and proceed past, and it is explicitly **not** something
to discover after the deployment. Before that deployment may be retried it requires, separately and in
order: its own investigation and authorization record, its own migration audit, its own committed
decision record, its own post-apply validation, and its own rollback plan — the full §4 treatment, for
whatever identifier appeared or is missing.

**No deployment may silently apply a newly added migration merely because the general runner discovers
it.** Discovery by the runner is exactly the failure mode this gate exists to prevent.

**Required operator record, for every api deployment in this rollout.** The record has **two parts,
completed at two different times**. Part 1 is finished **before** the deployment is triggered; Part 2
can only be finished **after** it, because its fields are readings taken afterwards. Both are retained
with the milestone's evidence.

**Part 1 — the pre-deployment record.** Complete and retain this **before triggering the deployment**.
**The deployment may not be triggered until Part 1 is complete and its `decision` is `pass`:**

| Field | Content |
|---|---|
| `artifact_sha` | `A` — the exact commit about to be deployed |
| `live_api_sha` | `L` — the exact commit the live api is serving, read immediately beforehand |
| `ancestry_decision` | the §4.4.1 outcome: `A == L`, `L ancestor of A`, or the stop reason |
| `F(A)` | the `*.sql` identifiers present at `A`, enumerated |
| `D` | the `_migrations` rows, enumerated, read-only, with row count and distinct-identifier count |
| `P` | `F(A) − D`, enumerated |
| `E_files`, `E_applied_pre`, `E_pending`, `E_applied_post` | the four expected sets for this deployment, from the table above |
| `comparisons` | the outcome of each of the seven checks, individually |
| `decision` | **pass** or **stop**, with the reason. **`stop` means the deployment is not triggered** |

**Part 2 — the post-deployment closure.** Complete this **after the deployment has run**, from
readings taken at that point. **The milestone may not be called complete until Part 2 is complete:**

| Field | Content |
|---|---|
| `D_post` | the `_migrations` rows read **after** the deployment, enumerated |
| `post_comparison` | the **recorded outcome** of `D_post == E_applied_post` — **match** or **mismatch**, with the differing identifiers named. Recording `D_post` without recording this comparison leaves the deployment unvalidated |
| `post_decision` | the **validation-versus-rollback decision**: **validated — milestone complete**, or **rollback initiated**, naming which rollback path (application, database, or both, per that milestone's ladder) and the reason. A mismatch **requires** the rollback branch; it is never recorded as a variance and left standing |

**All three closure fields are mandatory.** `D_post` on its own is an observation, not a decision:
without `post_comparison` nothing records whether the applied state actually matched what was
expected, and without `post_decision` nothing records what the operator did about it. A milestone
whose record ends at `D_post` is **not** complete.

**The two parts are never merged into one step.** Part 1 cannot contain Part 2's fields — they do not
exist yet — and a milestone that lists them together in a single pre-deployment step describes a
sequence no operator can perform. Every milestone below orders them as: complete Part 1 → trigger the
deployment → complete Part 2.

A deployment performed without **both parts** of this record is unauthorized by definition, on the
same terms as an apply without a decision record (§4.2).

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
this design exists to prevent. The manual ceiling is raised at **M4.3** and the scheduled ceiling not
until **M7**, as separate single-control acts.

**These variables are ceilings, not the operational control.** The mutable runtime authority gate
(§3.2) is what an operator turns off in an emergency, and the bounded grant (§3.2.1) is what actually
permits a run. Every value defaults to *off when absent*, so a service that never received the
variable is safe rather than enabled.

**The Owner column decides which services restart — and therefore whether the api migration runner is
reached at all.** Changing a variable restarts only the services that carry it. `CONTENT_INTELLIGENCE_
MAX_AUTHORITY` and `CONTENT_INTELLIGENCE_MANUAL_DISPATCH_ENABLED` are carried by the **api**, so acts
that change them **are api deployments** and take the full §4.4.2 preflight.
`CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED` is carried by the **worker and scheduler only**, so
changing it restarts neither the api nor its `preDeployCommand`, reaches **no migration runner**, and
**must not be described as an api deployment or inherit the api migration gate** (§6, M7-b).

**Deployment ordering:** every migration reaches production through an api deployment (§4.4), so
"database first" means **an api-only deployment first**. 007 under M1, at an artifact meeting A1–A5
and **before P1 merges**, deploying the api alone so it is the single migration runner; then 008 as
part of the migration-bearing release in M2, again with the **complete migration state** verified
against the exact commit **before the deploy is triggered** → api → worker → scheduler, matching the merged controller's
existing serialized order. **The manual dispatch ceiling is raised at M4.3 and the scheduled ceiling
only at M7**,
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

**Counts, stated once so they can be checked:** **eight** implementation PRs, **seven** operator
milestones. M4 is one milestone comprising **five separately authorized single-control acts**
(M4.1–M4.5); those acts are not additional milestones, and no milestone was added or removed by
splitting it. **No act changes more than one authority control** (§3.3) — which is why M3 (registry
activation) and M4.1 (authority ceiling) are separate acts with separate deployments even though both
require a deployment: they change different controls.

**No step combines enablement or publication with anything else.** Migration application and
deployment cannot be fully separated — §4.0 establishes that the api `preDeployCommand` applies
whatever migration is pending — so where a release is unavoidably migration-bearing (M2), it is
declared as such, takes the migration-bearing rollout with the **complete migration-state
verification of §4.4.2** — all seven comparisons, not the pending set alone — and gets post-apply
validation with its comparison outcome and validation-versus-rollback decision recorded, rather than
being described as a plain deploy.

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
| **M3** | operator | Deploy P8, arming the registry. One control | none | `OFF` |
| **M4.1** | operator | Authority **ceiling** → `SHADOW`, by config deployment/restart. One control | none | `OFF` (effective) |
| **M4.2** | operator | **Durable gate** → `SHADOW`. One control | none | `SHADOW` |
| **M4.3** | operator | **Bounded-manual** dispatch ceiling raised. One control | manual ceiling on, **no grant ⇒ nothing can start** | `SHADOW` |
| **M4.4** | operator | One bounded, expiring **grant** issued. One control | manual, bounded by the grant | `SHADOW` |
| **M4.5** | operator | Named run submitted; grant **consumed atomically**. Changes no ceiling | manual, grant draining | `SHADOW` |
| **M5** | operator | Collect and review evidence | none — grant spent or expired | `SHADOW` or `OFF` |
| **M6** | operator | Promotion decision | none | `SHADOW` or `OFF` |
| **M7** | operator | Ceiling → `LIVE`, gate → `LIVE`, scheduled dispatch raised. Three separate single-control acts | **scheduled only; manual requires a new separately authorized bounded grant** | `LIVE` |

**Scheduled and queue dispatch is off at every step until M7, and at M7 is authorized only to the
exact bounded extent M7 defines. Manual dispatch is available only while an unspent, unexpired grant
exists — so it is available during M4.4–M4.5 and, after that grant is consumed, only if a new
separately authorized bounded grant is issued; M7 issues none.** Approval and publication are refused
at C4 and C5 at every step until the authority gate reaches `LIVE`, and even then remain separate
controls governed by layers 6 and 7 independently — **scheduled dispatch implies neither.**

### Implementation PRs

#### P1 — Durable schema: runs, stage results, the authority control plane, and dispatch grants

**Entry gate — P1 must not merge until M1 is complete and verified.** P1 introduces migration 008. If
it merges first, the pending set at M1 becomes `{007, 008}` and the deployment that applies 007 would
apply 008 with it, unaudited (§4.0, §4.4). **This ordering is the whole mechanism, not a preference:**
because the runner is reachable only through the api `preDeployCommand`, keeping 008 out of the
repository is what lets the M1 artifact be current reviewed code with the right migration set —
**which is necessary but not sufficient for calling M1 a forward deployment: that also requires the
A/L ancestry predicate to pass against the live commit (§4.4.1), which no repository ordering can
establish.** §4.4 states what happens if the invariant is broken — M1 stops and is re-planned; it is
not worked around by deploying an older artifact.

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
- **Rollback:** revert. P1 applies no migration to production — see **Prohibited** below — so
  reverting removes files rather than unwinding a schema.
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
  change while the gate is `OFF` — which it is until **M4.2**.
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

**This is a source change and is numbered as one.** An earlier draft buried it inside the pre-shadow milestone
while claiming the sequence held five implementation PRs — so the single change that arms every stage
was the one change with no PR number, no stated entry gate, and no review record of its own.

- **Entry:** P1–P7 merged; **M2 complete and verified** (the inert implementation deployed, all gates
  reading `OFF`). Deployed by **M3**; armed for use no earlier than **M4.2**.
- **Change:** the six registry entries' `executionEnabled` values, and nothing else. No logic, no
  schema, no configuration, no `render.yaml`.
- **Why it is safe to merge before shadow is authorized:** with P2 merged, `executionEnabled: true`
  satisfies only *half* of layer 5. The authority gate still reads `OFF`, so C1–C3 refuse, and the
  registry flag alone changes nothing observable — the same fact §1.3.2 records about today's flag,
  now true in the opposite direction.
- **Exit:** the offline suite passes with all six `true`; a regression proves that with the gate `OFF`
  a dispatch attempt still refuses with **zero** runner invocations; the dry run is unchanged.
- **Deployed at M3, not at merge**, as that milestone's single control. Merging arms nothing;
  deployment arms nothing either, because the gate is what withholds permission.
- **Rollback:** revert this PR — a one-file change — and redeploy; or set the gate to `OFF`, which is
  faster and needs no deployment.
- **Prohibited:** any other change in the same PR; changing the authority gate; issuing a grant.

### Operator milestones

#### M1 — Migration 007 rollout, which is an API deployment *(REQUIRES OPERATOR ACTION)*

**This is first because of §4.0 and §4.4.** The runner sweeps every pending file and is reachable only
through the api `preDeployCommand`, so applying 007 **is a deployment of `gcd-social-api` at the
artifact commit** — not a standalone database operation. Doing it first, while `main` still carries no
migration beyond `007`, is what keeps the artifact current reviewed code with the authorized migration
set. **Whether that deployment is a forward one is a separate question, settled only by reading the
live commit `L` and evaluating the A/L ancestry predicate (§4.4.1)** — never by repository ordering,
and never before `L` is in hand.

- **Entry:** §4 gates G1–G2 satisfied; decision record committed, naming the authorized set as exactly
  `{007_evidence_bounds.sql}` **and naming the artifact commit by full SHA**. **P1 has not merged** —
  that is this milestone's protecting invariant, not a convenience.
- **Entry gate — the rollback artifact `R` must be proven compatible with the post-007 schema.**
  M1's recovery path redeploys the previously live application image **while leaving 007 applied**,
  which runs **old code against a newer schema**. That is only a recovery action if it is known to
  work, and it is not known by inspection. Before M1 may be authorized, identify and prove:

  | Item | Requirement |
  |---|---|
  | **`R`** | The exact rollback application commit / image — normally the **pre-M1 live api artifact**, i.e. `L`. Named by full SHA |
  | **Target schema** | The exact post-M1 schema state, **including migration 007's constraints** |
  | **Surface** | The application **read and write paths in `R`** that may execute against that schema — enumerated, not assumed |

  **Required executed compatibility evidence**, produced against a **disposable** database migrated
  through **007**, running the **exact `R` artifact** — on **PostgreSQL 16 and 18**, through CI where
  necessary, matching the coverage the rest of this repository already applies:

  1. **startup and readiness** — `R` boots and reports ready against the post-007 schema;
  2. **every production-reachable read** of the affected tables;
  3. **every production-reachable insert/update path** for affected rows;
  4. **values at and around each new 007 constraint** — at the bound, one inside, one outside;
  5. **ordinary existing valid rows** continue to read and write;
  6. **rollback/restart behaviour** — `R` survives a restart against that schema.

  **The gate fails if `R`:** writes rows that 007 rejects; assumes the earlier schema; cannot start or
  become ready; or **lacks coverage for any affected production write path.**

  **Do not equate "the migration is additive", "the constraint is `NOT VALID`", or "the old image
  starts" with compatibility.** None of those establishes that `R`'s *writes* are still accepted; a
  tightened bound rejects new rows the old code was free to insert, while the service appears healthy.

  **If `R`'s post-007 compatibility cannot be established before M1:**
  - **redeploying `R` is not an authorized recovery action**, and must not be described as one;
  - **M1 must not begin** until a separately reviewed recovery plan exists;
  - that plan must choose and validate **either** a **forward-compatible recovery artifact** (proven
    against the post-007 schema on the same terms), **or** a **separately authorized database-first
    rollback** using `state/rollback/007_evidence_bounds_rollback.sql`, with its own backup,
    data-safety analysis, validation, service ordering, and failure handling;
  - **no database rollback may be improvised after a failure.** It is planned before M1 or it is not
    available.

  **Application rollback and database rollback are separate authorities and separate operations.**
  Restoring service identity does **not** restore the prior schema: redeploying `R` returns the code,
  and only 007's rollback file returns the schema, under its own authorization.

- **The artifact** is the reviewed head of `main` at this time and must satisfy **A1–A5** of §4.4:
  an exact reviewed commit with exact-head CI green; `001`–`007` and no later migration, enumerated;
  application code separately approved as safe to deploy **and safe to serve**; a production
  **complete migration-state check** of §4.4.2 — `F(A)` exactly `001`–`007`, `D` exactly the baseline
  `001`–`006`, `P` exactly `{007_evidence_bounds.sql}`, **all seven comparisons passing**; and
  **satisfaction of the A/L ancestry predicate** (§4.4.1). **Any mismatch stops the milestone.**
- **Action:**
  1. **Record exact deployed identity before** — read the commit each of the three services is running
     from the running system, read-only. It is **UNKNOWN until read** and may not be inferred from
     `main`, from `render.yaml`, or from any dated record here.
  2. **A5 — evaluate the A/L ancestry predicate** (§4.4.1) with `A` = the artifact commit and `L` =
     the live api commit just read. Proceed only if `A == L` or `L` is an ancestor of `A`. **Stop** if
     `A` is a proper ancestor of `L` (a runtime rollback), if neither is an ancestor of the other
     (divergent histories), or if `L` could not be obtained — each needs its own authorization and
     review, not this milestone's. Only once the predicate passes may this deployment be described as
     a forward deployment.
  3. **G3a — the complete migration-state check of §4.4.2**, computed against the target database
     **before triggering the deploy**. Enumerate `F(A)` (the `*.sql` identifiers at `A`) and `D` (the
     `_migrations` rows, read-only, with row count and distinct-identifier count), derive
     `P = F(A) − D`, and require **all seven comparisons** against M1's expected sets: `E_files` =
     `001`–`007` **and no later migration**; `E_applied_pre` = **exactly the authorized baseline
     `001`–`006`**; `E_pending` = exactly `{007_evidence_bounds.sql}`; `E_applied_post` = exactly
     `001`–`007`. **Stop on any failure** — including an **unexpected already-applied migration**,
     which `P` alone cannot see because it cancels out of the difference. There is no intervention
     point once the deploy starts.
  4. **Complete §4.4.2 Part 1 — the pre-deployment record**, before triggering anything:
     `artifact_sha`, `live_api_sha`, `ancestry_decision`, `F(A)`, `D`, `P`, **all four expected sets**
     (`E_files`, `E_applied_pre`, `E_pending`, `E_applied_post`), the outcome of **each of the seven
     comparisons individually**, and the pass/stop decision. **Do not trigger the deployment unless
     that decision is `pass`.**
  5. **Deploy `gcd-social-api` at the artifact commit, and nothing else** — not the worker, not the
     scheduler. Its `preDeployCommand` is the single migration authority (G4, G5), which is exactly
     why only the api is deployed.
  6. **Complete §4.4.2 Part 2 — the post-deployment closure**, from readings taken now that the
     deployment has run: **`D_post`** enumerated; **`post_comparison`** — the recorded outcome of
     `D_post == E_applied_post`, match or mismatch with the differing identifiers named; and
     **`post_decision`** — **validated, milestone complete**, or **rollback initiated**, naming the
     path taken from this milestone's rollback ladder and the reason. **A mismatch requires the
     rollback branch**, never a noted variance. Recording `D_post` alone does not close the milestone:
     without the comparison outcome and the decision, nothing records whether the applied state
     matched or what was done about it. **M1 is not complete until this step is.**
- **Exit, all required:**
  1. G6 and G7 pass; `_migrations` holds `007` exactly once and **no file outside the authorized set**;
  2. **exact deployed identity after** — `gcd-social-api` reports the artifact commit; the worker and
     scheduler report **unchanged** commits;
  3. **health verification** — `/healthz` passes and the durable health/readiness checks are observed
     green;
  4. **safe to serve under the tightened schema** — confirmed by the health check and by G7's
     boundary-record probe, not assumed from the derivation.
- **The partial-release interval this milestone deliberately creates.** When `A ≠ L`, M1 advances
  **only the api**; the worker and scheduler stay at their previous commits by design, because that is
  what keeps the api the single migration runner. **This intentionally produces exactly the
  service-identity mismatch the automated controller treats as `PARTIAL_RELEASE_STATE`**, and which
  [`docs/DEPLOYMENT.md`](DEPLOYMENT.md) describes as failing "for controlled recovery". Therefore, for
  the whole M1→M2 interval:
  - **ordinary automated deployment is prohibited** — the controller would stop, and it must not be
    forced past;
  - **no unrelated release may occur**, of any service, for any reason;
  - the interval must be **explicitly time-bounded**, actively **monitored**, and **owned by the named
    operator** who performed M1;
  - **M2 is the controlled reconciliation step** that returns all three services to one commit;
  - if M2 is delayed beyond the stated bound or fails, the recovery path is explicit **and is whichever
    path the entry gate proved**: where `R`'s post-007 compatibility was established, **redeploy the api
    to the commit recorded in step 1**, returning the three services to agreement — noting that **this
    does not unapply 007**, so the database stays ahead of the code until 007's rollback file is
    separately authorized and applied. Where it was **not** established, that redeploy is **not
    available**, and the separately reviewed recovery plan required by the entry gate is the only
    path.
- **Rollback, defined before proceeding — two independent operations under two separate authorities,
  in this order, and only along the path the entry gate proved:**
  1. **Application rollback** — redeploy the exact commit recorded in step 1 (`R`). **Permitted only
     because, and only if, the entry gate established `R`'s compatibility with the post-007 schema.**
     This does **not** unapply 007; the schema stays ahead of the code.
  2. **Database rollback** — only if **separately authorized**, apply
     `state/rollback/007_evidence_bounds_rollback.sql`, which relaxes the database only; the TypeScript
     contract still refuses an oversized record.

  Neither implies the other, and **restoring service identity does not restore the prior schema.** If
  the entry gate did not establish `R`'s compatibility, step 1 is unavailable and the recovery plan
  named in the entry gate replaces this ladder.
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
  1. **G3a before triggering the deploy** — the **complete migration-state check of §4.4.2** against
     the exact commit about to be deployed: `F(A)` exactly through `008`, `D` exactly through `007`,
     `P` exactly `{008_...sql}`, `E_applied_post` exactly through `008`, and **every one of the seven
     comparisons passing** — not merely that pending looks right. **Stop on any failure**, including
     an **unexpected already-applied migration**. There is no opportunity to intervene once the deploy
     starts.
  2. one runner, transactional apply, post-apply validation.
  008 needs no data audit — it creates new tables and validates nothing against existing rows — but it
  still needs its own authorization and its own post-apply check.
- **M2 proceeds from a deliberately partial state, and bypasses the automated controller.** M1 left
  the api ahead of the worker and scheduler (when `A ≠ L`), which the controller treats as
  `PARTIAL_RELEASE_STATE` and refuses to release from. **M2 is therefore executed as an explicitly
  authorized manual departure from the controller**, not through it — and consequently carries every
  gate the controller would otherwise have supplied, itself: a pinned artifact, the A/L ancestry
  decision, the complete migration-state gate, its own authorization, health verification, and a
  defined rollback.
- **Action, in this order:**
  1. **Record all three service identities, read-only** — the exact commit the api, worker and
     scheduler are each serving. Each is **UNKNOWN until read** and may **not** be inferred from
     `main`, from `render.yaml`, or **from M1's record**: live state can change between milestones, so
     **M1's ancestry result may not be reused.**
  2. **Evaluate the A/L ancestry predicate** (§4.4.1) with **`A`** = the exact artifact about to be
     deployed and **`L`** = the live api commit just read, **before triggering the deployment**.
     Proceed only if `A == L` or `L` is an ancestor of `A`. **Stop** if `A` is a proper ancestor of `L`
     (a runtime rollback), if neither is an ancestor of the other (divergence), or if `L` cannot be
     obtained.
  3. **G3a / §4.4.2 — the complete migration-state check.** Enumerate `F(A)` and `D`, derive `P`, and
     require **all seven comparisons** to pass against M2's expected sets: `E_files` exactly through
     `008`, `E_applied_pre` exactly through `007`, `E_pending` exactly `{008_…sql}`, `E_applied_post`
     exactly through `008`. **Stop on any failure**, including an unexpected already-applied
     migration. **Complete §4.4.2 Part 1 — the pre-deployment record** — every Part 1 field,
     including `D`, all four expected sets and the seven comparison outcomes — and do not trigger
     unless its decision is `pass`.
  4. **Deploy** the reviewed inert code, api → worker → scheduler, reconciling all three services to
     one commit and ending the partial-release interval.
  5. **Complete §4.4.2 Part 2 — the post-deployment closure**: `D_post`, `post_comparison` against
     `E_applied_post` (exactly through `008`), and `post_decision`. **M2 is not complete until this
     step is.**
- **Leaves unauthorized:** both dispatch ceilings, live execution, approval, publication. Nothing is
  enabled and no grant exists.
- **Verify, and record:**
  1. the exact deployed commit on **each of the three services, before and after**, compared against
     the reading taken in action step 1 — **all three must now report the same commit**, so the
     partial-release interval is demonstrably closed — with `/healthz` plus the durable
     health/readiness checks observed green;
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

#### M3 — Deploy P8, the registry activation *(REQUIRES OPERATOR ACTION)*

**This is a deployment act, not an authority act.** It changes exactly one control — the registry
`executionEnabled` field — and it is a separate milestone from M4 precisely because M4's first act
also needs a deployment but changes a *different* control. Two controls means two acts, and therefore
two deployments; collapsing them would breach the one-control-per-act rule (§3.3).

- **Entry:** M1 and M2 complete and verified; **P8 merged with exact-head CI green**; the durable
  authority gate reads `OFF`, confirmed from the running system.
- **Control changed:** registry `executionEnabled`, six values, via the deployed commit. **Nothing
  else.**
- **Action, in this order — this is an api deployment, so it takes the full §4.4.2 preflight:**
  1. **Record all three service identities, read-only.** UNKNOWN until read; **M2's readings may not
     be reused.**
  2. **Evaluate the A/L ancestry predicate** (§4.4.1) with `A` = the pinned P8 commit and `L` = the
     live api commit just read. Proceed only on `A == L` or `L` ancestor of `A`; stop on
     proper-ancestor, divergence, or unobtainable `L`.
  3. **§4.4.2 complete migration-state gate.** `E_pending` is **EMPTY**, because 007 and 008 are
     already applied — but emptiness alone is not the test: **all seven comparisons must pass**,
     with `E_files` and `E_applied_pre` both the exact authorized inventory and `E_applied_post`
     unchanged. **Stop on any failure** — a non-empty `P`, **or an unexpected already-applied
     migration that leaves `P` empty**, or an applied identifier absent from the artifact — each
     requiring its own audit, decision record, authorization, validation and rollback plan before this
     deployment may be retried. **Complete §4.4.2 Part 1 — the pre-deployment record** — and do not
     trigger unless its decision is `pass`.
  4. **Deploy** P8 at that exact pinned commit, api → worker → scheduler, with the same
     identity-and-health discipline M2 defines.
  5. **Complete §4.4.2 Part 2 — the post-deployment closure**: `D_post`, `post_comparison` against an
     `E_applied_post` unchanged from `E_applied_pre`, and `post_decision`. **M3 is not complete until
     this step is.**
- **Why this arms nothing:** with P2 merged, `executionEnabled: true` satisfies only *half* of layer
  5. The durable gate still reads `OFF`, so C1–C3 refuse. **This is why the earlier "every executor
  stays disabled while shadow produces stage results" sequencing was impossible: with P2 enforcing
  the registry field, stage results require the field to be true.**
- **Acceptance evidence:** exact deployed commit per service recorded; `/healthz` and the durable
  health/readiness checks green; **effective authority still reads `OFF`** from the running system;
  all three dispatch controls still off; no grant exists.
- **Rollback:** revert P8 and redeploy the previously recorded commit; or, faster and needing no
  deployment, leave the gate `OFF` — which already denies everything.
- **Prohibited:** touching the authority ceiling, the durable gate, any dispatch ceiling, or issuing
  a grant.

#### M4 — Pre-shadow authorization: five separately authorized single-control acts *(REQUIRES OPERATOR ACTION, separately reviewed)*

**This milestone replaces the earlier draft's single "authorize shadow" step, which changed several
controls at once.** That breached this design's own rule that **no act changes more than one authority
control** (§3.3) — its act 3 moved both the durable gate and the deployment-time ceiling — and it
folded run submission into the same step as grant issuance, so a grant could not be reviewed before it
was spent.

**The controls, enumerated, and the one act that changes each:**

| Act | The single control it changes | Mechanism | Effective when |
|---|---|---|---|
| **M4.1** | `CONTENT_INTELLIGENCE_MAX_AUTHORITY` — the deployment-time authority ceiling | Pinned configuration deployment / service restart | On restart |
| **M4.2** | The **durable authority gate** row | Authenticated console route or authorized statement | At the next gate check — no deployment |
| **M4.3** | `CONTENT_INTELLIGENCE_MANUAL_DISPATCH_ENABLED` — the bounded-manual dispatch ceiling (layer 4a) | Pinned configuration deployment / service restart | On restart |
| **M4.4** | One **manual-dispatch grant** row (§3.2.1) | Authenticated console route | At the next run acceptance |
| **M4.5** | None. It **consumes** the grant rather than changing a ceiling | Explicit operator run submission | Immediately, atomically |

**Ordering is explicit and not interchangeable:**

1. **M4.1** — ceiling deployment **while the durable gate is still `OFF`**;
2. deployed identity, health, and **effective-authority-still-`OFF`** verification — the *acceptance
   evidence for M4.1*, not a control mutation of its own;
3. **M4.2** — durable transition to `SHADOW`;
4. **M4.3** — bounded-manual dispatch ceiling authorization;
5. **M4.4** — grant issuance;
6. **M4.5** — explicit run submission and atomic consumption.

Each of the five acts carries its own authorization, its own named authorizer, and its own audit
record. **None may be granted together with another.**

##### M4.1 — Raise the deployment-time authority ceiling, and nothing else

- **Entry:** M3 complete and verified; the durable gate confirmed `OFF` from the running system.
- **Authorize:** changing **only** `CONTENT_INTELLIGENCE_MAX_AUTHORITY` from `OFF` to `SHADOW`, on the
  worker and api.
- **Apply through a distinct pinned configuration deployment / restart** — this control is read at
  process start, so it takes effect only on restart, and that restart is part of the act.
- **This restart is an api deployment for gating purposes, and takes the full §4.4.2 preflight.**
  A configuration-only change does **not** avoid the migration runner: §3.2 records that changing a
  Render environment variable triggers a restart or redeploy, which for the api runs
  `preDeployCommand`. So before triggering it: read all three service identities; **establish
  `A == L` rather than assuming it** (a configuration act ordinarily does not change the image, but
  equality is verified, not presumed, and the ancestry outcome is recorded either way); run the
  **complete §4.4.2 migration-state check** — `F(A)`, `D`, `P`, the exact authorized inventory for
  `E_files` and `E_applied_pre`, `E_pending` **EMPTY**, `E_applied_post` unchanged — and **stop unless
  all seven comparisons pass**, an unexpected already-applied migration included; and **complete
  §4.4.2 Part 1, the pre-deployment record**, triggering only on a `pass` decision.
- **After the restart, complete §4.4.2 Part 2 — the post-deployment closure**: `D_post`,
  `post_comparison` against an unchanged `E_applied_post`, and `post_decision`. **This act is not
  accepted until that closure is recorded.**
- **Deliberately unchanged:** the durable authority gate stays **`OFF`**; manual, scheduled and queue
  dispatch all stay **off**; approval and publication remain unauthorized.
- **Acceptance evidence:** exact deployed identity per service; `/healthz` and durable
  health/readiness green; **effective authority still reads `OFF`** — because the effective mode is
  the *lower* of ceiling, gate and grant, raising the ceiling alone changes nothing observable, and
  that is the point;
- **Rollback:** return the variable to absent/`OFF` and restart.

##### M4.2 — Transition the durable authority gate `OFF → SHADOW`, and nothing else

- **Entry:** M4.1 accepted, including its effective-`OFF` verification.
- **Authorize:** separately, on its own, `OFF → SHADOW`.
- **Change only** the durable authority gate row; write the append-only history row in the same
  transaction, recording who, when, from what, to what, and why.
- **Acceptance evidence:** effective authority now reads **`SHADOW`** from the running system, **while
  all three dispatch controls remain off** and no grant exists — so nothing can yet start.
- **Rollback:** set the gate back to `OFF`. No deployment, no authorization ceremony.

##### M4.3 — Raise the bounded-manual dispatch ceiling, and nothing else

- **Entry:** M4.2 accepted.
- **Authorize:** changing **only** `CONTENT_INTELLIGENCE_MANUAL_DISPATCH_ENABLED`, applied through its
  own pinned configuration deployment / restart.
- **That restart is an api deployment for gating purposes and takes the full §4.4.2 preflight**, on
  the same terms as M4.1: three service identities read, `A == L` **established rather than assumed**,
  the **complete §4.4.2 migration-state check** run with `E_pending` **EMPTY** and **all seven
  comparisons passing** — not merely an empty pending set — and **§4.4.2 Part 1, the pre-deployment
  record**, captured before triggering. **After the restart, §4.4.2 Part 2 — the post-deployment
  closure** (`D_post`, `post_comparison`, `post_decision`) is recorded, and this act is not accepted
  until it is.
- **Deliberately unchanged:** `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED` remains **off**, so
  scheduled, cron, automatic and queue dispatch remain off. Layer 4a never implies 4b (§3.1).
- **Acceptance evidence:** a run submission attempted with **no grant** is refused at C1 — proving the
  ceiling is a ceiling and not a permission.
- **Rollback:** return the variable to absent and restart.

##### M4.4 — Issue exactly one bounded manual-dispatch grant, and nothing else

- **Entry:** M4.3 accepted.
- **Authorize and issue:** one grant (§3.2.1) that is **bounded, expiring, and run-specific or
  strictly limited** — an explicit small `runs_remaining`, an explicit `expires_at`, and
  `max_authority: SHADOW`.
- **Issuing the grant must not submit a run and must not change any ceiling.** Issuance and
  consumption are different acts, which is what makes a grant reviewable before it is spent.
- **Record:** who authorized it, its scope, its expiry, its permitted run count, and the audit
  identity of the issuer.
- **Rollback:** set `runs_remaining` to zero, or let it expire. No deployment.

##### M4.5 — Submit the named shadow run and consume the grant

- **Entry:** M4.4 accepted; a grant exists, unexpired, with `runs_remaining > 0`.
- **Action:** an authorized operator **explicitly submits** the named run through the manual
  acceptance path. The grant is **consumed atomically** — the decrement and the run-row creation
  commit together or not at all.
- **Submitting a run changes no authority ceiling.** It spends an existing permission; it creates none.
- **Fails closed on:** expiry, reuse of a spent grant, scope mismatch, and concurrent consumption —
  two simultaneous submissions against `runs_remaining: 1` result in exactly one accepted run.
- **Expected:** stage results and audit records; model-provider requests occur and are counted
  (§7.4); **zero** approval transitions and **zero** publication-provider requests, both **refused at
  C4 and C5** rather than merely not attempted.
- **Rollback:** set the gate to `OFF`, or zero the remaining grant.

##### Rollback per control, and the emergency-stop order

Each control rolls back on its own terms: the durable gate by setting `OFF`; the grant by zeroing
`runs_remaining`; each ceiling by returning its variable to absent and restarting; P8 by revert and
redeploy.

**Emergency stop has a required order — the durable gate first:**

1. **Set the durable authority gate to `OFF`.** It takes effect at the next check, needs no
   deployment, and denies at all five checkpoints C1–C5.
2. **Then** zero any outstanding grant, which denies at C1 independently of the gate.
3. **Then** disable the dispatch ceilings — scheduled before manual. These need a restart, so they are
   the slowest step and never the first response.

Reversing that order would leave the fastest control unused while waiting on a restart.

##### Why M4 cannot permit scheduled live execution or publication

- The **scheduled** dispatch ceiling is untouched throughout M4 and still off, and layer 4a never
  implies 4b (§3.1). The grant is consulted only on the manual acceptance path, so nothing recurring
  can start.
- The grant is **bounded and expiring**, and consumed transactionally, so it authorizes exactly the
  runs it names — not a standing permission.
- The effective mode is the **lower** of ceiling, gate and grant, and no act in M4 raises any of the
  three above `SHADOW`.
- `SHADOW` refuses at **C4** and **C5**, which have owning implementations (P5, P6), so no result can
  reach an approval transition or a publication regardless of what else is true.
- Publication-provider requests are impossible: C5 refuses before the publication handoff, and the
  existing Phase 0A guard still sits behind the approval that `SHADOW` forbids.
- Layer 6 remains mandatory and unbypassable regardless of mode.

#### M5 — Shadow evidence collection and review *(REQUIRES OPERATOR ACTION)*

- **Entry:** the M4.4 grant is spent or expired, so no further manual run can start without a new
  separately authorized grant.
- **Action:** collect the evidence defined in §7.4 and review it. No system change. Returning the gate
  to `OFF` while reviewing is encouraged and costs nothing.

#### M6 — Post-shadow promotion decision *(REQUIRES OPERATOR ACTION, separately reviewed)*

- **Action:** a separate, recorded decision on whether the shadow evidence supports `LIVE`
  *eligibility*. A decision to promote is **not** itself a promotion.
- **Exit:** a committed decision record naming the authorizer, the evidence relied on, and the
  conditions.

#### M7 — Live scheduled-dispatch authorization *(REQUIRES OPERATOR ACTION)*

- **Action — three separate single-control acts on the M4 pattern, never granted together:**
  **M7-a** raise `CONTENT_INTELLIGENCE_MAX_AUTHORITY` to `LIVE`; **M7-b** raise
  `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED`; **M7-c** transition the durable gate to `LIVE`.
  This is the first step at which layer 4b is satisfied.
- **The two configuration acts do not target the same services, and the earlier claim that "each
  restarts the api" was wrong.** Ownership decides which services restart, and therefore whether the
  api migration runner is reached at all. From the §5.3 ownership table:

| Act | Control | Old → new | Services changed | Those services restart? | Api a target? | Api `preDeployCommand` runs? | Required checks |
|---|---|---|---|---|---|---|---|
| **M7-a** | `CONTENT_INTELLIGENCE_MAX_AUTHORITY` | `SHADOW` → `LIVE` | **worker, api** | yes, both | **yes** | **yes** | **Before triggering:** the full **§4.4.2 preflight** — all service identities read, `A == L` **established rather than assumed**, `F(A)`/`D`/`P` validated with `E_pending` **empty** and `E_applied_pre` the exact authorized inventory, and **§4.4.2 Part 1 (the pre-deployment record)** captured, triggering only on a `pass`. **After the restart:** api and worker identity + `/healthz` + durable readiness, and **§4.4.2 Part 2 (the post-deployment closure)** — `D_post`, `post_comparison`, `post_decision` — without which the act is not accepted. Rollback = restore the previous value and restart |
| **M7-b** | `CONTENT_INTELLIGENCE_SCHEDULED_DISPATCH_ENABLED` | absent/off → on | **worker, scheduler** | yes, both | **no** | **no** | **No migration gate**, because no api deployment occurs and no migration runner is reached. Instead: **worker and scheduler** identity recorded before and after, their health/readiness observed green, and the api confirmed **unchanged**; rollback = restore the previous value and restart those two services |
| **M7-c** | The **durable authority gate** row | `SHADOW` → `LIVE` | none — a control-plane row | no restart | no | no | No deployment and therefore no preflight; append-only history row; rollback = set the value back |

  **M7-b restarts only the worker and scheduler.** It must not be described as an api restart, must not
  claim an api `preDeployCommand` invocation, and does not inherit the api migration gate — a
  worker-or-scheduler-only restart reaches no migration runner. **No companion api deployment is added
  to it**: manufacturing one merely to preserve a uniform description would be a real production action
  taken for a documentation convenience.
- **The three acts remain separately authorized single-control acts** — M7-a, M7-b and M7-c each change
  exactly one control, each carries its own authorization and audit record, and **none may be granted
  together with another.**
- **Scheduled dispatch is authorized only to the exact bounded extent M7 defines** — the cadence,
  window and per-period run count named in its authorization, and no more.
- **Manual dispatch is *unavailable* after M7 unless a new, separately authorized bounded grant is
  issued.** The shadow grant issued at M4.4 was bounded and expiring and was spent during M4.5; **a
  spent or expired grant cannot be reused**, and C1 refuses a manual submission without a valid one.
  **M7 issues no manual grant**, and this design does not add a replacement one to it: a later manual
  run needs its own M4.4-shaped act, authorized on its own terms.
- **Still independent:** `LIVE` authorizes neither approval nor publication. It removes the C4 and C5
  refusals, but **approval and publication remain separate controls and are not implied by scheduled
  dispatch**: layer 6 remains mandatory and layer 7's per-request guard is unchanged, so an approval
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
real-model evidence. Only **M4.5** produces real-model evidence.

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
10. After M7, a manual submission with no valid grant was observed **refused at C1** — establishing
    that scheduled authorization did not silently restore manual dispatch.
11. Each authority control was observed changing **on its own act**, with its own authorization record:
    no audit entry shows two controls moving together.

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

**It grants no authorization.** It is accepted and merged **as a design** (see the Status section at
the top of this document), and acceptance authorizes nothing: every layer in §3, every gate in §4, and
every PR and milestone in §6 still requires its own review, its own explicit authorization, and its
own evidence. **No milestone M1–M7 has been performed, and no implementation PR P1–P8 exists.**
