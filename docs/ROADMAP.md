# GCD Content Intelligence roadmap

Last reviewed: 2026-08-27.

This roadmap is the canonical unfinished-work sequence and the current-phase cursor. It orders work; it does not grant authority to deploy, migrate, call providers, change external configuration, or begin a phase. [Status](STATUS.md) records what is verified true now. Where this file and verified production evidence disagree, resolve the discrepancy rather than following this text. Roadmap continuity is binding — see [`AGENTS.md`](../AGENTS.md).

## State vocabulary

| State | Meaning |
|---|---|
| `PLANNED` | In scope and ordered, but not built |
| `IMPLEMENTED` | Code exists and local validation passes |
| `MERGED` | Merged to `main` at a known SHA; says nothing about production |
| `CONFIGURED` | External identifiers/settings exist |
| `ENABLED` | The gate controlling it is actually on |
| `DEPLOYED` | A release carrying it is live in production |
| `PRODUCTION-VALIDATED` | Its behavior has been observed in production |
| `BLOCKED` | A named dependency or decision prevents safe progress |
| `DEFERRED` | Intentionally not scheduled; reason and re-entry condition recorded |
| `SUPERSEDED` | Replaced by a different accepted design; kept for its rationale |

These are not interchangeable and must not be collapsed into "done". `MERGED` in particular is not `DEPLOYED`.

## Completed / durable history

### Phase 0A — Integrity Hardening

**State:** `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED`.

**PR / merge:** PR #33, merge `30d06f95f32c46f9952bc63f0bc34a6040d40a09`.

**Delivered:** protected controls; exact canonical approval/hash binding; hash-only decision-token storage; expiry and revocation; append-only atomic decisions; durable PostgreSQL publication authority; reviewer/provider parity; live target and immutable-media revalidation before every provider request; bounded trusted-media handling; fail-closed QC; and durable startup prerequisites.

**Schema:** migration 005 applied these database guarantees and invalidated incompatible legacy approvals.

**Accepted limitations:** no provider-side exactly-once guarantee; the approval bearer URL and generic reviewer identity remain; `session_state` still persists a default-path Instagram token in plaintext.

**Follow-ups still open:** provider operation ledger and reconciliation; control/reviewer identity; token lifecycle.

### Phase 0D — CI and Deployment Control Foundation

**State:** `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED` as an application release. The GitHub controller itself is `CONFIGURED` but **not** `ENABLED` and **not** `PRODUCTION-VALIDATED` as the deployment authority.

**PR / merge:** PR #34, merge `10098de73667797120da8c7dfa4da83f336ff6ba`. Deployed through the previous Render native auto-deploy path, not through the controller it introduced.

**Delivered:** comprehensive Node 22 CI; disposable PostgreSQL 16 and 18 integration; AgentShield and workflow validation; exact CI provenance; stale-release rejection; exact live/target ancestry and migration-range gates; serialized API, worker, and scheduler release control; release-bound health and readiness; bounded diagnostics; and fail-closed redaction/rendering.

**Schema:** none.

**Design decision:** deployment authority is exact-SHA and serialized, and a migration-bearing range stops the release rather than running a migration automatically. Exactly one migration runner remains the invariant.

**Rejected alternative:** allowing the controller to execute migrations. The Phase 0A rollout had already proven that a schema-dependent consumer racing its migration authority fails; giving the controller that authority would have created a second migration runner.

**Production evidence:** all three services observed live at the merge SHA on 2026-08-24; exact `/healthz` identity and the exact target-bound worker readiness marker passed. A normal scheduled run of this SHA was subsequently observed on 2026-08-25, closing the previously open current-SHA scheduler observation; the run evidence is recorded in [Status](STATUS.md).

**Accepted limitation:** the controller has never performed a release. Being deployed is not being proven.

### PR #35 — documentation reconciliation and zero-context handoff modernization

**State:** `MERGED`. Documentation-only; no runtime, schema, workflow, or deployment effect.

