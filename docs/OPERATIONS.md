# Operations

## Health and observability

- `GET /healthz` proves the API process can respond and reports configured state mode. API startup requires and probes PostgreSQL, but each health request does not perform a new database or provider probe.
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

Phase 0A is live at the production commit recorded in the root README. The native concurrent rollout produced a real worker-before-migration crash, so future unattended releases must use the controller in [Deployment control](DEPLOYMENT.md) after its explicit cutover. Until then, keep `RENDER_DEPLOY_AUTOMATION_ENABLED=false` and leave native auto-deploy as the sole authority.

For a no-migration release after cutover:

1. Require the complete `CI` workflow to pass for the exact `main` push. A manual CI run is diagnostic only.
2. After the serialized slot is acquired, require the CI-tested `TARGET_SHA` to equal freshly fetched current `origin/main`. A stale result reports `SUPERSEDED RELEASE — NO DEPLOYMENT` before any Render command. Then derive the API's actual `LIVE_SHA`, validate repository ancestry, and compare `LIVE_SHA..TARGET_SHA`; if all three services already report the target, stop successfully without another deploy.
3. If any `state/migrations/**` path changed, stop at `CONTROLLED MIGRATION ROLLOUT REQUIRED`. Do not trigger API, worker, scheduler, or an automatic migration. Plan a separately authorized rollout with a backup, reviewed locks/data effects, stopped incompatible consumers, and exactly one migration runner.
4. Otherwise deploy the API once at `TARGET_SHA`, wait for Render `live`, and verify `/healthz` with bounded retries.
5. Deploy the worker once, wait for `live`, and require bounded recent logs to show its started/polling signal without an obvious crash.
6. Deploy the scheduler once only after the worker passes, then require all three live deploy records to report `TARGET_SHA`. Do not manually execute the cron as a deployment smoke test.
7. On failure, use the redacted `$GITHUB_STEP_SUMMARY` first, then explicitly authorized Render MCP read operations if more context is needed. Do not loop redeploy attempts.

The controller does not implement rollback or migration execution. Application rollback and forward-only database repair/restore remain separate, explicitly authorized procedures. The exact GitHub secret/variables and the no-dual-authority native auto-deploy cutover are in [Deployment control](DEPLOYMENT.md).

## Backup, restore, and rollback

No repository-owned backup automation or restore drill was found. Verify Render retention and create an on-demand backup before migrations or high-risk changes. Restore into isolated PostgreSQL, validate `_migrations` and critical table counts, connect non-production API/worker instances, and run offline/read-only checks.

Application rollback selects a prior release/commit. SQL migrations are forward-only; use a forward repair or verified restore. Migration 005 cannot be safely paired with code that expects mutable/deletable media or the old approval schema. After restoring, keep worker/scheduler stopped until briefs, approvals, media digests/URLs, token state, events, destinations, and already-created platform posts are reconciled.

## Known recovery gaps

- No stale-running-brief reaper or worker lease.
- No durable publish idempotency/reconciliation ledger.
- No event/approval retention process; migration 005 deliberately prevents media-row deletion, so media retention needs a reviewed forward migration.
- No automated database/provider end-to-end health probe.
- No documented restore exercise or external account takeover evidence.
- Approval review still uses a URL bearer token and a generic `human` actor label; revocation has no operator-facing route.
- Control-plane authentication shares one secret and uses per-process, direct-socket rate limits rather than distributed identity-aware enforcement.
- Checked-in facts are authoritative against caller override, but have no enforced source/confidence/freshness/last-review metadata; define that contract before Phase 0B.
- Production PostgreSQL external access was discovered as `0.0.0.0/0`; remediation is a separate security change.
- The scheduler artifact was live at discovery, but its first scheduled execution had not yet been observed.
