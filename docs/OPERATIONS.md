# Operations

## Health and observability

- `GET https://gcd-social-api.onrender.com/healthz` proves the expected API process/release can respond only when its JSON includes `status: "ok"`, `service: "gcd-social-api"`, `state: "postgres"`, and the expected full Render commit. Production startup fails closed when `RENDER_GIT_COMMIT` is missing or malformed. **Independently verified 2026-08-28** by a separate final-inspection session: `/healthz` reported the exact current target `44d7336…` with PostgreSQL state healthy. Startup requires and probes PostgreSQL, but each health request does not perform a new database or provider probe.
- Authenticated `/console/state` summarizes queues, latest brief, token-health estimates, and recent events. Authenticated `/console/stream` polls the events table every 1.5 seconds and emits SSE heartbeats. Use `Authorization: Bearer <CONSOLE_TOKEN>` or `x-console-token`; do not put the secret in a URL.
- Render logs are the only checked-in log destination. The code has no metrics backend, structured trace correlation beyond event `run_id`, alert destination outside its Slack webhook messages, or dead-letter queue.
- Diagnostics call live Meta/Google APIs. They now require `CONSOLE_TOKEN`, use a process-local 20/minute limit, and have request/operation time bounds, but still must not be used as casual health checks or without an identified environment and authority.

## Scheduled and long-running work

| Work | Trigger | State/side effects |
|---|---|---|
| Daily content enqueue | Render cron `0 13 * * *` | Inserts one brief; exits if PostgreSQL unavailable |
| Worker polling | Continuous, 10-second empty-queue sleep | Claims one brief, model/image cost; if work reaches approval delivery, every environment requires Slack; approval wait and possible platform posts |
| IG token tick | Worker startup and every 12 hours, only when Instagram is active | Default Instagram-login path reads/writes plaintext token JSON and may call Instagram/Slack; alternate Facebook-login host returns its environment token without refresh |
| Migrations | API `preDeployCommand` | Applies new SQL files transactionally; migration 005 fails after 10 seconds waiting for a lock or five minutes in one statement |
| Manual brief | authenticated `POST /triggers` | Accepts only JSON `{ "goal": "..." }`, with 2,000-character/16-KiB/10-second bounds; 5 requests/minute per API limiter key |

The cron runs at 09:00 EDT or 08:00 EST. One brief generates one package containing the active platforms. API, worker, and scheduler all fail startup unless durable PostgreSQL is configured, reachable, and contains the migration-005 approval/media columns, both approval integrity constraints, and all four integrity triggers. Every environment running worker approval delivery requires an exact HTTPS `hooks.slack.com/services/...` webhook; blank is valid only when that flow is not run, such as a direct offline `createApproval` test. Production additionally requires a public root HTTPS `PUBLIC_BASE_URL`; generated-media hosting requires a root HTTPS origin in every mode. Slack approval summary text is an inert, sanitized preview; use only the message's labeled authoritative review URL/page to decide. Best-effort escalation messages also bound and neutralize goal/reason/run-ID previews. Notification requests refuse redirects and bound each attempt to 10 seconds; failed/uncertain approval delivery must finish with confirmed revocation or surface a composite error requiring reconciliation. UUID-shaped approval review/decision requests consume both a process-local 300/minute direct-socket global bucket and a 30/minute direct-socket-plus-approval-UUID bucket. Every autonomy setting still requires an unexpired, unrevoked exact-payload approval, with the whole nonempty/strict-valid/unique-platform subject, runtime target, hosted-byte digest, and live 5-MiB/JPEG/allowed-profile policy rechecked immediately before every provider HTTP attempt, including reads and retries.

The worker starts the Instagram token tick/timer only when Instagram is active. On the default Instagram-login host it uses the live PostgreSQL-backed refresh path; on the alternate Facebook-login host this module returns the environment token without refreshing it. Once a review is approved, the helper runs only when the approved array includes Instagram, and Google OAuth refresh is attempted only when that array includes GBP. A Google refresh error is logged and the provider path may still use the static fallback token from the environment; no unrelated platform refresh is attempted.

## Content evidence sync (Phase 0B.0 — deployed 2026-08-28; schema applied; tables empty)

`npm run evidence:sync` is the **only** writer of `content_evidence`. It is an explicit operator command, not a startup step and not part of any release: if it ran on boot, every deploy would silently rewrite what the system believes is true, and a bad edit to `config/approved-facts.json` would propagate without anyone deciding to apply it.

