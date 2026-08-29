# GCD Content Intelligence — AI Engineering Handoff

## 1. Mission

Build German Car Depot's governed Content Intelligence Platform / Content OS: an organic-first automotive media engine for massive qualified reach, followers, repeat viewing, affinity, retention, engagement, GCD authority, and local dominance, then later attribution, leads, and revenue. Humans film; CapCut/external editing is the V1 editing path.

## 2. Non-negotiable principles

> Research gives us the prior. GCD empirical performance becomes the posterior.

- Agents reason; deterministic services retrieve, validate, mutate, store, enforce, and publish.
- Evidence collection may be automatic; prompt, skill, process, agent, and publishing-rule changes are governed.
- Automotive truth, safety, privacy, exact human approval, and immutable publication intent are hard rules.
- Never fabricate diagnosis, failure/repair evidence, customer facts, or shop evidence. Prefer real GCD evidence over generic decoration.
- Content performance is not proof of an automotive fact or causal claim.

## 3. Repository and runtime orientation

- Root `package.json` builds one Node 22 TypeScript project.
- `src/api/server.ts`: HTTP health, protected control/diagnostic/console routes, approval review/action, and media.
- `src/worker/index.ts`: exclusive ownership → recovery → queue → deterministic orchestration → approval → native publishing. Ownership, recovery, publication ordering, and exit behavior live in `src/harness/workerOwnership.ts`, `briefRecovery.ts`, `publicationRunner.ts`, `briefLifecycle.ts`, and `workerExit.ts`; startup ordering is in `src/worker/startup.ts`.
- `src/scheduler/daily.ts`: daily brief enqueue only.
- `src/harness/orchestrator.ts`: current manager/control flow. It directly invokes current agent prompt bodies; the master-prompt manager is dormant.
- **Phase 0B.0 — merged and deployed on all three services.** `src/harness/evidence/`: the evidence contract, pack builder, approved-facts adapter, and the `evidence:sync` operator command. `src/harness/agents/registry.ts`: the six-stage agent registry, asset resolution, and stage planning. `src/harness/contentIntelligence.ts`: the deterministic, inert preview.
- **Phase 0B.1 — merged, dormant, and NOT established as deployed or production-validated.** `src/harness/agents/stageExecution.ts`, `modelPolicy.ts`, `strategyConcept.ts`: the execution boundary and the first stage built on it. The code is on `main`; **nothing calls it**, and no deployment or production-validation claim is made for it.
- **Phase 0B.2 — `MERGED` through PR #44, deliberately dormant.** `src/harness/agents/automotiveTruth.ts` with `agents/automotive-truth.md` and `skills/claim-boundaries/SKILL.md`: the second stage on the same boundary. Nothing calls it, every registry entry remains `executionEnabled: false`, and it is **not established as deployed or production-validated**.
- **Phase 0B.3 — `IMPLEMENTED` in a draft pull request, NOT merged.** `src/harness/agents/hookStoryScript.ts` with `agents/hook-story-script.md` and `skills/script-craft/SKILL.md`: the third stage on the same boundary. It is **not on `main`**, nothing calls it, `executionEnabled` is unchanged, and no merge, deployment, enablement, or production-validation claim is made for it.
- `src/mcp/`: imported provider libraries, not standalone MCP servers/model tools.
- `state/migrations/`: forward-only PostgreSQL authority. **001–006 are applied in production**, 006 as of 2026-08-28. The release carrying it is fully deployed — see [Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md).
- `.github/workflows/ci.yml`: pull-request/`main` CI.
- `.github/workflows/deploy-production.yml` plus `scripts/render/deployment-controller.mjs`: disabled exact-SHA production controller.

Read [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), or [Testing](TESTING.md) only when the task needs their detail.

## 4. Current state — repository versus production