**PR / merge:** PR #35, merge `a797f4cbd85c477c1b558168b0a07018120adf64`.

**Delivered:** created `docs/AI_HANDOFF.md`, `docs/ROADMAP.md`, and `docs/START_HERE.md`; rewrote the root README as a zero-context handoff; reconciled the runbook set against source.

**Schema:** none. **Production evidence:** not applicable — nothing was deployed.

**Accepted limitation, recorded honestly:** this change introduced a roadmap without introducing a rule binding anyone to update it, and it recorded the repository `main` SHA in prose that its own merge immediately invalidated. Both defects are corrected by the documentation-governance change that adds this record.

### PR #36 — worker ownership and interrupted-brief recovery

**State:** `MERGED` · `DEPLOYED` · `PRODUCTION-VALIDATED`.

**Production evidence — operator-reported 2026-08-27.** The manual bootstrap was performed by the operator, not by this engineering session, which has no Render or production database access; the following is recorded as reported and was not independently verified here. The new worker waited approximately 58 seconds for exclusive ownership before emitting readiness — the zero-downtime overlap behaving exactly as designed. The August 10 stranded brief was reconciled by startup recovery with `providerMutation = impossible` and no provider replay. Authenticated Instagram, Facebook, and Google Business Profile history had been checked beforehand and the target post was not found on any destination, so the reconciliation rested on account evidence rather than database absence.

**PR / merge:** PR #36, reviewed head `281eb8f232995e58e404c916c3ec0a23b62c7acc`, merge `0828cc91c41c9cd10ad709db30491ada0a52c811`.

**Delivered:** exclusive worker ownership through a PostgreSQL session-level advisory lock held on a dedicated client for the process lifetime; the `pending → running` claim executed on that ownership session; durable phase markers committed before each side effect as safety state rather than best-effort telemetry; refuse-don't-resume terminalization of work abandoned by a previous owner; a startup orphan-approval sweep; ownership loss as a side-effect fence that ends the process nonzero; a widened and truncation-aware worker readiness window in the deployment controller; and readiness redefined to assert durable state initialized, exclusive ownership held, abandoned work reconciled, and required initialization complete.

**Schema / migrations:** **none.** The advisory key is runtime state, `failed` was already permitted by the 002 constraint, the `events` table already stored the markers, and approval revocation columns already existed from migration 005. The change therefore ships through the controller's ordinary path instead of tripping its own migration gate.

**Material design decisions:** ownership is established, never assumed, because Render zero-downtime worker deploys keep the old instance alive for roughly a minute after the new one starts. Recovery runs only after ownership is held, because recovery is destructive. Markers commit before the side effect they describe, so an interrupted brief is classified exactly rather than guessed at. A former owner declines every terminal write so it cannot overwrite a successor's recovery.

**Material rejected alternative — a time-based worker lease or reaper.** Rejected on correctness for the current single-instance topology, not on effort. A brief legitimately remains `running` while waiting up to 24 hours for a human approval decision, so no TTL can distinguish a crashed worker from a waiting one. A lease row also survives its holder, whereas a session-level advisory lock is released by PostgreSQL the instant the owning session ends, making clean exit, SIGKILL, OOM, and host loss identical and requiring no expiry at all.

**Re-entry condition for that decision:** reconsider the lease/fencing architecture if worker scale or topology changes — more than one concurrent worker, a partitioned queue, or any deployment model in which two owners are intended to run at once.

**Automated validation (on the reviewed head, before merge):** Node 22 typecheck and build; the offline suite including `test:ownership` at 112 checks; deployment-controller fixtures including new truncation and pagination cases; disposable local PostgreSQL 16 integration at 114 checks, including two real sessions contending for the real advisory lock, automatic release on session death, and a `pg_terminate_backend` of the owning session proving a claim cannot commit afterwards; the bound HTTP end-to-end suite at 54 checks; simulated dry run; Markdown links; environment coverage; credential/PII scan; `npm audit --omit=dev` clean; AgentShield 1.4.0 clean. Exact-head GitHub CI was green across all five jobs before merge.