```bash
npm run build
npm run evidence:sync -- --dry-run   # no database, writes nothing, prints exactly what would change
npm run evidence:sync                # requires durable PostgreSQL with migration 006 applied
```

The dry run needs no database at all. The applying run requires durable state and refuses to proceed without it. The sync is idempotent — it compares each field and only writes on a real difference, so a second run reports `inserted=0 updated=0` and every record unchanged. `--reviewed-at=<ISO timestamp>` overrides the review timestamp attributed to the checked-in file; omit it and the current time is used.

`config/approved-facts.json` stays authoritative. The sync is a projection of it, and every record carries provenance naming the file and the exact content sha256 it was derived from, so drift between the file and durable evidence is visible rather than silent. It does not create a second source of truth: the copywriter and critic still read the JSON.

**Do not run this against production in an unauthorized session.** Migration 006 **was applied to production on 2026-08-28** and the rollout has since completed on all three services, so the tables now exist — and they are **empty**, which is correct. A first production sync is a separately authorized operation that follows the rollout; it is explicitly **not** part of it and has **not yet been run**. See the [Phase 0B.0 rollout runbook](ROLLOUT_PHASE_0B0.md).

## Routine checks

Daily: API/worker/scheduler status, pending/running/failed briefs, pending/expired/revoked approvals, last events, provider post IDs/results, token-refresh estimates, and Slack delivery. Treat a legacy/missing-hash approval as invalid and issue a fresh review; never repair it by hand. Reconcile any composite notification/revocation error before resuming. Weekly: reconcile platform posts against `brief_queue.outcome`, review model/image costs, verify that the approved destination and runtime IDs/host/version still match, and verify the shared-secret route contract/limits. Do not try to remove media rows: migration 005 deliberately rejects every media DELETE until a future reviewed retention migration exists. Monthly: provider scopes/tokens/billing, Render access, database backups, dependency advisories, canonical approved facts/CTA URLs, fact provenance/freshness, platform/model/API assumptions, and the public booking capability.

## Incident response

1. Stop the scheduler and worker when unauthorized intake, approval compromise, duplicate-post risk, or provider-account compromise is suspected.
2. Preserve database rows, Render logs, Slack messages, generated media, and provider IDs. Do not delete posts until the business owner decides.
3. Determine whether a brief was queued, claimed, approved, partially posted, or retried. Compare the approval-bound account/location/host/version and media digest to runtime configuration/database bytes, then reconcile directly with each platform.
4. Revoke/rotate affected provider, Slack, console, or database credentials at the owner-controlled system. Revoke affected pending/approved approval records through the guarded state function; no HTTP revocation endpoint is currently exposed.
5. Correct forward. A database rewind cannot undo posts, messages, model calls, or token refreshes.
6. Record timeline, affected IDs without tokens/PII, accounting/billing impact, and follow-ups.

## Deployment

Phase 0A and Phase 0D are live at the production commit recorded in [Status](STATUS.md). **Independently verified 2026-08-28** by a separate final-inspection session with Render access (this authoring engineering session has none): native Render auto-deploy was off for API, worker, and scheduler and GitHub automation was configured with the repository gate false — an intentional zero-unattended-authority window. Reconfirm immediately before any production operation rather than assuming it still holds.