**These currently differ, and never assume either way.** Production was last independently verified at `44d7336…` on 2026-08-28; the source lineage now additionally carries the merged, dormant Phase 0B.1 and Phase 0B.2 executors, neither established as deployed. The Phase 0B.3 executor is on a draft pull-request branch only and is **not** part of `main`. [Status](STATUS.md) is authoritative for the freshness of mutable production facts; the exact current `main` is a Git lookup, not a documented field. This section states only the semantics.

- **PR #36 (worker ownership and recovery) and PR #38 (media publication normalization) are merged and deployed — their code is live in the current `44d7336…` release, independently verified 2026-08-28** by a separate final-inspection session with Render access. That inspection verified current service state; it **did not** re-examine the earlier bootstrap's behavioural evidence or any provider account history, so that part remains **operator-reported 2026-08-27, not independently verified**: an approximately 58-second wait for exclusive ownership before readiness, reconciliation of the August 10 stranded brief with `providerMutation = impossible`, and a controlled brief in which a 896x1120 provider render normalized to 1080x1350 and reached a real human approval with nothing published automatically.
- **Phase 0B.0 is merged (`44d7336…`) and DEPLOYED.** **Independently verified 2026-08-28** by a separate final-inspection session with Render and read-only PostgreSQL access: the API, worker, and scheduler all report the target; `_migrations` holds `006` exactly once; the evidence tables exist and are empty; the six reasoning stages do not execute. The exact application timestamp (`15:24:18Z`) and that the API pre-deploy runner performed it, that the worker's ownership acquisition and readiness occurred on two separate deploys, and the scheduler's non-trigger action are **operator-reported**, not independently re-derived. See [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md).
- **Deployment controls reverified 2026-08-28:** Render native auto-deploy off on all three services and `RENDER_DEPLOY_AUTOMATION_ENABLED` still `false` — the deliberate zero-unattended-authority window holds. The GitHub `production` environment and its five non-secret variables were last verified **2026-08-24 21:32 UTC** and were **not** revisited; treat that row as last-verified, not current.
- A normal scheduled run of the then-current production SHA **was** observed on 2026-08-25; that item is closed. See [Status](STATUS.md) for the run evidence.
- PostgreSQL external access remains `0.0.0.0/0` — independently reverified 2026-08-28 by a separate final-inspection session.

Mutable state can change. Reinspect GitHub and Render read-only immediately before any production operation; never infer it from this file, from `docs/STATUS.md` alone once stale, or from `render.yaml`.

## 5. Completed work

[Roadmap](ROADMAP.md) holds the full completed-phase records, including design decisions, rejected alternatives, validation, and accepted limitations. In brief:

**Phase 0A, PR #33** — exact canonical approval/hash binding, hash-only approval tokens, expiry/revocation, append-only decisions, durable PostgreSQL authority, exact reviewer/provider parity, target and immutable-media revalidation before every provider request, bounded trusted media and fail-closed QC, protected controls, and durable startup. Migration 005 is applied. `DEPLOYED` and `PRODUCTION-VALIDATED`.

**Phase 0D, PR #34** — real Node 22 CI; PostgreSQL 16/18 integration; AgentShield/actionlint/YAML/static checks; exact successful same-repository main-push provenance; stale/diverged release rejection; exact live-to-target migration gate; serialized API health → worker readiness/stabilization → scheduler release; final SHA verification; and bounded, secret-aware, inert failure evidence. It changed no Content Intelligence behavior. The application is `DEPLOYED`; the controller itself is `CONFIGURED` but not `ENABLED` and not proven.

**PR #35** — documentation reconciliation and the zero-context handoff set. `MERGED`; documentation-only.

**PR #36 — worker ownership and interrupted-brief recovery.** `MERGED` · `DEPLOYED` (independently verified 2026-08-28) · `PRODUCTION-VALIDATED` (operator-reported 2026-08-27, not independently re-examined). No migration. Exclusive ownership through a PostgreSQL session-level advisory lock; the `pending → running` claim executed on that ownership session; durable phase markers committed before each side effect; refuse-don't-resume terminalization of abandoned work; a startup orphan-approval sweep; ownership loss as a side-effect fence that ends the process; and readiness redefined to assert four things at once.

