# GCD Content Intelligence roadmap

This roadmap orders work; it does not grant authority to deploy, migrate, call providers, change external configuration, or begin a phase. [Status](STATUS.md) records what is true now.

## Completed

### Phase 0A — Integrity Hardening

Merged in PR #33 as `30d06f95f32c46f9952bc63f0bc34a6040d40a09` and production-deployed. It established protected controls, exact canonical approval/hash binding, hash-only decision-token storage, expiry/revocation, append-only atomic decisions, durable PostgreSQL publication authority, reviewer/provider parity, live target and immutable-media revalidation before every provider request, bounded trusted-media handling, fail-closed QC, and durable startup prerequisites. Migration 005 applied these database guarantees and invalidated incompatible legacy approvals.

### Phase 0D — CI and Deployment Control Foundation

Merged in PR #34 as `10098de73667797120da8c7dfa4da83f336ff6ba` and production-deployed through the previous Render native auto-deploy path. It added comprehensive Node 22 CI; disposable PostgreSQL 16 and 18 integration; AgentShield and workflow validation; exact CI provenance; stale-release rejection; exact live/target ancestry and migration-range gates; serialized API, worker, and scheduler release control; release-bound health/readiness; bounded diagnostics; and fail-closed redaction/rendering.

## In cutover / current — Phase 0D.1

Verified 2026-08-24:

- Render native auto-deploy: off for API, worker, and scheduler.
- GitHub `production` environment: configured with the named secret, five non-secret variables, and `main` restriction.
- GitHub automation gate: `false`.
- Production: all three services live at `10098de73667797120da8c7dfa4da83f336ff6ba`; no deploy in flight.
- Deployment authority: deliberate zero-unattended-authority window.

The single next checkpoint is a separately authorized controller proof. Reconfirm the state above, then set `RENDER_DEPLOY_AUTOMATION_ENABLED` to exactly `true`; prove the already-current/no-deploy path if possible; then prove one harmless migration-free real release. Do not re-enable Render native auto-deploy while GitHub control is enabled. “Implemented,” “configured,” “enabled,” and “proven in production” remain distinct milestones.

## Next hardening

Keep these changes separable unless a reviewed design shows they must be atomic.

1. **Durable provider operation ledger and idempotency.** Model at least `not_attempted`, `attempted`, `provider_accepted`, `result_unknown`, `published`, `reconciled`, and `failed_safely`. Prevent timeout/crash/retry ambiguity from becoming duplicate posts.
2. **Provider reconciliation.** Reconcile internal intent/result records with provider-side post identities and safely resolve unknown outcomes before another attempt.
3. **Worker lease/reaper.** Add lease ownership, renewal, expiry, and stale-`running` recovery instead of permanently stranding briefs after a crash.
4. **PostgreSQL network restriction.** Remove the currently verified `0.0.0.0/0` external allowlist after confirming all required access paths.
5. **Provider-token lifecycle.** Encrypt or move the plaintext default Instagram token/session state, define rotation/expiry/recovery, and review log/outcome redaction.
6. **Control and approval identity.** Replace the shared `CONSOLE_TOKEN`, process-local direct-socket limits, generic reviewer label, and bearer token in browser/Slack URL history with scoped authenticated identities and a safer review/revocation flow.
7. **Retention, backup, and restore.** Set retention for briefs, approvals, events, sessions, scorecards, proposals, and media; design the reviewed forward migration needed for media deletion; verify backup policy and conduct an isolated restore drill with external-side-effect reconciliation.
8. **Current-SHA scheduler observation.** Observe the next normal scheduled run of `10098de…`; do not trigger production cron merely for evidence.
9. **External readiness register.** Verify provider account ownership, scopes, app review, versions, quotas, billing, test assets, recovery contacts, and the accuracy/freshness of approved business facts.

## Phase 0B prerequisite — fact and evidence contract

Define the contract before expanding reasoning or learning. Durable records must distinguish:

- verified automotive fact;
- sourced research;
- GCD direct observation;
- GCD empirical performance evidence;
- creative hypothesis;
- causal hypothesis or inference; and
- unsupported assumption.

Support source, source type, provenance, confidence, freshness, `observed_at`, `reviewed_at`, expiry/review-by, conflicting evidence, and supersession. Define review and conflict rules. Content-performance correlation must never silently become automotive fact or causal truth.

## Phase 0B — Content Intelligence runtime

After the operational prerequisites are accepted, return to the core mission with approximately six primary model reasoning stages:

1. strategy-concept;
2. automotive-truth;
3. hook-story-script;
4. production-direction;
5. packaging-adaptation; and
6. final-critic.

Implement an `AgentRegistry`, real skill/reference injection, research/reference retrieval, structured evidence capture, and deterministic input/output validation around those stages. Treat the roughly 22 originally researched specialist roles as conceptual capabilities: most should be deterministic services, references, policy modules, or optional specialists—not 22 mandatory model calls.

Keep human filming and external editing in the loop. Do not add an in-browser video editor unless a later phase explicitly requires it. Preserve human approval and governed change. Do not implement uncontrolled prompt, skill, agent, process, or publishing-rule rewriting.

## Later

- ingest platform performance with provenance and freshness;
- build content scorecards around reach, qualified followers, repeat viewing, affinity, retention, engagement, authority, and local relevance;
- track creative and causal hypotheses without confusing them with facts;
- learn from GCD empirical performance while retaining research priors;
- generate governed improvement proposals for human review;
- add paid amplification only after the organic engine and controls are reliable; and
- connect attribution, leads, and revenue after attention and audience quality are measurable.
