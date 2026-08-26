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
- `src/worker/index.ts`: queue → deterministic orchestration → approval → native publishing.
- `src/scheduler/daily.ts`: daily brief enqueue only.
- `src/harness/orchestrator.ts`: current manager/control flow. It directly invokes current agent prompt bodies; the master-prompt manager is dormant.
- `src/mcp/`: imported provider libraries, not standalone MCP servers/model tools.
- `state/migrations/`: forward-only PostgreSQL authority; migration 005 is applied in production.
- `.github/workflows/ci.yml`: pull-request/`main` CI.
- `.github/workflows/deploy-production.yml` plus `scripts/render/deployment-controller.mjs`: disabled exact-SHA production controller.

Read [Architecture](ARCHITECTURE.md), [Data model](DATA_MODEL.md), or [Testing](TESTING.md) only when the task needs their detail.

## 4. Current production state

Read-only verification at **2026-08-24 21:32 UTC**:

- Repository `main`: `10098de73667797120da8c7dfa4da83f336ff6ba`.
- API `srv-d8u0qtpo3t8c73c5o44g`: live at that SHA; exact `/healthz` application/PostgreSQL/commit identity passed.
- Worker `srv-d8u0qtpo3t8c73c5o440`: live at that SHA; exact PostgreSQL readiness marker observed.
- Scheduler `crn-d8ulb4rtqb8s73bdjctg`: live artifact at that SHA.
- Workspace: `tea-d4fkclpr0fns73abmnh0`.
- PostgreSQL: `dpg-d8u0qaho3t8c73c5nj40-a`, PostgreSQL 18, available; external allowlist still `0.0.0.0/0`.
- No deployment in flight and no recent service error/critical logs observed.
- A normal scheduler run succeeded before the Phase 0D release; a normal run of the current SHA remains unobserved.

Mutable state can change. Reinspect GitHub/Render read-only when relevant; never infer it from this file or `render.yaml` alone.

## 5. Completed work

**Phase 0A, PR #33 / `30d06f95…`:** exact canonical approval/hash binding, hash-only approval tokens, expiry/revocation, append-only decisions, durable PostgreSQL authority, exact reviewer/provider parity, target and immutable-media revalidation before every provider request, bounded trusted media and fail-closed QC, protected controls, and durable startup. Migration 005 is applied.

**Phase 0D, PR #34 / `10098de736…`:** real Node 22 CI; PostgreSQL 16/18 integration; AgentShield/actionlint/YAML/static checks; exact successful same-repository main-push provenance; stale/diverged release rejection; exact live-to-target migration gate; serialized API health → worker readiness/stabilization → scheduler release; final SHA verification; and bounded, secret-aware, inert failure evidence. Phase 0D changed no Content Intelligence behavior.

## 6. Current operation in progress

The deployment-authority cutover is paused safely between authorities:

- Render native auto-deploy is off for all three services.
- GitHub `production` environment is configured with the expected secret name, five non-secret variables, and `main` restriction.
- Repository gate `RENDER_DEPLOY_AUTOMATION_ENABLED` is false.
- Therefore no unattended deployment authority is active.
- Phase 0D is implemented and configured, but not enabled or proven in production.

See [Deployment control](DEPLOYMENT.md) for exact mechanics and current evidence.

## 7. Next action

Take one action only, and only with explicit authorization:

1. Read-only reverify current `main`, all three live SHAs, native auto-deploy off, GitHub environment/configuration, gate false, and no deploy/migration in flight.
2. Set `RENDER_DEPLOY_AUTOMATION_ENABLED=true`.
3. Prove the controller against the already-current/no-deploy path if possible.
4. Then prove one harmless migration-free real release under separate reviewed scope.

Stop if any prerequisite differs. Never re-enable native Render auto-deploy while the GitHub gate is true. Do not combine this cutover with database networking or Phase 0B.

## 8. Roadmap

[Roadmap](ROADMAP.md) is authoritative. After cutover proof: provider idempotency/operation ledger and reconciliation, worker lease/reaper, PostgreSQL network restriction, token lifecycle, control/reviewer identity, retention and backup/restore, current-SHA scheduler observation, then the Phase 0B evidence contract and runtime.

## 9. Outstanding risks

Highest priority: no durable provider idempotency/reconciliation; worker-interruption recovery is implemented in PR but **not yet live in production**; PostgreSQL external access open to `0.0.0.0/0`; plaintext persisted Instagram token; bearer approval URL and generic reviewer identity; one shared control secret with process-local rate limits; no retention/restore drill; and unverified provider ownership/scopes/version/backup facts. Current skills are not injected, scorecard/proposal tables are unwritten, and no empirical learning runtime exists.

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
4. Read [Roadmap](ROADMAP.md).
5. Load only the specialized document needed.
6. Inspect current Git `main`/head.
7. Reinspect mutable production state read-only when relevant.
8. Treat source, migrations, self-tests, and checked-in configuration as higher authority than prose.
9. Preserve unrelated working-tree changes, including the existing `.DS_Store` modification.
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