**Production evidence:** **none, by design.** Nothing was deployed.

**Rollback / recovery status:** no migration, so there is no forward-only schema commitment to unwind. Rollback is an ordinary application-release decision. Recovery itself is refuse-don't-resume: it never returns a brief to `pending`, never retries, and issues no provider request.

**Security and privacy implications:** an interrupted brief's approval is now revoked rather than left live, and a startup sweep revokes pending approvals with no owning brief marker — closing an approval-integrity gap in which a human could approve a post that nothing was waiting to publish. Ownership is mutual exclusion, not a fencing token: the Phase 0A publication guard remains the actual fence. Marker error text is bounded to 300 characters so provider response bodies do not accumulate in durable state.

**Accepted limitations:** interruption during a provider attempt still yields an outcome the system cannot resolve alone — it is surfaced and nothing retries automatically, but a human must reconcile against the platform. The Render log-truncation fallback remains a heuristic wherever the CLI exposes no `hasMore` or cursor; it is conservative and can fail a healthy release, but cannot pass an unproven one.

**Unresolved follow-ups:** the durable provider operation ledger and idempotency work below; the manual bootstrap release; reconciliation of the August 10 stranded row under separate production authorization.

**Documents updated at completion:** in the implementing PR — `README.md`, `docs/AI_HANDOFF.md`, `docs/DATA_MODEL.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`, `docs/ROADMAP.md`, `docs/SECURITY_AND_CONTINUITY.md`, `docs/STATUS.md`, `docs/TESTING.md`. In the follow-up governance change that added this record — all of the above plus `AGENTS.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/ENVIRONMENT.md`, and `docs/credentials-setup.md`.

`docs/ARCHITECTURE.md` should have been in the first list and was not: PR #36 changed worker readiness semantics, the claim path, and runtime ownership while leaving the document that describes them untouched, which left it contradicting three other runbooks. That miss is what the roadmap-continuity and reread rules now exist to prevent.

### Phase 0B.0 — content evidence and agent registry foundation

**State:** `IMPLEMENTED` — not `MERGED`, not `DEPLOYED`.

**Delivered:** the typed evidence contract with eight kinds and per-kind validation; `state/migrations/006_content_evidence.sql` with `content_evidence` and `content_evidence_relations`; a deterministic, provenance-preserving adapter from `config/approved-facts.json`; an idempotent operator-only sync command; the evidence pack builder that surfaces conflicts and stale evidence without resolving them; `AgentRegistry` with all six target stages registered and allowlist-rooted asset loading; `ContentIntelligenceContext`; and a deterministic, inert preview endpoint.

**Schema / migrations:** migration **006**, written and integration-tested against disposable PostgreSQL 16 and 18. **Not applied to production.** Its rollout is a separately authorized migration-bearing release under the existing discipline: exactly one migration authority, and no schema-dependent consumer racing it.

**Material design decisions:** epistemic class is a database constraint, not a convention; conflicts are reported and never auto-resolved; the approved-facts adapter is a projection rather than a second source of truth, so the JSON stays authoritative until a later reviewed cutover; and registration is deliberately separated from execution.

**Material rejected alternative — resolving conflicts by confidence or recency.** Rejected because it is precisely how a content engine starts asserting things nobody verified. A human resolves a conflict by authoring an explicit supersession, which stays auditable.

**Automated validation:** 362 offline assertions across eight suites; PostgreSQL 16 and 18 integration at 154 checks each, including database-level rejection of malformed evidence and proof that repeating the sync changes nothing; bound HTTP end-to-end at 64 assertions, including that the preview creates no approval and enqueues no brief.

**Production evidence:** none, by design. Nothing was deployed.

**Accepted limitations:** the six stages are registered but not executed; the live publishing pipeline still cites `config/approved-facts.json` directly and is unchanged by this work; and no performance evidence exists yet, so the empirical half of "research is the prior, performance is the posterior" is still unpopulated.

