# Production-wiring design — making the six dormant executors reachable, safely

**This document is a design. It implements nothing.** No source, test, migration, workflow,
configuration, `render.yaml`, agent, skill, or prompt file changes with it. Nothing here enables an
executor, applies a migration, deploys a release, contacts a provider, or publishes content. It is
the separately reviewed production-wiring design that [`docs/ROADMAP.md`](ROADMAP.md) names as the
next product cursor, and naming a design is not beginning the work it describes.

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
dated observation is not a statement about now. The correct reading is: **not established as
deployed**, which is different from "not deployed" — neither is proven here.

### 1.3 What is dormant, and *why* it is dormant

This is the most important finding in this document, because the reason differs from what a reader
would reasonably assume.

**VERIFIED** — all six registry entries carry `executionEnabled: false`
(`src/harness/agents/registry.ts`), and `grep -rn "executionEnabled: true" src/` returns **zero**
matches.

**VERIFIED — and load-bearing:** `executionEnabled` is a *declarative registry field that no
execution path consults*. `invokeStage` (`src/harness/agents/stageExecution.ts`) never reads it;
neither does any of the six executor modules. The only consumer is
`assertPreviewIsInert` (`src/harness/contentIntelligence.ts`), which reads it to keep the **preview**
inert.

Dormancy therefore rests on two *structural* facts, not on the flag:

1. **VERIFIED** — no production path calls any executor. The worker, scheduler, orchestrator, API,
   preview, approval, publication, provider, image, Slack, database, and evidence-write paths are
   each asserted unable to reach them by the offline suite. **How that is asserted matters:** the
   dormancy checks read each named source file and require that it neither imports nor references
   the executor (for example `AQ18a`–`AQ18e` in `src/harness/contentIntelligence.selftest.ts`).
   That is an *absence-of-caller* proof, which is exactly the right proof for today's design —
   and exactly the proof that stops holding the moment a caller is added.
2. **VERIFIED** — no executor has a default runner. Every executor requires the caller to supply
   one; `runBrief` additionally refuses injected seams when `config.nodeEnv === "production"`.

**Two consequences a wiring implementer must not get wrong:**

- Flipping `executionEnabled` to `true` today would, by itself, change **nothing**. It is not the
  gate it appears to be.
- Adding a caller would make a stage reachable **even with `executionEnabled: false`**. The flag
  would not stop it.

**PROPOSED** — the first implementation PR must therefore be the one that makes `executionEnabled`
actually gate execution, *before* any caller exists. See §6, PR-1. Building the caller first and the
gate second would create a window in which the only thing preventing execution is that nobody wrote
the call — which is exactly the property this design exists to replace with an enforced one.

### 1.4 Production evidence — available versus absent

| Item | State |
|---|---|
| Repository validation of the six executors and the payload contract | **VERIFIED** — offline suites, mutation harness, disposable PostgreSQL 16/18, exact-head CI |
| Any stage executing against a real model | **VERIFIED absent** — no stage in this repository has ever executed against a real model |
| Any stage reachable from a production path | **VERIFIED absent** |
| Live Render service state, versions, health | **UNKNOWN** — not inspected in this session |
| Production database contents | **UNKNOWN** — not inspected; no credential requested or held |
| Production evidence for the six executors | **VERIFIED absent — production evidence: none** |

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

The entry point is a **new deterministic orchestration function** — call it
`runContentIntelligenceRun(...)` — that lives beside the existing orchestrator rather than inside
it. It is *not* `runBrief`. Keeping it separate means the existing production posting path is
unchanged by construction, and can be reasoned about independently while the new path is dark.

Stage order is fixed and total; there is no branching, no skipping, and no reordering:

```
strategy-concept → automotive-truth → hook-story-script
                 → production-direction → packaging-adaptation → final-critic
```

The run is driven by the caller, not by the model: no stage chooses what runs next.

### 2.2 Typed handoffs

Each stage consumes the complete typed output of its predecessors and is revalidated against the
same evidence pack before any model call, through each owning module's exported revalidator. This is
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

**PROPOSED** — a run is durable from its first stage. The design reuses the existing durable
phase-marker discipline rather than inventing a second one:

