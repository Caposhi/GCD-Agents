# Operations

## Health and observability

- `GET /healthz` proves the API process can respond and reports configured state mode; it does not query PostgreSQL or a provider.
- `/console/state` summarizes queues, latest brief, token-health estimates, and recent events. `/console/stream` polls the events table every 1.5 seconds and emits SSE heartbeats.
- Render logs are the only checked-in log destination. The code has no metrics backend, structured trace correlation beyond event `run_id`, alert escalation beyond Slack token-refresh messages, or dead-letter queue.
- Diagnostics call live Meta/Google APIs and are unauthenticated in current source; do not expose or use them as casual health checks.

## Scheduled and long-running work

| Work | Trigger | State/side effects |
|---|---|---|
| Daily content enqueue | Render cron `0 13 * * *` | Inserts one brief; exits if PostgreSQL unavailable |
| Worker polling | Continuous, 10-second empty-queue sleep | Claims one brief, model/image cost, approval wait, possible platform posts |
| IG token refresh | Worker startup and every 12 hours | Reads/writes plaintext token JSON in `session_state`; may call Instagram and Slack |
| Migrations | API `preDeployCommand` | Applies new SQL files transactionally |
| Manual brief | `POST /triggers` | Inserts arbitrary brief; currently unauthenticated |

The cron runs at 09:00 EDT or 08:00 EST. One brief generates one package containing the active platforms. Phase A still requires approval for each package.

## Routine checks

Daily: API/worker/scheduler status, pending/running/failed briefs, pending/expired approvals, last events, provider post results, token-refresh estimates, and Slack delivery. Weekly: reconcile platform posts against `brief_queue.outcome`, review model/image costs, remove stale test media only under an approved retention policy, and verify console/intake exposure. Monthly: provider scopes/tokens/billing, Render access, database backups, dependency advisories, approved facts, platform/model/API assumptions, and the public booking capability.

## Incident response

1. Stop the scheduler and worker when unauthorized intake, approval compromise, duplicate-post risk, or provider-account compromise is suspected.
2. Preserve database rows, Render logs, Slack messages, generated media, and provider IDs. Do not delete posts until the business owner decides.
3. Determine whether a brief was queued, claimed, approved, partially posted, or retried. Reconcile directly with each platform.
4. Revoke/rotate affected provider, Slack, console, approval, or database credentials at the owner-controlled system.
5. Correct forward. A database rewind cannot undo posts, messages, model calls, or token refreshes.
6. Record timeline, affected IDs without tokens/PII, accounting/billing impact, and follow-ups.

## Deployment

1. Identify the Render Blueprint instance, branch, database, and all external accounts.
2. Back up PostgreSQL and review new migration SQL.
3. Run build, typecheck, all four self-tests, simulated dry run, dependency/security scans, and documentation validation.
4. Deploy API/worker-compatible code; the API predeploy applies migrations.
5. Verify API liveness and database queue reads without invoking diagnostics or manual triggers unless authorized.
6. Confirm the scheduler and worker only after configuration and approval-channel checks.
7. Observe the next normal approval lifecycle and reconcile provider results.

## Backup, restore, and rollback

No repository-owned backup automation or restore drill was found. Verify Render retention and create an on-demand backup before migrations or high-risk changes. Restore into isolated PostgreSQL, validate `_migrations` and critical table counts, connect non-production API/worker instances, and run offline/read-only checks.

Application rollback selects a prior release/commit. SQL migrations are forward-only; use a forward repair or verified restore. After restoring, keep worker/scheduler stopped until briefs, approvals, media, token state, events, and already-created platform posts are reconciled.

## Known recovery gaps

- No stale-running-brief reaper or worker lease.
- No durable publish idempotency/reconciliation ledger.
- No media/event/approval retention process.
- No automated database/provider end-to-end health probe.
- No documented restore exercise or external account takeover evidence.
