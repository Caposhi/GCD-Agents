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
execution, *before* any caller exists (§6, P2 — after P1, which creates the control plane the same
boundary must also consult).

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
  brief id, evidence-pack `builtAt`, the exact pack digest, the code version, and the authority mode
  observed at dispatch (§3.2).
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

**PROPOSED** — seven layers, each independently switchable, each proven separately. **No single flag
or deployment may satisfy more than one.**

| # | Layer | Satisfied by | Not implied by |
|---|---|---|---|
| 1 | **Code presence** | Merge to `main` | Anything else |
| 2 | **Deployment** | A release carrying that commit observed live on the owning service | Merge |
| 3 | **Database readiness** | Migration 007 applied **and post-apply-validated** (§4) | A deployment having run. §4.0: an api deploy *does* apply pending migrations, which is exactly why this design applies 007 deliberately under its own gates first — an apply that happened as a deployment side effect satisfies this layer no more than not applying it at all, because nothing validated it |
| 4 | **Runtime reachability (dispatch)** | A caller exists *and* dispatch is permitted | Code presence |
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

**PROPOSED — the gate is read at five points, every time, never cached across them:**

1. Before accepting a new run.
2. Before **every** stage starts.
3. Before **every** provider request of any kind.
4. Before any approval transition.
5. Before any publication.

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

### 3.3 Distinguishing the three controls

These are three different things and must never be collapsed:

| Control | Where it lives | Who changes it | When it takes effect |
|---|---|---|---|
| Registry `executionEnabled` | Source (`registry.ts`) | A reviewed, merged PR | On deployment of that commit |
| Proposed environment variables | Render service configuration | An operator, per service | On service restart/redeploy — a deployment-time **ceiling**, not an operational switch |
| **Proposed runtime authority gate** | Durable control-plane row | An authorized human via console route or authorized statement | At the next gate check — **no deployment** |

### 3.4 Rollback and emergency disable

**PROPOSED**, least to most disruptive:

1. **Set the authority gate to `OFF`.** No new runs; no further stages; no further provider requests;
   in-flight work cannot progress. **No deployment.**
2. **Withdraw dispatch.** Remove the run trigger so nothing attempts a run.
3. **Revert the release.** Ordinary application rollback, safe only if the code being rolled back
   to tolerates the applied migration set — the property that was tested for 006.
4. **Revert the merge.** Repository-level.

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
  deployment (M2), and why M2 — which carries migration 008 from P1 — is itself migration-bearing.
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
| **G4 Single runner** | Exactly one migration authority; no schema-dependent consumer racing it | More than one runner, or a consumer started early |
| **G5 Transactional apply** | Applied by `npm run migrate`, which wraps each file in `BEGIN…COMMIT` | Applied by hand via `psql -f` — **VERIFIED** that this silently disables the `SET LOCAL` timeout guards |
| **G6 Collision** | 007's helper uses plain `CREATE`, so an exact-name collision aborts without overwriting | Collision detected → abort, do not force |
| **G7 Post-apply validation** | `_migrations` holds `007` exactly once; every constraint present; a boundary record inserts and an over-bound one is rejected | Any check fails → rollback per `state/rollback/007_evidence_bounds_rollback.sql` |
| **G8 Reapply** | Only after the cause is fixed and the audit re-run | Reapplying over unexplained failure |

**PROPOSED** — 007 must **not** be applied in the same change as deployment, enablement, or
publication (§6).

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
| `CONTENT_INTELLIGENCE_DISPATCH_ENABLED` | worker, scheduler | Layer-4 dispatch ceiling | absent ⇒ disabled |
| `CONTENT_INTELLIGENCE_MAX_AUTHORITY` | worker | Deployment-time **ceiling** on the authority gate (`OFF`/`SHADOW`/`LIVE`); the effective mode is the *lower* of this and the gate | absent ⇒ `OFF` |

**These variables are a ceiling, not the operational control.** The mutable runtime authority gate
(§3.2) is what an operator turns off in an emergency. Every value defaults to *off when absent*, so a
service that never received the variable is safe rather than enabled.

**Deployment ordering:** database first and separately (007 under M1, then 008 as part of the
migration-bearing release described in M2 — see §4.0, because the api `preDeployCommand` applies
whatever is pending) → api → worker → scheduler, matching the merged controller's existing serialized
order, with dispatch permitted **last** and only under its own authorization.

**UNKNOWN** — whether the deployment automation gate is currently on, whether native auto-deploy is
off, and what the services currently run. Each must be re-verified read-only immediately before any
production operation; none may be inferred from `render.yaml` or from this document.

---

## 6. Rollout sequence

**PROPOSED.** The sequence contains **five implementation PRs (P1–P5)** and **seven operator
milestones (M1–M7)**. They are different kinds of thing and are numbered separately: a PR is reviewed
and merged; a milestone is performed by an authorized operator and produces an evidence record, not a
diff.