- A `content_intelligence_runs` row is created **before** stage 1 executes, carrying the run id,
  brief id, evidence-pack `builtAt`, and the exact pack digest.
- A `content_intelligence_stage_results` row is committed **after each stage returns and validates**,
  before the next stage begins. Each row stores the typed output, the stage id, and the ordinal.
- Recovery is **refuse-don't-resume**, matching the merged worker recovery posture: a run whose owner
  is gone is terminalized and never continued. A partially completed run is never resumed against a
  different evidence pack, a different code version, or a different owner.

**PROPOSED** — the pack digest is the anchor. If a run is ever reconsidered, a pack whose digest
differs is a different run.

### 2.4 Idempotency and duplicate-run protection

**PROPOSED**, three independent layers, because one is not enough:

1. **Ownership.** The run executes only on the process holding the existing PostgreSQL
   session-level advisory lock. **VERIFIED** that this mechanism exists and is proven under real
   contention.
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
| Ownership lost mid-run | Process writes nothing further and exits non-zero (**VERIFIED** mechanism). The run is reconciled by the next owner's startup recovery |
| Cancellation requested | Cooperative: checked between stages only. A stage in flight completes or fails; it is never abandoned mid-request while a provider call is open |
| Partial run | Terminal and visible. **Never** promoted, never published, never partially approved |

**PROPOSED** — no retry is added anywhere. "Exactly one provider request per stage invocation" is a
merged guarantee (**VERIFIED**: `maxRetries: 0`) and the wiring must not weaken it by retrying at a
higher level.

### 2.6 Deterministic versus model-authored

| Deterministic (TypeScript) | Model-authored |
|---|---|
| Evidence pack construction and validation | Stage prose: angles, assessments, scripts, direction, captions, critique |
| Stage ordering and dispatch | — |
| Every validator and revalidator | — |
| Claim binding by evidence id | — |
| Approval creation, subject hashing, decision recording | — |
| Publication and every provider request | — |

**The boundary is unchanged by wiring:** no sentence a model writes becomes a claim, a citation, an
approval, or a publication. Model output is data that deterministic code validates.

---

## 3. Authority and safety gates

**PROPOSED** — seven layers, each independently switchable, each proven separately. **No single flag
or deployment may satisfy more than one.**

| # | Layer | Satisfied by | Not implied by |
|---|---|---|---|
| 1 | **Code presence** | Merge to `main` | Anything else |
| 2 | **Deployment** | A release carrying that commit observed live on the owning service | Merge |
| 3 | **Database readiness** | Migration 007 applied and verified (§4) | Deployment |
| 4 | **Runtime reachability** | A caller exists that can dispatch a run | Code presence |
| 5 | **Execution enablement** | The enforced `executionEnabled` gate is on for a stage | Reachability |
| 6 | **Human approval** | A durable, hash-bound approval decision by a person | Everything above |
| 7 | **Publication** | The existing Phase 0A publication guard passing immediately before each provider request | Approval alone |

**PROPOSED invariants:**

- **Layer 5 must be enforced at the execution boundary**, not merely declared. Until PR-1 lands, the
  flag is decorative (§1.3).
- **Layer 6 is mandatory and cannot be bypassed.** No autonomy value, environment variable, or
  configuration may skip it. **VERIFIED** that the merged code has no autonomy/boolean bypass.
- **Layer 7 is per-request, not per-run.** The guard revalidates the durable decision, exact payload,
  destination, media digest and current bytes immediately before *every* provider HTTP attempt —
  including retries and status polls. **VERIFIED** that this is the merged behavior.
- **Dry-run mode makes provider and publishing actions impossible, not merely skipped.** Simulated
  dry run already scrubs the sensitive environment and forces test mode before configuration-bearing
  imports (**VERIFIED**). The wiring must keep provider reachability a property of the *environment*,
  not a branch a bug could take.

### 3.1 Rollback and emergency disable

**PROPOSED**, ordered from least to most disruptive — an operator should reach for the first that
suffices:

1. **Disable execution.** Turn layer 5 off. New runs refuse at the boundary; in-flight runs
   terminalize. No deployment required.
2. **Stop dispatch.** Remove the run trigger. No new runs start.
3. **Revert the release.** Ordinary application rollback. **VERIFIED** that this is safe with respect
   to schema *only if* the code being rolled back to tolerates the applied migration set — the same
   property that was tested for 006.
