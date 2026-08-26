# Environment

`.env.example` is the safe application-runtime reference. Production application values belong in Render/secret management. `render.yaml` is a declaration, not proof values are present. GitHub deployment-controller configuration is intentionally separate and must not be copied into `.env.example` or Render service environments.

## Runtime and state

| Variable | Behavior | Safety |
|---|---|---|
| `NODE_ENV` | Runtime mode, default development | Render sets production |
| `PORT` | API port, default 3000 | Render may inject |
| `API_BIND_HOST` | Optional API listener host | Set `127.0.0.1` for local-only validation; checked-in Render leaves it unset so the service uses the platform-required wildcard listener |
| `DATABASE_URL` | PostgreSQL state | API, worker, and scheduler require connectivity plus migration-005 approval/media columns, both approval integrity constraints, and four integrity triggers at startup; memory state is offline-test only and cannot publish |
| `PUBLIC_BASE_URL` | Approval/media URL origin | Production approval delivery requires a public root HTTPS origin; generated-media hosting requires a root HTTPS origin in every mode. No credentials, path, query, or fragment; new media URLs use this exact origin |
| `ACTIVE_PLATFORMS` | Comma list of `instagram,facebook,gbp`; invalid/empty selection falls back to all | Set explicitly to avoid unintended provider attempts |
| `AUTONOMY_PHASE` | A/B/C parser; invalid defaults A | Every value now uses the same durable exact-payload gate; keep A until an explicitly authorized later phase exists |
| `RENDER_GIT_COMMIT` | Render-injected full commit identity for production API health and worker readiness | Required and validated in production; do not set it manually in `.env.example` or `render.yaml` |
| `RENDER_INSTANCE_ID` | Optional Render-injected API/worker runtime correlation identity; exposed only in the worker readiness marker | Non-secret and format-validated by both processes when present; do not set it manually in `.env.example` or `render.yaml` |

## Model, image, and harness

| Variable | Behavior | Safety |
|---|---|---|
| `ANTHROPIC_API_KEY` | Enables model and vision calls | Cost and content egress |
| `IMAGEGEN_API_KEY` | fal.ai image generation | Required for a publishable image; cost and prompt/image egress |
| `MANAGER_MODEL` | Dormant `agentLoop.ts` manager model override | Not used by production worker |
| `COMPACT_CONTEXT_THRESHOLD` | Compaction signal threshold | Used only by dormant manager-turn harness |
| `COMPACT_CONTEXT_INTERVAL` | Repeat interval | Same limitation |
| `SESSION_START_MAX_CHARS` | Configured memory bound | Currently not enforced by a production load path |

## HTTP and approval boundaries

| Variable | Behavior | Safety |
|---|---|---|
| `APPROVAL_CHANNEL_WEBHOOK` | Slack incoming webhook | Secret and required whenever the worker approval-delivery flow runs, in every `NODE_ENV`; blank is valid only when that flow is not run. Only exact HTTPS `hooks.slack.com/services/<a>/<b>/<c>` URLs are accepted, redirects are refused, and failed/uncertain delivery must end in confirmed revocation or a surfaced composite error |
| `CONSOLE_TOKEN` | Transitional shared secret for `/triggers`, `/diag/*`, and `/console/*`; accepts `Authorization: Bearer` or `x-console-token` | Empty fails closed for protected routes; never send in URL/query; split into scoped credentials later |

The API deliberately reuses the already-declared console secret for Phase 0A instead of requiring an undeployed variable. This reduces exposure but is not a final identity design. It uses constant-time digest comparison and refuses query-string credentials. Fixed-window rate limits are process-local: 5/minute for triggers, 20/minute for diagnostics, 120/minute for console, 60/minute for authentication failures, a 300/minute direct-socket global bucket across approval GET/decision, and a second 30/minute bucket for each direct-socket-plus-approval-UUID. Only UUID-shaped approval IDs route. Because forwarded headers are not trusted, the direct socket address is the client key; behind a reverse proxy the global/control buckets may behave as service-wide limits.

The HTTP server applies 10-second header and complete-request receive deadlines with one-second expiry-scan granularity. Manual triggers additionally require `application/json`, a body of at most 16 KiB delivered within the route's 10-second reader, and exactly one `goal` field containing 1–2,000 trimmed characters. The API rejects unknown fields, including `approvedFacts`; early body-bearing authentication/content-type rejections close their socket without draining unread bytes. Approval decision bodies use the same size/read bounds. Diagnostics are observed through a 15-second route timeout and Graph fetches use a 10-second abort. These are code constants, not environment settings.