**No step combines enablement or publication with anything else.** Migration application and
deployment cannot be fully separated — §4.0 establishes that the api `preDeployCommand` applies
whatever migration is pending — so where a release is unavoidably migration-bearing (M2), it is
declared as such and takes the migration-bearing rollout with post-apply validation, rather than
being described as a plain deploy. Enablement (M3) and any publication path remain separate steps
that share a milestone with nothing.

### Implementation PRs

#### P1 — Durable schema: runs, stage results, and the authority control plane

**This is first because P2 cannot enforce a gate that has nowhere to live.** The boundary check in P2
reads the authority value; the table and its contract must exist before that check can be written or
tested.

- **Entry:** this design accepted.
- **Change:** additive migration (008) for `content_intelligence_runs`,
  `content_intelligence_stage_results`, `content_intelligence_authority` and its append-only history,
  plus rollback file, TypeScript contracts, and a reader that resolves the effective mode. The
  authority row is seeded `OFF`.
- **Exit:** disposable PostgreSQL 16/18 apply / enforce / rollback / reapply coverage; a regression
  proves an absent, unreadable, or unrecognized mode resolves to `OFF`.
- **Rollback:** revert; 008 has not been applied to production by this PR.
- **Prohibited:** applying **any** migration to production; wiring a caller; changing any
  `executionEnabled` value; touching `render.yaml`.

#### P2 — Enforce both components of layer 5 at the execution boundary *(no caller yet)*

