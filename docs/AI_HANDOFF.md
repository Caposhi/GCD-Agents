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
- `src/worker/index.ts`: exclusive ownership → recovery → queue → deterministic orchestration → approval → native publishing. Ownership, recovery, publication ordering, and exit behavior live in `src/harness/workerOwnership.ts`, `briefRecovery.ts`, `publicationRunner.ts`, `briefLifecycle.ts`, and `workerExit.ts`; startup ordering is in `src/worker/startup.ts`. Current source; not yet the production runtime.
- `src/scheduler/daily.ts`: daily brief enqueue only.
- `src/harness/orchestrator.ts`: current manager/control flow. It directly invokes current agent prompt bodies; the master-prompt manager is dormant.
- `src/mcp/`: imported provider libraries, not standalone MCP servers/model tools.
- `state/migrations/`: forward-only PostgreSQL authority; migration 005 is applied in production.
- `.github/workflows/ci.yml`: pull-request/`main` CI.
- `.github/workflows/deploy-production.yml` plus `scripts/render/deployment-controller.mjs`: disabled exact-SHA production controller.

Read [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), or [Testing](TESTING.md) only when the task needs their detail.

## 4. Current state — repository versus production

**These are intentionally different and must not be assumed equal.** [Status](STATUS.md) is authoritative for every exact SHA and for the freshness of each mutable fact; this section states only the semantics.

- **Repository `main` carries the worker ownership and recovery work** (PR #36). Verified by direct Git inspection on 2026-08-26.
- **Production does not.** The live release predates it, so the worker running today does not take the advisory lock and does not participate in the ownership protocol.
- The last full read-only production verification was **2026-08-24 21:32 UTC**. Render native auto-deploy was off on all three services, the GitHub `production` environment was configured, and the repository gate `RENDER_DEPLOY_AUTOMATION_ENABLED` was `false` — a deliberate zero-unattended-authority window. **None of those has been reverified since**; treat each as last-verified, not as current truth.
- A normal scheduled run of the current production SHA **was** observed on 2026-08-25; that item is closed. See [Status](STATUS.md) for the run evidence.
- PostgreSQL external access was open to `0.0.0.0/0` at last verification.

Mutable state can change. Reinspect GitHub and Render read-only immediately before any production operation; never infer it from this file, from `docs/STATUS.md` alone once stale, or from `render.yaml`.

## 5. Completed work

[Roadmap](ROADMAP.md) holds the full completed-phase records, including design decisions, rejected alternatives, validation, and accepted limitations. In brief:

**Phase 0A, PR #33** — exact canonical approval/hash binding, hash-only approval tokens, expiry/revocation, append-only decisions, durable PostgreSQL authority, exact reviewer/provider parity, target and immutable-media revalidation before every provider request, bounded trusted media and fail-closed QC, protected controls, and durable startup. Migration 005 is applied. `DEPLOYED` and `PRODUCTION-VALIDATED`.

**Phase 0D, PR #34** — real Node 22 CI; PostgreSQL 16/18 integration; AgentShield/actionlint/YAML/static checks; exact successful same-repository main-push provenance; stale/diverged release rejection; exact live-to-target migration gate; serialized API health → worker readiness/stabilization → scheduler release; final SHA verification; and bounded, secret-aware, inert failure evidence. It changed no Content Intelligence behavior. The application is `DEPLOYED`; the controller itself is `CONFIGURED` but not `ENABLED` and not proven.

**PR #35** — documentation reconciliation and the zero-context handoff set. `MERGED`; documentation-only.

**PR #36 — worker ownership and interrupted-brief recovery.** `MERGED` to `main`, **not `DEPLOYED`, not `PRODUCTION-VALIDATED`.** No migration. Exclusive ownership through a PostgreSQL session-level advisory lock; the `pending → running` claim executed on that ownership session; durable phase markers committed before each side effect; refuse-don't-resume terminalization of abandoned work; a startup orphan-approval sweep; ownership loss as a side-effect fence that ends the process; and readiness redefined to assert four things at once. This is current source and the next production release — not current production runtime.

## 6. Current operation in progress

The deployment-authority cutover, Phase 0D.1, is paused safely between authorities: no unattended deployment authority is active as of the last verification.

**PR #36 changed what the cutover must do next.** The ownership fix is merged but not deployed, and the live worker cannot be fenced by a lock it does not take. Enabling the GitHub gate first would grant automated deployment authority to a system whose worker still strands interrupted briefs silently. The ownership fix therefore gets its first production release through a **separately authorized manual Render bootstrap while the gate stays `false`**.

See [Deployment control](DEPLOYMENT.md) for exact mechanics and [Roadmap](ROADMAP.md) for the ordered cursor.

## 7. Next action

Take one action only, and only with explicit authorization. **Do not set the deployment gate.**

1. Read-only reverify current `main`, all three live SHAs, native auto-deploy off on all three services, the GitHub environment and configuration, the gate still `false`, and no deploy or migration in flight. Stop on any discrepancy.

Everything after that is a separately authorized step in its own right, in this order: reconcile the August 10 incident against provider account history; resolve the stale `running` row; perform the manual bootstrap release of the ownership fix with the gate still `false`; verify ownership acquisition, reconciliation, and readiness at that SHA; prove worker handoff with both versions holding the lock; and only then consider enabling `RENDER_DEPLOY_AUTOMATION_ENABLED` and proving the controller path.

Never re-enable native Render auto-deploy while the GitHub gate is true. Do not combine this cutover with database networking or Phase 0B.

## 8. Roadmap

[Roadmap](ROADMAP.md) is authoritative and binding — see the roadmap-continuity rule in [`AGENTS.md`](../AGENTS.md). After the bootstrap and cutover proof: provider idempotency/operation ledger, provider reconciliation, PostgreSQL network restriction, token lifecycle, control/reviewer identity, retention and backup/restore, the external readiness register, then the Phase 0B evidence contract and runtime. The worker lease/reaper item is superseded and is no longer active work.

## 9. Outstanding risks

Highest priority: no durable provider idempotency, operation ledger, or reconciliation — provider-level `withRetry` can still reissue a request after an ambiguous network outcome, so duplicate publication remains possible. Worker-interruption recovery is **merged but not deployed**, so the stranding failure mode is still live in production. PostgreSQL external access was open to `0.0.0.0/0` at last verification; the default-path Instagram token persists in plaintext; approval uses a bearer URL with a generic reviewer identity; one shared control secret carries process-local rate limits; there is no retention or restore drill; and provider ownership, scopes, versions, and backup facts remain unverified. Current skills are not injected, scorecard/proposal tables are unwritten, and no empirical learning runtime exists.

## 10. Content Intelligence target architecture

Use about six primary reasoning stages—strategy-concept, automotive-truth, hook-story-script, production-direction, packaging-adaptation, final-critic—surrounded by deterministic retrieval, evidence, policy, validation, state, and publication services. The roughly 22 researched roles are conceptual capabilities, not 22 mandatory calls. Phase 0B should add `AgentRegistry`, skill/reference injection, retrieval, evidence capture, and deterministic validation. This is target architecture, not current runtime.

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