## Meta

| Variable | Behavior |
|---|---|
| `IG_USER_ID`, `IG_ACCESS_TOKEN` | Instagram publishing identity/token; the ID is approval-bound, the token is not |
| `IG_GRAPH_HOST` | Approval-bound Instagram API host; defaults to `graph.instagram.com`, with only that host or `graph.facebook.com` accepted |
| `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN` | Facebook publishing; the Page ID is approval-bound and the host is fixed to `graph.facebook.com` |
| `GRAPH_VERSION` | Approval-bound Meta API version; defaults to `v25.0` |

Before model work, the orchestrator derives each active non-secret destination from these variables and includes it in both review preview and exact provider payload. Native request construction and the guard before every provider HTTP attempt—including reads and retries—require the runtime IDs, host, and version to equal the approved values. A token rotation that preserves the destination needs no content change; changing the ID/host/version requires a newly generated package and approval. Tokens are never included in the approval subject. The worker starts its token tick/timer only when `ACTIVE_PLATFORMS` contains Instagram. On the default `graph.instagram.com` path, the helper persists the live token and original env seed in PostgreSQL plaintext and refreshes it; the alternate `graph.facebook.com` path returns the environment token and is not refreshed here. After approval the helper is called only when the approved array contains Instagram. Older setup material referenced Meta app ID/secret variables, but active code does not read them and the safe environment example does not declare them.

## Google Business Profile

| Variable | Behavior |
|---|---|
| `GOOGLE_ACCESS_TOKEN` | Static fallback access token |
| `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Preferred refresh flow |
| `GBP_ACCOUNT_ID`, `GBP_LOCATION_ID` | Approval-bound target account/location; API host/version are fixed to `mybusiness.googleapis.com/v4` |

Use provider-approved test accounts/locations for validation. Never put real IDs, tokens, webhook URLs, or approval links in `.env.example`, docs, tests, or logs.

After approval, the worker attempts Google access-token refresh only when the exact approved array contains a GBP package. A Google refresh error is logged; the provider call then proceeds with any static fallback access token already loaded from the environment and fails normally if no usable token exists.

## Checked-in Render service scope

The checked-in Blueprint keeps `ANTHROPIC_API_KEY`, `IMAGEGEN_API_KEY`, and `APPROVAL_CHANNEL_WEBHOOK` on the worker, not the API. The API retains Meta/Google credentials and identifiers only because its authenticated diagnostics use them; the scheduler receives only `NODE_ENV` and `DATABASE_URL`. Read-only production discovery verified service identity, branch, command, health/schedule, native auto-deploy off, and database metadata, but did not retrieve application environment values. `render.yaml` remains intent rather than complete proof of secret scope.

## GitHub production deployment configuration

The separate GitHub `production` environment was verified to hold secret name `RENDER_API_KEY` and non-secret variables `RENDER_WORKSPACE_ID`, `RENDER_API_SERVICE_ID`, `RENDER_WORKER_SERVICE_ID`, `RENDER_SCHEDULER_SERVICE_ID`, and `RENDER_API_HEALTH_URL`, with deployment restricted to `main`. The secret value was not retrieved. The health variable is not a free-form destination: the controller accepts only `https://gcd-social-api.onrender.com/healthz`. Repository variable `RENDER_DEPLOY_AUTOMATION_ENABLED` is deliberately outside the environment because the provenance job checks it before the deployment job enters that environment. It was `false` and all three Render native settings were off at the last read-only verification on 2026-08-24, leaving the intended zero-authority window; neither has been reverified since, so reconfirm rather than assume. Only a separately authorized change to exact string `true` permits the controller to continue, and that change is gated behind the manual ownership bootstrap. Exact values, the bootstrap procedure, and the remaining proof steps are in [Deployment control](DEPLOYMENT.md).

These names are control-plane inputs read by GitHub workflow/controller code, not application runtime reads. `RENDER_API_KEY` must exist only as a GitHub secret, must never be echoed, and must not be placed in Render service env, `.env`, documentation values, or fixtures.