## Resolved production incident — media publication normalization

**State:** `MERGED` in PR #38 · `DEPLOYED` · `PRODUCTION-VALIDATED`. **The incident is closed.**

**Production evidence — operator-reported 2026-08-27**, recorded as reported and not independently verified in this session: a controlled brief ran the full content path, the provider returned a PNG at 896x1120, normalization scaled it uniformly to a 1080x1350 JPEG, image QC passed, and the brief reached a real human approval. Nothing was published automatically. That is the exact failure path from 2026-08-25 executing correctly end to end.

**Symptom.** From 2026-08-25, scheduled briefs stopped reaching human approval. Slack reported `Content generation failed before an approval was created` and `image dimensions 1024x1024 are not an approved cross-platform feed profile`. The Land Rover brief and BMW brief `19811e5f-8899-4134-9634-3dd9a9a90827` both escalated. Because the image agent routes essentially every branded post to `text-graphic`, this blocked normal scheduled posting outright.

**Root cause.** The exact publication-profile allowlist was asserted against the **raw provider download**, not against the artifact this application produces. Image providers guarantee composition, not exact publication pixels, and no resize existed anywhere in `src/`, so any provider-native size was fatal. The request shape dated from 2026-06-24; the allowlist arrived on 2026-08-24 with Phase 0A, and the next scheduled briefs failed. Phase 0A behaved correctly — it exposed a latent mismatch rather than causing one.

**Provider evidence (one authorized live diagnostic, 2026-08-27).** A single `fal-ai/ideogram/v3` call requesting `image_size: {width: 1024, height: 1280}` returned HTTP 200 with `images[0]` carrying only `url`, `content_type`, `file_name`, `file_size` — **no width or height** — with `content_type: image/png` despite `output_format: "jpeg"`, and downloaded bytes of **896x1120**, exactly 4:5. Requested pixels were not honored; the requested **aspect** was. Production had requested 1080x1350 and received 1024x1024 (1:1), so the requested value decides whether the composition survives at all.

**Fix.** Separate decode safety from publication policy; request a provider-friendly source size per profile; normalize by **pure uniform scale only** to the exact reviewed profile before QC, hashing, hosting, and approval. Cropping and padding are refused, not unimplemented — cropping 1:1 into 4:5 would cut 20% of the frame through the headline.

**Explicitly not done:** no provider size was added to the allowlist, and the durable publication guard is unchanged in strength.

**Accepted limitation:** only the 4:5 source mapping is proven against the live provider. The other three are exact by arithmetic and fail closed if the provider composes something else.

## Current cursor — Phase 0D.1

Phase 0D.1 is the deployment-authority cutover. It is **paused, deliberately, between authorities**, and PR #36 changed what the next safe step is.

The ownership bootstrap is **complete** (operator-reported 2026-08-27): the protected worker is live and its handoff behaviour was proven under real zero-downtime overlap. That unblocks the remaining cutover steps, which were always gated behind it.

**This is an operational follow-up and is not a blocker to Phase 0B product work.** Phase 0B.0 shipped without touching deployment authority, and later Phase 0B slices can do the same. The remaining proof is worth doing on its own schedule, not ahead of the product.

Each step below requires its own explicit authorization. None of them is authorized by this document.