4. **Revert the merge.** Repository-level.

**PROPOSED** — 007's rollback file relaxes the **database only**. The TypeScript contract still
refuses an oversized record, so the system continues to fail closed after a rollback. Rolling back
007 is not a way to accept larger evidence.

**Emergency disable must not require a deploy.** That is why layer 5 is a runtime gate rather than a
compile-time constant.

---

## 4. Migration 007

**This design treats the production audit as NOT YET EXECUTED.**

### 4.1 Prerequisite — a fresh, read-only, aggregate-only operator audit

**REQUIRES OPERATOR ACTION.** Run independently by an authorized operator, not from an agent session.
The checked-in, read-only, aggregate-only audit shape is the prerequisite. It must:

- run in read-only transactions;
- return **aggregates only** — counts, existence, maxima — and **never** raw claim text, subject
  text, PII, or credential values;
- request and receive **no** database credential on behalf of any agent session;
- establish, for `content_evidence` and `content_evidence_relations`: row counts; the maximum length
  of every text column 007 constrains, in **both** characters and UTF-8 bytes; the maximum canonical
  `jsonb::text` byte length of `detail`; tag-array cardinality and per-element length maxima,
  including NULL elements; and relation-note maxima.

**PROPOSED** — bounds are **not** chosen from this audit, and not from any document. They are already
derived in `payloadContract.ts` from the product contracts. The audit answers exactly one question:
*can the immediately validated constraints pass against the data actually stored?* If any measured
maximum exceeds its bound, the answer is no, and the apply does not proceed — the discrepancy is
resolved first, by a separately reviewed decision.

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
in this session, and none was authorized. What follows is repository design read from the committed
blueprint, deliberately kept separable from whatever is actually running.

### 5.1 Repository blueprint — VERIFIED from `render.yaml`

| Service | Type | Start command | Role today |
|---|---|---|---|
| `gcd-social-api` | web | `npm run start:api` | Health, protected control/console routes, approval review/action, media. Runs `npm run migrate` as `preDeployCommand` |
| `gcd-social-worker` | worker | `npm run start:worker` | Queue consumption, orchestration, approval wait, the only publication handoff |
| `gcd-social-scheduler` | cron `0 13 * * *` | `npm run start:scheduler` | Enqueues one brief daily; does not publish |
| `gcd-social-db` | PostgreSQL | — | Durable state |

### 5.2 Proposed ownership — prefer existing infrastructure

**PROPOSED** — no new Render service. Each responsibility maps onto a service that already owns that
class of work:

| Responsibility | Owner | Rationale |
|---|---|---|
| Run dispatch / orchestration | **worker** | Already holds exclusive ownership, recovery, and the long-running execution model |
| Stage execution | **worker** | Already the only service with `ANTHROPIC_API_KEY` |
| Scheduling | **scheduler** | Already enqueues; would enqueue a run request, never execute one |
| Approval review/decision | **api** | Already owns the approval routes and the hash-bound decision |
| Publication | **worker** | Already the only publication handoff |
| Migration authority | **api** `preDeployCommand` | Already the single migration runner |

Adding a service would create a second executor of long-running work and a second potential owner —
the exact class of problem worker ownership exists to prevent.

### 5.3 Proposed configuration — described, not created

**PROPOSED, NOT CREATED.** No variable below exists; none was added; `render.yaml` is unmodified.

| Proposed variable | Owner | Purpose | Default |
|---|---|---|---|
| `CONTENT_INTELLIGENCE_EXECUTION_ENABLED` | worker | Layer-5 runtime gate; must be exactly `true` to permit any stage | absent ⇒ disabled |
| `CONTENT_INTELLIGENCE_DISPATCH_ENABLED` | worker, scheduler | Layer-4 dispatch gate | absent ⇒ disabled |
| `CONTENT_INTELLIGENCE_SHADOW_ONLY` | worker | Forces shadow mode: stages run, nothing is promoted or approved | absent ⇒ shadow |

**PROPOSED** — every gate defaults to *off when absent*, so a service that never received the
variable is safe rather than enabled. **Deployment ordering:** database (007, separately) → api →
worker → scheduler, matching the merged controller's existing serialized order, with the dispatch
gate turned on **last** and only under its own authorization.