The worker-ownership and recovery change (PR #36, merge `0828cc9…`) and the media normalization change (PR #38, merge `a6a4316…`) are **merged and deployed — their code is live in the current `44d7336…` release, independently verified 2026-08-28** by a separate final-inspection session with Render access. The earlier manual bootstrap's behavioural evidence (the ownership-wait timing, the August 10 reconciliation, the PR #38 controlled brief) remains **operator-reported 2026-08-27** and was not re-examined by that inspection; reconfirm it before relying on it for a decision. Controller enablement and restoration of native auto-deploy remain separate, individually authorized operations; the gate stays false until then. The Phase 0A worker-before-migration incident is why no migration-bearing release may use the ordinary controller path — and **migration 006 was applied to production on 2026-08-28** as part of the Phase 0B.0 release, which is **complete**: API, worker, and scheduler all run `44d7336…`. That rollout stopped once mid-flight at step 6 under S8/S18 on a documentation defect, then resumed under fresh authorization and finished — see [ROLLOUT_PHASE_0B0.md §0](ROLLOUT_PHASE_0B0.md).

For a no-migration release after cutover:

1. Require the complete `CI` workflow to pass for the exact `main` push. A manual CI run is diagnostic only.
2. After the serialized slot is acquired, require the CI-tested `TARGET_SHA` to equal freshly fetched current `origin/main`. A stale result reports `SUPERSEDED RELEASE — NO DEPLOYMENT` before any Render command. Then derive the API's actual `LIVE_SHA`, validate repository ancestry, and compare `LIVE_SHA..TARGET_SHA`; if all three services already report the target, stop successfully without another deploy.
3. If any `state/migrations/**` path changed, stop at `CONTROLLED MIGRATION ROLLOUT REQUIRED`. Do not trigger API, worker, scheduler, or an automatic migration. A separately authorized rollout must stop worker/scheduler, take a backup, drain or revoke old/incompatible approvals, assess actual table/media volume and lock/data effects, run exactly one migration runner/process, start only compatible services after confirmed success, and issue fresh approvals. A timeout or partial result is an investigation stop, not permission to loop.
4. Otherwise deploy the API once at `TARGET_SHA`, wait for Render `live`, and use at most 12 attempts to verify the non-redirecting, credential-free exact GCD `/healthz` URL returns JSON for `gcd-social-api`, PostgreSQL state, and `commit: TARGET_SHA`. Each attempt keeps the existing 10-second abort across fetch and body read, rejects invalid/zero/oversized Content-Length before consumption, independently enforces a 4,096-byte BYOB stream limit with one overflow-probe byte and immediate cancellation, and fails on an empty/non-byte stream, stream error, or malformed UTF-8.
5. Deploy the worker once, wait for `live`, and poll bounded Render CLI JSON logs for its single structured `TARGET_SHA` ready event. Generic started/polling text and old commits do not qualify. After the event, observe 10 seconds and require the authoritative ready-instance evidence to remain unambiguous and free of process-level fatal/crash/restart signals; missing, malformed, conflicting, or saturated evidence stops the release.
6. Deploy the scheduler once only after the worker passes, then require all three live deploy records to report `TARGET_SHA`. Do not manually execute the cron as a deployment smoke test.
7. On failure, use the bounded, Markdown-inert `$GITHUB_STEP_SUMMARY` first, then explicitly authorized Render MCP read operations if more context is needed. Its recursive JSON and recognized-pattern fallback redaction—including private percent-encoded detection and reviewed `=>`/`->` assignments—is defense in depth, not universal secret-syntax coverage; the summary remains sensitive and not public-safe. A failed or ambiguous readiness check never permits scheduler deployment. Do not loop redeploy attempts.

The controller does not implement rollback or migration execution. Application rollback and forward-only database repair/restore remain separate, explicitly authorized procedures. The exact GitHub secret/variables and the no-dual-authority native auto-deploy cutover are in [Deployment control](DEPLOYMENT.md).

## Backup, restore, and rollback

No repository-owned backup automation or restore drill was found. Verify Render retention and create an on-demand backup before migrations or high-risk changes. Restore into isolated PostgreSQL, validate `_migrations` and critical table counts, connect non-production API/worker instances, and run offline/read-only checks.

Application rollback selects a prior release/commit. SQL migrations are forward-only; use a forward repair or verified restore. Migration 005 cannot be safely paired with code that expects mutable/deletable media or the old approval schema. After restoring, keep worker/scheduler stopped until briefs, approvals, media digests/URLs, token state, events, destinations, and already-created platform posts are reconciled.

## Brief lifecycle

`brief_queue.status` is `pending → running → done|failed`. `running` is a single opaque state that spans orchestration, a human approval wait of up to 24 hours, and the provider publish loop, and `claimNextBrief` only ever selects `pending`. In the release that preceded PR #36, nothing reclaimed a `running` row, so an interrupted worker stranded its brief permanently and silently — see the August 10 incident in [Status](STATUS.md). The behavior below replaces that.

**Merged in PR #36; deployed — the code is live in the current `44d7336…` release, independently verified 2026-08-28.** The production-validated behavioral evidence remains operator-reported 2026-08-27, not independently re-examined: the operator reported the new worker waiting approximately 58 seconds for exclusive ownership before emitting readiness, and the August 10 stranded brief being reconciled with `providerMutation = impossible` and no provider replay:

1. **Exclusive ownership.** The worker holds a session-level advisory lock on a dedicated PostgreSQL connection for its whole lifetime. Render zero-downtime deploys keep the old worker alive for roughly a minute after the new one starts, so a new instance waits — reconciling nothing, emitting no readiness, consuming nothing — until the previous session ends and the lock is free.
2. **Ownership as a side-effect fence.** Losing the lock or entering shutdown blocks approval creation, credential acquisition, and every provider attempt, including between platforms. A worker that no longer owns the queue may only run its shutdown path.
3. **Recovery, refuse-don't-resume.** Once ownership is held, every remaining `running` brief provably has no live owner and is classified from its durable phase markers, then terminalized. Nothing is resumed, retried, or returned to `pending`, and recovery issues no provider request.
4. **The claim itself is fenced.** The `pending → running` transition runs on the ownership session, so it can only commit while this process is still the exclusive owner. Claiming through the shared pool left a race in which a successor could complete its startup recovery before an older claim landed, creating a fresh `running` row nothing would ever reconcile.
5. **Coordinated shutdown.** SIGTERM stops claiming and signals the active brief, which unwinds through its own path; the handler awaits it for a bounded window, then closes ordinary state. Ownership is released explicitly **only if that unwind actually finished** — handing the lock to a successor while this process might still be running side-effecting code is the dual-owner state ownership exists to prevent. If the window expires the lock is left to die with the session at process exit.
6. **Losing ownership ends the process.** A worker that loses the lock stops claiming, aborts the active brief, writes nothing (a successor may already be reconciling that row), and exits **nonzero** so Render restarts it into the ordinary acquisition path. Exiting rather than idling is deliberate: recurring timers and pooled connections keep the Node event loop alive, so merely stopping the queue loop would leave a healthy-looking worker that never consumes again.

### Reconciliation runbook

`brief:reconciled_stranded` records the classification. Act on it as follows:

| Classification | Provider state | Operator action |
|---|---|---|
| `interrupted_before_approval` | No mutation possible | None; the brief may be re-enqueued as new work |
| `interrupted_awaiting_approval` | No mutation possible | None; the approval was revoked, so issue a fresh brief if the content is still wanted |
| `uncertain_provider_outcome` | **Unknown** | Check the named platform for a post matching the run before issuing any new approval. Never re-run the brief first |
| `partial_known_publication` | Partly published | `knownProviderPostIds` lists what did publish; decide manually whether to publish the remaining platforms as new work |
| `publication_complete_unrecorded` | Fully published | None; results were reconstructed from the markers |

`requiresProviderReconciliation: true` in the outcome always means a human must look at the platform. Automatic retry is refused by design.

## Known recovery gaps

- Interruption during a provider attempt still yields an outcome the system cannot resolve on its own: recovery guarantees you are told and that nothing retries, but a human must reconcile against the platform. Closing that residual requires the provider operation ledger in [Roadmap](ROADMAP.md).
- `withRetry` re-issues a timed-out provider call up to five times, so a lost response after a provider success remains an independent double-post vector unrelated to restarts.
- No stale-running-brief reaper or worker lease is needed for a single-instance worker now that ownership plus startup recovery is in place; a lease would be required again only for multi-instance operation.
- No durable publish idempotency/reconciliation ledger.
- No event/approval retention process; migration 005 deliberately prevents media-row deletion, so media retention needs a reviewed forward migration.
- No automated database/provider end-to-end health probe.
- No documented restore exercise or external account takeover evidence.
- Approval review still uses a URL bearer token and a generic `human` actor label; revocation has no operator-facing route.
- Control-plane authentication shares one secret and uses per-process, direct-socket rate limits rather than distributed identity-aware enforcement.
- Checked-in facts are authoritative against caller override, but have no enforced source/confidence/freshness/last-review metadata; define that contract before Phase 0B.
- Production PostgreSQL external access remains `0.0.0.0/0` — independently reverified 2026-08-28; remediation is a separate, high-priority, separately authorized security change.
- A normal scheduled execution of the Phase 0D SHA was observed on 2026-08-25, closing that observation historically — see [Status](STATUS.md) for the run evidence. The scheduler now runs `44d7336…`, independently verified 2026-08-28. Do not manually run production cron merely to close a gap.