**PR #38 — media publication normalization.** `MERGED` · `DEPLOYED` (independently verified 2026-08-28) · `PRODUCTION-VALIDATED` (operator-reported 2026-08-27, not independently re-examined). No migration. Decode safety and publication profile separated into two distinct byte policies; provider-friendly source render sizes mapped to each publication profile at exactly its aspect ratio; and an off-ratio render — a square 1024x1024 — **refused rather than cropped or stretched**, typed as a deterministic non-retryable media-contract failure. Equality is exact integer cross-multiplication, not a floating-point tolerance.

**PR #37 and PR #39** — roadmap-continuity governance and its post-merge clarification. Documentation-only. PR #37 is `MERGED`; **PR #39 remains open, draft, and now conflicting with `main`** — see §6.

**Phase 0B.0 — content evidence and agent foundation (PR #40, merge `44d7336…`).** `MERGED`, **`DEPLOYED`** — API, worker, and scheduler all at the target. Migration 006, the typed evidence contract with its eight epistemic kinds, the evidence pack that surfaces conflicts instead of resolving them, the deterministic approved-facts projection, the explicit `evidence:sync` operator command, the six-stage agent registry with allowlist-rooted asset loading, and an inert Content Intelligence preview route. **No stage executes and no model call was added.**

## 6. Current operation in progress

**The first migration-bearing production rollout — complete.** Phase 0B.0 merged as `44d7336…` on 2026-08-27 and was rolled out on 2026-08-28: API deployed first, migration 006 applied once at `15:24:18.56508Z` in ~53 ms. The rollout **stopped once, mid-flight, at step 6** under S8/S18 because the runbook claimed 9 indexes where the catalog reports 10 — the schema was correct, the document was wrong, and the stop is the safety mechanism working. Once §2 was corrected and independently inspected, the rollout resumed under fresh authorization: the worker deployed and acquired exclusive ownership twice (58,142 ms, then 60,094 ms on an authorized same-SHA handoff proof), both times finding no interrupted briefs; the scheduler deployed with its cron unchanged and un-triggered; a single authenticated preview call returned the six-stage plan with execution disabled and left every database row count unchanged. **API, worker, and scheduler now all report `44d7336…`**; migration 006 must not be rerun. Completion carried one documented, authorization-governed variance at step 13: the authorization granted exactly one production preview and exactly one was made, with deterministic equality established by the existing automated fixed-input test rather than a second production call — **no second production preview occurred**. See [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md). The current-state claims were **independently reverified 2026-08-28** by a separate final-inspection session with Render and read-only PostgreSQL access; the authoring engineering session verified none of them itself, and provider account history was not examined by either.

Note that `44d7336…` also carries `4891bf3`, a security fix draining an unread body on `/console/*` auth failure. That gate is shared with `/console/state` and `/console/stream`, so this rollout closed an exposure that existed in production until now.

Two independent tracks remain open, and **neither blocks the other**:

- **Deployment authority (Phase 0D.1).** The manual ownership bootstrap is complete (operator-reported). Enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` and proving the controller path are eligible, each under its own authorization and its own immediate re-verification. The Phase 0B.0 release did not use this path — it went through the manual migration-bearing rollout by design, and that rollout is now finished.
- **Phase 0B.** The remaining Content Intelligence build — wiring the six registered stages one slice at a time.

**PR #39 is open, draft, and conflicting.** It predates PR #40 and its `README.md`, `docs/ROADMAP.md`, and `docs/STATUS.md` edits were overtaken; its `AGENTS.md` and `CONTRIBUTING.md` governance clarification is **not** on `main` and remains unshipped. Do not merge, rewrite, close, or repurpose it without separate authorization.

See [Deployment control](DEPLOYMENT.md) for exact mechanics and [Roadmap](ROADMAP.md) for the ordered cursor.

## 7. Next action

Take one action only, and only with explicit authorization.

The migration-bearing rollout in [ROLLOUT_PHASE_0B0.md](ROLLOUT_PHASE_0B0.md) is **complete** against exactly `44d7336f2c75ff880cff0d8205d2fafe13eb91b5` — API, worker, and scheduler all report the target, and there is no remaining rollout step. It completed with one documented, authorization-governed variance at step 13: exactly one production preview was executed, as authorized, and deterministic equality came from the existing automated fixed-input test rather than a second production call. Available next actions, each separately authorized and none implied by the others:

1. **Independent review of the Phase 0B.3 `hook-story-script` executor**, which is implemented in a **draft** pull request and is not merged. Reviewing it is not merging it, and merging is a separate authorization. After it merges, the product cursor is **Phase 0B.4 — the dormant `production-direction` stage executor**, named only and not designed or implemented here.
2. On the **deployment authority** track: reverify the gate and configuration, then consider enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` and proving the controller path. This is an **independent track** and must not be combined with the Phase 0B work.
3. A first production `evidence:sync` is its own operation, has **not** run, and is not implied by the rollout's completion.

**Freshness of the production claims above.** They were **independently reverified on 2026-08-28** by a separate final-inspection session with Render and read-only PostgreSQL access — service SHAs, native auto-deploy off, `/healthz` identity, `_migrations` = `001–006`, migration-006 inventory, queue and row counts, and error absence. The authoring engineering session has no Render access (`/healthz` and `api.render.com` egress denied) and verified none of it directly. **Not covered by that inspection:** authenticated provider account history and the earlier PR #38 controlled brief, both of which remain operator-reported from 2026-08-27.

Never re-enable native Render auto-deploy while the GitHub gate is true. Do not combine the authority cutover with database networking or with a future Phase 0B migration release.

### Phase 0B.1 — merged and dormant

The `strategy-concept` stage executor is **`MERGED`** through PR #42, merge commit `8c8bd5b0fd500f9a28247f472fd6626bb05c6ebd` (reviewed head `2dc416f1a49bb419531549e95cb31052ada28009`, base `aec3e805cecc2b99dc7a582292bef536cee8ae21`).

It is **not established as deployed and not production-validated**, and it is dormant on purpose: no worker, scheduler, orchestrator, approval path, or HTTP route reaches it, and the preview stays inert. It added no route, migration, environment variable, publishing path, approval path, or provider authority. All six registry entries still have `executionEnabled: false`.

### Phase 0B.2 — merged and dormant

The `automotive-truth` stage executor is **`MERGED`** through PR #44 at merge `52050b4d20d03b5cbaf2a98eaab71b2f77685d80`. It is **not established as deployed and not production-validated**. It is dormant on the same terms as 0B.1: the worker, scheduler, orchestrator, API, preview, approval, publication, provider, image, Slack, database, and evidence-write paths cannot reach it; every stage remains `executionEnabled: false`; and it added no route, migration, environment variable, dependency, workflow change, publishing path, approval path, or provider authority.

What it guarantees is narrow and should be quoted rather than paraphrased: **no sentence the model writes becomes a claim the pipeline may make.** Stage 2 receives the complete typed Stage 1 output as bounded untrusted data and builds only a structural whitelist of evidence-record ids. The classified projection supplies authoritative `kind`; the recorded class overrides the model's declaration; and what may be claimed is read back from the records, never from either stage's prose. What it does **not** do is semantically prove that model prose is true or that a restatement faithfully renders its fact. **A language model is not a semantic prover of factual truth here.** See [Roadmap](ROADMAP.md) for the full statement, including why the publishing-era compliance checklist was removed from this stage.

Five distinctions these slices deliberately preserve, and which the next session must not collapse:

1. an executor **implemented in source** — true for `strategy-concept` and `automotive-truth`;
2. **merged to `main`** — true for both executors;
3. a stage **enabled in a production path** — true for none;
4. **deployed** code — not claimed for either executor;
5. **production-validated** behaviour — not claimed for either executor.

### Phase 0B.3 — implemented, dormant, and not merged

The `hook-story-script` stage executor is **`IMPLEMENTED`** and sits in a **draft** pull request. It is **not `MERGED`**, and therefore not on `main`, not deployed, not enabled, and not production-validated. It is dormant on the same terms as 0B.1 and 0B.2: nothing reaches it — worker, scheduler, orchestrator, API, preview, approval, publication, image, Slack, database, and evidence-write paths are all asserted unable to — and `executionEnabled` was not changed for any stage.

Quote its guarantee rather than paraphrasing it: **stage 2's whitelist is the boundary, not the pack.** A real, citable fact that `automotive-truth` did not permit is absent from the projection stage 3 sees and fails validation if cited. The complete pack is never offered as an alternate claim source. The invocation takes the complete typed outputs of both prior stages — not free-form strings — and revalidates them against the same evidence pack rather than trusting their branding.

What it does **not** do: verify that the script's prose faithfully restates the fact it cites, or detect every uncited factual implication. **No language model in this pipeline proves a statement true.** See [Roadmap](ROADMAP.md) for the full statement, the zero-permitted-claims decision, and why both registered placeholder assets were rejected.

## 8. Roadmap

[Roadmap](ROADMAP.md) is authoritative and binding — see the roadmap-continuity rule in [`AGENTS.md`](../AGENTS.md). The Phase 0B evidence contract is now implemented (Phase 0B.0) rather than pending. Remaining: the six reasoning stages on the registry; provider idempotency/operation ledger; provider reconciliation; PostgreSQL network restriction; token lifecycle; control/reviewer identity; retention and backup/restore; the external readiness register; and the deployment-authority cutover proof. The worker lease/reaper item is superseded and is no longer active work.

## 9. Outstanding risks

Highest priority: no durable provider idempotency, operation ledger, or reconciliation — provider-level `withRetry` can still reissue a request after an ambiguous network outcome, so duplicate publication remains possible. Worker-interruption recovery is deployed — its code is live in the current `44d7336…` release, independently verified 2026-08-28 — so that specific stranding mode should be closed; the earlier bootstrap's behavioural evidence (the ownership-wait timing, the August 10 reconciliation) remains operator-reported 2026-08-27 and was not independently re-examined, and should be reconfirmed before being relied on. PostgreSQL external access remains `0.0.0.0/0`, independently reverified 2026-08-28; the default-path Instagram token persists in plaintext; approval uses a bearer URL with a generic reviewer identity; one shared control secret carries process-local rate limits; there is no retention or restore drill; and provider ownership, scopes, versions, and backup facts remain unverified. Skills are not injected into any **production** model call — the Phase 0B.1 executor injects prompt and skill assets, but it is dormant and unreachable. Scorecard/proposal tables are unwritten and no empirical learning runtime exists. Phase 0B.0 adds the evidence substrate but does not populate it: migration 006 is applied, `content_evidence` is empty until an authorized operator runs `evidence:sync` (not yet run), and **no reasoning stage executes in production**. The rollout is complete; production is no longer at a mixed version.

## 10. Content Intelligence target architecture

Use about six primary reasoning stages—strategy-concept, automotive-truth, hook-story-script, production-direction, packaging-adaptation, final-critic—surrounded by deterministic retrieval, evidence, policy, validation, state, and publication services. The roughly 22 researched roles are conceptual capabilities, not 22 mandatory calls. Phase 0B.0 added the `AgentRegistry`, its checked-in asset resolution for all six stages, the durable evidence contract, and a deterministic inert preview. **Phase 0B.1 adds the first stage executor** — a reusable boundary plus `strategy-concept` — which injects prompt and skill assets into its instruction channel and deliberately keeps reference assets out of it. **Phase 0B.2 adds the second, merged `automotive-truth` executor on the same boundary. Phase 0B.3 adds the third, `hook-story-script`, implemented in a draft pull request and not merged.** Retrieval and evidence capture from real runs remain unbuilt, and the other three stages are declared but have no executor. **No stage executes in any production path**, so this is still target architecture, not current runtime.

## 11. Critical historical lessons

Phase 0A's native concurrent rollout started the worker before the API's migration 005 completed. The worker failed twice because `approval_decisions` did not exist, then recovered after migration. Schema-dependent consumers must not race their migration authority.

**A durable status without durable phase detail is not recoverable state.** `brief_queue.status='running'` recorded that work had started but nothing about how far it got, so an interrupted brief could not be classified — only guessed at — and was stranded silently. The fix was not a timer but durable phase markers committed before each side effect, plus an ownership predicate that says when acting on them is safe.

**Process start is not exclusivity.** Render zero-downtime worker deploys keep the old instance alive for roughly a minute after the new one starts, so “I just booted” never implies “the running brief is abandoned”. Exclusive ownership must be established, not assumed; a session-level advisory lock provides it and releases automatically on session death, which no lease table can match.

“Live process” is not readiness. Readiness means durable state initialized → exclusive worker ownership acquired → abandoned work reconciled → mandatory initialization completed → runtime identity validated → readiness emitted → queue consumption. Health must prove application and exact release identity at a deterministic destination, with transport-time body bounds. Diagnostics need structured and realistic fallback secret detection, decoded attacker content must never be emitted, and runtime-controlled GitHub summary values must be inert.

Reusable release practice:

> IMPLEMENT → REAL CI → INDEPENDENT ADVERSARIAL REVIEW → SURGICAL REMEDIATION → EXACT-HEAD CI → FOCUSED RE-REVIEW → HUMAN MERGE CHECKPOINT → PRODUCTION VERIFICATION → SEPARATE AUTHORITY CUTOVER

## 12. Authority boundaries

Read repository/Git/GitHub and explicitly available read-only infrastructure state as needed. Do not change GitHub or Render configuration, deploy/restart, run production SQL or migration, trigger scheduler/worker, call models/images/live diagnostics/providers, decide an approval, publish, rotate credentials, merge, or begin a phase without explicit user authorization. A tool being available is not authorization. Follow root [`AGENTS.md`](../AGENTS.md).

## 13. Start-of-session checklist

1. Read root `AGENTS.md`.
2. Read this handoff.
3. Read [Status](STATUS.md).
4. Read [Roadmap](ROADMAP.md) — it holds the current cursor, and updating it is binding under `AGENTS.md`.
5. Load only the specialized document needed.
6. Inspect current Git `main`/head.
7. Reinspect mutable production state read-only when relevant, and never assume repository `main` and the live release are the same commit.
8. Treat source, migrations, self-tests, and checked-in configuration as higher authority than prose.
9. Preserve unrelated working-tree changes, including any existing `.DS_Store` modification.
10. Do not perform external or production writes without authorization.

## 14. Key files

- [`AGENTS.md`](../AGENTS.md)
- [Status](STATUS.md)
- [Roadmap](ROADMAP.md)
- [Architecture](ARCHITECTURE.md)
- [Deployment control](DEPLOYMENT.md)
- [Operations](OPERATIONS.md)
- [Security and continuity](SECURITY_AND_CONTINUITY.md)
- [Testing](TESTING.md)
- [Data model](DATA_MODEL.md)
- [Environment](ENVIRONMENT.md)
- [Integrations](INTEGRATIONS.md)
- [Credential setup](credentials-setup.md)
- [`render.yaml`](../render.yaml)
- [CI workflow](../.github/workflows/ci.yml)
- [Production workflow](../.github/workflows/deploy-production.yml)
- [Migration 005](../state/migrations/005_approval_integrity.sql)
- [Migration 006](../state/migrations/006_content_evidence.sql)
- [Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md)