**UNKNOWN** — whether the deployment automation gate is currently on, whether native auto-deploy is
off, and what the services currently run. Each must be re-verified read-only immediately before any
production operation; none may be inferred from `render.yaml` or from this document.

---

## 6. Rollout sequence

**PROPOSED** — eight independently reviewed PRs. **Every executor stays disabled through PR-6.** No
PR combines migration application, deployment, enablement, and publication.

Each PR carries: entry criteria, exit criteria, tests, rollback, and prohibited actions.

### PR-1 — Enforce the enablement gate *(no caller yet)*

- **Entry:** this design accepted.
- **Change:** `invokeStage` refuses when the stage's `executionEnabled` is false, and when the
  runtime gate is not exactly `true`. Layer 5 becomes real.
- **Exit:** a regression proves a stage refuses with **zero** runner calls while disabled; another
  proves the runtime gate alone is insufficient without the registry field, and vice versa.
- **Tests:** offline suite + a mutation removing the gate that must fail its owning check.
- **Rollback:** revert; the pre-PR state is *more* permissive only in the sense that nothing calls it.
- **Prohibited:** adding any caller; changing any `executionEnabled` value; touching `render.yaml`.

### PR-2 — Durable run and stage-result schema *(migration 008, not applied)*

- **Change:** additive migration for `content_intelligence_runs` and
  `content_intelligence_stage_results`, plus its rollback file, plus TypeScript contracts.
- **Exit:** disposable PostgreSQL 16/18 apply/enforce/rollback/reapply coverage.
- **Prohibited:** applying **any** migration to production; wiring a caller.

### PR-3 — Dispatch skeleton, shadow-only, still gated

- **Change:** `runContentIntelligenceRun` exists and can be called only from tests; dispatch gate
  defaults off; shadow-only by construction.
- **Exit:** offline proof that with gates off, a dispatch attempt refuses before any stage.
- **Prohibited:** enabling any gate; any provider call; any promotion of output.

### PR-4 — Worker integration behind the dispatch gate

- **Exit:** with the gate off (the default), worker behavior is byte-identical to today, proven by
  the existing suites.
- **Prohibited:** turning the gate on anywhere; publication paths.

### PR-5 — Observability, audit records, metrics

- **Change:** structured run/stage audit records and metrics (§7). No behavior change.
- **Prohibited:** logging prompts, model prose, credentials, or evidence text.

### PR-6 — Migration 007 rollout *(operator-run, separately authorized)*

- **Entry:** §4 gates G1–G2 satisfied, decision record committed.
- **Change:** **no code.** This is an operator rollout plus its evidence record.
- **Exit:** G7 post-apply validation passes.
- **Prohibited:** combining with any code change, deployment of new behavior, or enablement.

### PR-7 — Shadow run in production *(no provider call, no approval, no publication)*

- **Entry:** PR-1…PR-6 complete; 007 applied and validated.
- **Change:** none to code. An operator turns the **dispatch** gate on with shadow-only in force.
- **Exit:** runs produce durable stage results and audit records; **zero** approvals created; **zero**
  provider requests; **zero** publications — each asserted from durable state, not from logs.
- **Rollback:** turn the dispatch gate off. No deploy.
- **Prohibited:** enabling execution beyond shadow; any approval; any publication.

### PR-8 — *(Not a PR.)* Human authorization point for enablement

**REQUIRES OPERATOR ACTION.** After shadow evidence is reviewed, a **named human** authorizes turning
layer 5 on for one stage at a time, each with its own authorization and immediate re-verification.
Approval (layer 6) and the publication guard (layer 7) remain mandatory and unchanged. **This
document does not grant that authorization and cannot.**

---

## 7. Testing and observability

**PROPOSED**, extending the existing contract rather than replacing it.

### 7.1 Offline and mutation

- Every new boundary gets offline coverage that **executes** the boundary rather than asserting on
  source text — the standard this repository already applies, and the reason a validator that was
  never called went unnoticed for five phases.
- Every load-bearing branch gets a mutation in `scripts/ci/payload-contract-mutation.mjs` (or its
  successor) whose owning check must fail. **A mutation that fails to compile proves nothing** and is
  not accepted as coverage.