1. **PR #36 merged with exact-head CI green — COMPLETE.**
2. **Read-only production reverification — COMPLETE** (operator, 2026-08-27). Confirm current `main`, all three live SHAs, all three Render native auto-deploy settings off, the GitHub gate `false`, the GitHub `production` environment configuration, and no deployment or migration in flight. Stop on any discrepancy.
3. **Reconcile the August 10 incident against provider account history — COMPLETE.** Checked on Instagram, Facebook, and GBP; the target post was not found on any destination. Check Instagram, Facebook, and Google Business Profile directly for the 2026-08-11 Mini Cooper check-engine content before any production row is mutated. Public search was inconclusive and is not sufficient evidence.
4. **Stale `running` row resolved — COMPLETE**, by startup recovery with `providerMutation = impossible`. Original wording: (`c5e53afe-2657-4e11-811d-53ce5e793245`), so the reconciler's first firing is not performing an unexplained production mutation as a side effect of a deployment.
5. **Manual bootstrap release — COMPLETE.** Original wording:, with native auto-deploy still off and `RENDER_DEPLOY_AUTOMATION_ENABLED` still `false`. Preflight requires zero `running` briefs and **zero pending approvals** — approvals created before this change carry no `brief:approval_requested` marker, so the startup orphan sweep would revoke them on first boot. Draining them first makes that sweep a no-op rather than a surprise.
6. **Bootstrap verified at its exact SHA — COMPLETE.** Original wording: API deployed and exact health identity confirmed; worker ownership acquisition, reconciliation, and readiness observed; scheduler artifact confirmed; all three services reporting the bootstrap SHA.
7. **Worker handoff and contention proof — COMPLETE**, new instance waited ~58s for ownership before readiness. Original wording: performed once both the old and new worker versions contain ownership code: observe the new instance waiting, the old instance shutting down, ownership transferring only afterwards, and readiness appearing only after that.
8. **Now eligible, not yet done:** enabling `RENDER_DEPLOY_AUTOMATION_ENABLED`. Requires its own authorization and immediate re-verification.
9. **Then prove the GitHub controller path** — the already-current/no-deploy route first if possible, then one harmless migration-free real release. Note that migration 006 makes the next Phase 0B release migration-bearing, so it must go through the separately authorized migration rollout rather than the ordinary controller path.

Never re-enable Render native auto-deploy while the GitHub gate is true. Do not combine this cutover with database networking work or with Phase 0B. `IMPLEMENTED`, `MERGED`, `CONFIGURED`, `ENABLED`, `DEPLOYED`, and `PRODUCTION-VALIDATED` remain distinct milestones throughout.

## Next hardening

Keep these changes separable unless a reviewed design shows they must be atomic.

1. **Durable provider operation ledger and idempotency.** Model at least `not_attempted`, `attempted`, `provider_accepted`, `result_unknown`, `published`, `reconciled`, and `failed_safely`. This is the highest-priority remaining item: PR #36's durable phase markers are deliberately its precursor, but they make an ambiguous provider outcome *visible*, not *impossible*. Provider-level `withRetry` can still reissue a request after an ambiguous network outcome, so duplicate publication remains possible.
2. **Provider reconciliation.** Reconcile internal intent and result records with provider-side post identities, and safely resolve unknown outcomes before another attempt is permitted.
3. **PostgreSQL network restriction.** Remove the `0.0.0.0/0` external allowlist recorded at the last verification, after confirming every required access path. Do not combine with the deployment cutover.
4. **Provider-token lifecycle.** Encrypt or relocate the plaintext default Instagram token and session state, define rotation/expiry/recovery, and review log and outcome redaction.
5. **Control and approval identity.** Replace the shared `CONSOLE_TOKEN`, process-local direct-socket limits, generic reviewer label, and the bearer token in browser/Slack URL history with scoped authenticated identities and a safer review/revocation flow.
6. **Retention, backup, and restore.** Set retention for briefs, approvals, events, sessions, scorecards, proposals, and media; design the reviewed forward migration needed for media deletion; verify backup policy and conduct an isolated restore drill with external-side-effect reconciliation.
7. **External readiness register.** Verify provider account ownership, scopes, app review, versions, quotas, billing, test assets, recovery contacts, and the accuracy and freshness of approved business facts.

The former worker lease/reaper item is `SUPERSEDED` and is no longer active work. Its rationale and re-entry condition are preserved in the PR #36 record above.

## Phase 0B prerequisite — fact and evidence contract

**State:** `IMPLEMENTED` — not `MERGED`, not `DEPLOYED`. Delivered by the Phase 0B.0 foundation change; migration 006 is written but deliberately unapplied.