- **Entry:** P1 merged.
- **Change:** `invokeStage` refuses unless **both** the stage's registry `executionEnabled` is true
  **and** the runtime authority gate (read through P1's reader) permits. Layer 5 becomes real in both
  halves.
- **Exit:** regressions prove a stage refuses with **zero** runner calls when either component
  withholds permission, and that neither alone suffices.
- **Tests:** offline suite plus mutations removing each half, each failing its owning check.
- **Rollback:** revert.
- **Prohibited:** adding any caller; changing any `executionEnabled` value; touching `render.yaml`.

#### P3 — Dispatch skeleton, inert, with real reachability protection

- **Change:** `runContentIntelligenceRun` exists. **This is the PR that introduces a caller**, so it
  carries the stronger protection required by §1.3.1: transitive dependency/call-graph coverage where
  practical, **and** executed integration tests proving disabled and unauthorized entry points reach
  no executor with **zero** runner invocations.
- **Exit:** with the authority gate `OFF` (the seeded default), a dispatch attempt refuses before any
  stage, proven by execution rather than by source text.
- **Prohibited:** changing the authority gate; any provider call; any promotion of output.

#### P4 — Worker integration behind the dispatch ceiling

- **Exit:** with dispatch not permitted (the default), worker behavior is byte-identical to today,
  proven by the existing suites.
- **Prohibited:** permitting dispatch anywhere; publication paths.

#### P5 — Observability, audit records, metrics

- **Change:** structured run/stage audit records and metrics (§7). No behavior change.
- **Prohibited:** logging prompts, model prose, credentials, or evidence text.

### Operator milestones

#### M1 — Migration 007 rollout *(REQUIRES OPERATOR ACTION)*

**This is first because of §4.0:** the migration runner sweeps every pending file, so the first api
deployment carrying 007 would apply it as an unaudited side effect. 007 is therefore applied
deliberately, under its own gates, before any deployment of new code.

- **Entry:** §4 gates G1–G2 satisfied; decision record committed. **No dependency on P1–P5** — this
  milestone concerns only the migration already in source.
- **Action:** the separately authorized migration-bearing rollout, applied by `npm run migrate` per
  gate G5. **No code change.**
- **Exit:** G7 post-apply validation passes; `_migrations` holds `007` exactly once.
- **Rollback, defined before proceeding:** `state/rollback/007_evidence_bounds_rollback.sql`, applied
  by hand under its own authorization. It relaxes the database only; the TypeScript contract still
  refuses an oversized record.
- **Prohibited:** combining with any code change, deployment of new behavior, or enablement.

#### M2 — Deploy the inert implementation, and verify it *(REQUIRES OPERATOR ACTION)*

**This milestone exists because deployed behavior cannot be tested before it is deployed.** P1–P5 are
merged but, until this milestone, not running anywhere.

- **Entry:** M1 complete and verified; P1–P5 merged; exact-head CI green.
- **This release is migration-bearing.** P1 adds migration 008, and the api `preDeployCommand` will
  apply it (§4.0). So this deployment uses the **separately authorized migration-bearing rollout**,
  not the ordinary controller path, and 008 gets the same G4–G7 discipline 007 received: one runner,
  transactional apply, post-apply validation. 008 needs no data audit — it creates new tables and
  validates nothing against existing rows — but it still needs its own authorization and its own
  post-apply check.
- **Action:** deploy **only** the reviewed inert code, in the order api → worker → scheduler.
- **Leaves unauthorized:** dispatch, live execution, approval, publication. Nothing is enabled.
- **Verify, and record:**
  1. the exact deployed commit on each of the three services;
  2. that the new entry point is **unreachable through normal production traffic** — no route, no
     schedule, and no queue path invokes it;
  3. that **every effective runtime gate reads `OFF`** — the seeded authority row, the dispatch
     ceiling, and the authority ceiling, each read from the running system rather than from
     configuration files;
  4. that all six registry `executionEnabled` values remain `false` in the deployed commit;
  5. that `_migrations` holds `008` exactly once and no unexpected file was swept in alongside it.
- **Rollback, defined before proceeding:** revert to the prior release, then — only if required —
  apply 008's rollback file by hand under its own authorization. Because 008 is purely additive and
  the prior release neither reads nor writes its tables, the prior release tolerates 008 remaining
  applied; that is the intended rollback, and dropping the tables is not part of it.
- **Prohibited:** enabling anything; any provider request; permitting dispatch.

#### M3 — Pre-shadow authorization *(REQUIRES OPERATOR ACTION, separately reviewed)*

**This is the step the earlier draft was missing, and its absence made shadow execution impossible.**

- **Entry:** M1 and M2 complete and verified (007 applied; the inert implementation deployed, verified, and reading `OFF`).
- **Exactly which controls change here, and nothing else:**
  1. **Registry `executionEnabled` → `true`, per stage**, by a reviewed and merged PR, then deployed
     through the same verified-deployment discipline M2 defines — a further deployment, performed the
     same way and verified the same way. This is a code change and cannot be an operator toggle. **This is why the
     earlier "every executor stays disabled while shadow produces stage results" sequencing was
     impossible: with P1 enforcing the registry field, stage results require the field to be true.**
  2. **The runtime authority gate → `SHADOW`**, by an authorized human, recorded in the history table.
- **What deliberately does not change here:** dispatch remains **not permitted** for scheduled or
  queue-driven paths; the authority ceiling is not raised to `LIVE`; approval and publication remain
  untouched.
- **Why this cannot permit scheduled live execution or publication:**
  - `SHADOW` mode itself prohibits approval transitions and publication at gate checks 4 and 5, so no
    result can reach either regardless of what else is true.
  - Publication-provider requests are impossible in `SHADOW`, because the gate is checked before
    every provider request and the publication guard sits behind the approval that `SHADOW` forbids.
  - Dispatch is not permitted, so nothing is scheduled: the only way a run starts is M4.
  - Layer 6 remains mandatory and unbypassable regardless of mode.
- **Rollback:** set the gate to `OFF` (no deployment); revert the enablement PR if needed.

#### M4 — Operator-triggered shadow execution *(REQUIRES OPERATOR ACTION)*

- **Action:** an authorized operator explicitly triggers a bounded number of runs. **Not scheduled,
  not queue-driven** — each run is an explicit act.
- **Expected:** stage results and audit records are produced; model-provider requests occur and are
  counted (§7.4); zero approvals; zero publication-provider requests.
- **Rollback:** set the gate to `OFF`.

#### M5 — Shadow evidence collection and review *(REQUIRES OPERATOR ACTION)*

- **Action:** collect the evidence defined in §7.4 and review it. No system change.

#### M6 — Post-shadow promotion decision *(REQUIRES OPERATOR ACTION, separately reviewed)*

- **Action:** a separate, recorded decision on whether the shadow evidence supports `LIVE`
  *eligibility*. A decision to promote is **not** itself a promotion.
- **Exit:** a committed decision record naming the authorizer, the evidence relied on, and the
  conditions.

#### M7 — Live dispatch authorization *(REQUIRES OPERATOR ACTION)*

- **Action:** raise the authority ceiling and gate to `LIVE`, and permit dispatch — **separate
  authorizations, not granted together.**
- **Still independent:** `LIVE` authorizes neither approval nor publication. Layer 6 remains
  mandatory; layer 7's per-request guard is unchanged.

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

**PROPOSED** — counts and rates only. **Alerts on**: any publication-provider request during shadow
(must be zero), any approval created during shadow (must be zero), deadline aborts, refusals by gate,
and any run terminalizing `operator_disabled`. No metric label may carry evidence text, a goal string,
or a credential.

### 7.6 Acceptance criteria for production validation

**PROPOSED** — a stage is `PRODUCTION-VALIDATED` only when *all* hold, each as evidence:

1. It executed in production against a real model, observed in durable state.
2. Its output validated deterministically; refusals were correct refusals.
3. Its model-provider request count matched one per executed stage, or the deviation is documented.
4. No approval was created except through the mandatory human gate.
5. No publication occurred except behind a passing publication guard.
6. Recovery was exercised: an interrupted run terminalized correctly and resumed nothing.
7. An authority-gate `OFF` transition was exercised and behaved as §3.2 specifies.

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