### 7.2 Disposable PostgreSQL 16/18

Migration 008 (PR-2) gets the same apply / enforce / documented-rollback / compiled-reapply /
collision-refusal coverage that 007 has, on both versions.

### 7.3 Dry-run and unreachable-provider guarantees

- Simulated dry run must continue to make provider and publishing actions **impossible**, not skipped.
- The offline suite must continue to pass with a **nonempty** `ANTHROPIC_API_KEY` exported, and with
  `ANTHROPIC_BASE_URL` pointed at an unreachable port — so a real request would fail loudly rather
  than pass silently.

### 7.4 Structured run and stage audit records

**PROPOSED** — per run: run id, brief id, pack digest, code version, gate states at dispatch, outcome,
timing. Per stage: stage id, ordinal, validation outcome, `modelRequests`, token usage, duration,
terminal error class.

**PROPOSED — what is never recorded:** prompt text, model prose, evidence claim text, credentials,
approval tokens, provider payloads. An audit record answers *what happened*, never *what was said*.

### 7.5 Metrics and alerts

**PROPOSED** — counts and rates only: runs dispatched/completed/failed by terminal class, stage
duration percentiles, deadline-abort count, refusals by gate. **Alerts on**: any provider request
during shadow (should be zero), any approval created during shadow (should be zero), deadline aborts,
and refusal-rate change. No metric label may carry evidence text, a goal string, or a credential.

### 7.6 Acceptance criteria for production validation

**PROPOSED** — a stage is `PRODUCTION-VALIDATED` only when *all* hold, and each is evidence, not
inference:

1. It executed in production against a real model, observed in durable state.
2. Its output validated deterministically; refusals were correct refusals.
3. `modelRequests: 1` matched the observed provider request count.
4. No approval was created except through the mandatory human gate.
5. No publication occurred except behind a passing publication guard.
6. Recovery was exercised: an interrupted run terminalized correctly and resumed nothing.

Anything less is `DEPLOYED` or `ENABLED`, never `PRODUCTION-VALIDATED`.

---

## 8. Deferred: the Google Business Profile expansion

**Recorded as a future proposal only. Not begun, not designed here, and deliberately not imported.**

- **PROPOSED constraints for whenever it is taken up:** read-only and dry-run **first**; a **reviewed
  page list** as its input; **view/CSV output** initially, with no write path and no publication path;
  and its own separate review and authorization.
- **It must not begin during production-wiring work.** Combining an external-surface expansion with
  the work that first makes internal executors reachable would put two unproven changes behind one
  review.
- **No external proposal file is imported by this document**, and no GBP functionality exists in this
  change. `ACTIVE_PLATFORMS` is unchanged.

---

## 9. Unresolved questions

These are genuinely open. None should be closed by assumption:

1. **UNKNOWN** — current live Render service versions, health, and control settings. Requires
   read-only operator verification immediately before any production operation.
2. **UNKNOWN** — the true current contents of the production evidence tables. §4.1 exists precisely
   because this cannot be assumed from a dated observation.
3. **PROPOSED, undecided** — whether a shadow run should build its evidence pack from
   `config/approved-facts.json` via the adapter, or require `evidence:sync` to have populated
   `content_evidence` first. The second is more realistic; the first is available sooner. This
   changes what shadow evidence actually proves and should be decided explicitly, not defaulted.
4. **PROPOSED, undecided** — cost ceiling per run and per day, and what happens on breach. Six stages
   at the derived output budgets is materially more spend than the current path.
5. **UNKNOWN** — whether one brief per day remains the right cadence once six stages run per brief.
6. **PROPOSED, undecided** — retention for `content_intelligence_stage_results`. Stage outputs contain
   model prose; the repository has no complete retention program yet, which is already a recorded
   open risk.

---

## 10. What this document does not do

It does not implement production wiring, enable any executor, deploy anything, apply migration 007,
run production SQL, contact a provider or model, approve or publish content, change `render.yaml` or
any workflow, create any environment variable, mutate anything in Render, or begin the GBP expansion.
It changes no source, test, migration, configuration, agent, skill, or prompt file.

**It grants no authorization.** Every layer in §3 and every gate in §4 and §6 still requires its own
review, authorization, and evidence.
