# Integrations

External state was not accessed during the 2026-08-10 audit. Repository support does not prove production configuration, API approval, scopes, ownership, or current behavior.

| System | Direction/responsibility | Credentials/identifiers | Failure/cost boundary | Owner |
|---|---|---|---|---|
| Render | API, worker, scheduler, PostgreSQL | Team/service/DB access; dashboard env | Deploy, runtime, scheduling, logs, backups | Assign privately |
| PostgreSQL | Queues, approvals, media, events, sessions/tokens | `DATABASE_URL` | Durability and coordination fail; in-memory fallback is process-local | Assign privately |
| Anthropic | Copy, image prompt, SEO, critic, vision QC | `ANTHROPIC_API_KEY`, configured model IDs | Cost/data egress; failures retry; QC errors fail open | Budget/technical owner |
| fal.ai | Image generation | `IMAGEGEN_API_KEY`, model slugs | Cost and hosted-media dependency | Creative/technical owner |
| Slack incoming webhook | Approval and token-refresh alerts | `APPROVAL_CHANNEL_WEBHOOK` | Approval link delivery; no implemented email fallback | Approval-channel owner |
| Instagram Graph | Image publishing and token refresh | User/app IDs/secrets/tokens, host/version | Live post creation; token stored in env and PostgreSQL | Social account owner |
| Facebook Pages | Page feed/photo publishing | Page/app IDs and access tokens | Live post creation | Social account owner |
| Google Business Profile | Local posts and OAuth refresh | Access/refresh/client credentials, account/location IDs | Live post creation; API access approval required | Business profile owner |
| gcd-arcade | Reads console manifest/state/SSE | `CONSOLE_TOKEN` counterpart | Operational telemetry disclosure | Both repository owners |
| Public website/booking service | Approved facts and CTA URL | Public URLs/capability identifier | Customer-facing link correctness | Business owner |

## Native publishing boundaries

Instagram performs create-container, polls status, then publishes. Facebook uses feed or photo endpoints. GBP uses the configured v4 local-post endpoint. Current endpoint versions, permissions, quotas, test accounts, and platform-review state require provider-side verification before go-live or upgrades.

The code retries network/429/5xx failures. It does not persist an idempotency key or a provider operation ledger, so retries/crashes can require manual duplicate reconciliation. An API success response is captured in the brief outcome but is not later revalidated.

## Slack approval boundary

The worker posts a URL containing the approval token to a Slack incoming webhook. No email fallback exists despite historical prompt claims. Configure a private channel, restrict webhook owners, minimize link retention, and treat message history/browser/proxy logs as bearer-token exposure paths.

## Arcade boundary

Arcade consumes `/console/manifest`, `/console/state`, and `/console/stream`. Configure a nonempty matching token in both repositories. The source also accepts a query `key`, which can enter logs; prefer `x-console-token`. The manifest currently shares the same gate as state/stream.

## Private continuity register

Record provider account/tenant, billing owner, scopes, IDs, token/secret storage location, last rotation, recovery contacts, test assets, app-review/API-approval state, Render services/custom domains/deploy controls, PostgreSQL retention/restore evidence, Slack channel/webhook ownership, Arcade counterpart, public website/booking ownership, and emergency revoke/suspend steps. Never record secret values here.