The contract is now executable rather than aspirational. `src/harness/evidence/contract.ts` defines the kinds, per-kind validation, and the two forbidden promotions; `state/migrations/006_content_evidence.sql` enforces the same rules as database CHECK constraints so the invariant survives a writer that bypasses the application.

**Design decision — an eighth kind.** The roadmap named seven. `verified_business_fact` was added because `config/approved-facts.json` is almost entirely GCD business identity and policy, and importing "German Car Depot is at 2130 Fillmore Street" as a `verified_automotive_fact` would break the exact semantic separation this contract exists to enforce. All seven roadmap kinds are unchanged and none was renamed.

**Design decision — conflicts key on subject *and attribute*.** An earlier draft keyed on subject alone; disposable PostgreSQL integration caught it immediately, because every approved fact shares the subject `german-car-depot` and the pack therefore reported the shop's warranty and its phone number as contradicting each other, emptying `allowedFacts`. A conflict is two different claims about the same *attribute*. Records with no attribute can only conflict through an explicitly declared relation.

Durable records distinguish:

- verified automotive fact;
- sourced research;
- GCD direct observation;
- GCD empirical performance evidence;
- creative hypothesis;
- causal hypothesis or inference; and
- unsupported assumption.

Support source, source type, provenance, confidence, freshness, `observed_at`, `reviewed_at`, expiry/review-by, conflicting evidence, and supersession. Define review and conflict rules. Content-performance correlation must never silently become automotive fact or causal truth.

## Phase 0B — Content Intelligence runtime

**State:** foundation `IMPLEMENTED`; six-stage reasoning execution **not yet wired**.

Phase 0B.0 delivered the two runtime primitives the rest of the phase depends on:

- **Content evidence** — typed contract, durable schema, deterministic approved-facts adapter, evidence pack builder with conflict and staleness surfacing, and an explicit idempotent operator sync.
- **AgentRegistry** — all six target stages registered with model policy, prompt/skill/reference assets, allowed capabilities, required evidence kinds, input/output validators, and prerequisites. Asset loading is allowlist-rooted and rejects traversal; a missing mandatory asset fails loudly.
- **ContentIntelligenceContext** and a deterministic preview at `POST /console/content-intelligence/preview`, behind the existing console credential.

`executionEnabled` is `false` on every registered stage and the preview asserts it. Registration is not execution: no stage runs a model call, and the live publishing pipeline is untouched.

**Remaining slices, in order:** wire the six stages as real model calls one at a time; then performance ingestion; then governed learning. The roughly 22 originally researched specialist roles remain conceptual capabilities — most belong as deterministic services, references, or policy modules, not as mandatory model calls. After the operational prerequisites are accepted, return to the core mission with approximately six primary model reasoning stages:

1. strategy-concept;
2. automotive-truth;
3. hook-story-script;
4. production-direction;
5. packaging-adaptation; and
6. final-critic.

Implement an `AgentRegistry`, real skill/reference injection, research/reference retrieval, structured evidence capture, and deterministic input/output validation around those stages. Treat the roughly 22 originally researched specialist roles as conceptual capabilities: most should be deterministic services, references, policy modules, or optional specialists — not 22 mandatory model calls.

Keep human filming and external editing in the loop. Do not add an in-browser video editor unless a later phase explicitly requires it. Preserve human approval and governed change. Do not implement uncontrolled prompt, skill, agent, process, or publishing-rule rewriting.

## Later / deferred

- ingest platform performance with provenance and freshness;
- build content scorecards around reach, qualified followers, repeat viewing, affinity, retention, engagement, authority, and local relevance;
- track creative and causal hypotheses without confusing them with facts;
- learn from GCD empirical performance while retaining research priors;
- generate governed improvement proposals for human review;
- add paid amplification only after the organic engine and controls are reliable; and
- connect attribution, leads, and revenue after attention and audience quality are measurable.

**`DEFERRED` — browser-based video editing.** Humans film and CapCut or another external editor remains the V1 path. Re-entry condition: an explicit later phase that requires in-browser editing.
