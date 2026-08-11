# Environment

`.env.example` is the safe local reference. Production values belong in Render/secret management. `render.yaml` is a declaration, not proof values are present.

## Runtime and state

| Variable | Behavior | Safety |
|---|---|---|
| `NODE_ENV` | Runtime mode, default development | Render sets production |
| `PORT` | API port, default 3000 | Render may inject |
| `DATABASE_URL` | PostgreSQL state | Required for durable multi-process behavior and migrations |
| `PUBLIC_BASE_URL` | Approval/media URL origin | Must be public HTTPS and match API service |
| `ACTIVE_PLATFORMS` | Comma list of `instagram,facebook,gbp`; invalid/empty selection falls back to all | Set explicitly to avoid unintended provider attempts |
| `AUTONOMY_PHASE` | A/B/C parser; invalid defaults A | Worker still waits for approval in all phases; C only disables assertion |

## Model, image, and harness

| Variable | Behavior | Safety |
|---|---|---|
| `ANTHROPIC_API_KEY` | Enables model and vision calls | Cost and content egress |
| `IMAGEGEN_API_KEY` | fal.ai image generation | Cost and prompt/image egress |
| `MANAGER_MODEL` | Dormant `agentLoop.ts` manager model override | Not used by production worker |
| `COMPACT_CONTEXT_THRESHOLD` | Compaction signal threshold | Used only by dormant manager-turn harness |
| `COMPACT_CONTEXT_INTERVAL` | Repeat interval | Same limitation |
| `SESSION_START_MAX_CHARS` | Configured memory bound | Currently not enforced by a production load path |

## HTTP and approval boundaries

| Variable | Behavior | Safety |
|---|---|---|
| `APPROVAL_CHANNEL_WEBHOOK` | Slack incoming webhook | Secret; current only approval notification channel |
| `CONSOLE_TOKEN` | Gates `/console/*` only when nonempty | Empty fails open; set everywhere shared |

There is no checked-in environment variable for authenticating `/triggers` or `/diag/*`; this is an open security gap.

## Meta

| Variable | Behavior |
|---|---|
| `IG_USER_ID`, `IG_ACCESS_TOKEN` | Instagram publishing identity/token |
| `IG_GRAPH_HOST` | Defaults to `graph.instagram.com` |
| `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN` | Facebook publishing |
| `GRAPH_VERSION` | Defaults to `v25.0` in request builders |

Instagram refresh persists the live token and original env seed in PostgreSQL plaintext. Older setup material referenced Meta app ID/secret variables, but active code does not read them and the safe environment example does not declare them.

## Google Business Profile

| Variable | Behavior |
|---|---|
| `GOOGLE_ACCESS_TOKEN` | Static fallback access token |
| `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Preferred refresh flow |
| `GBP_ACCOUNT_ID`, `GBP_LOCATION_ID` | Target account/location |

Use provider-approved test accounts/locations for validation. Never put real IDs, tokens, webhook URLs, or approval links in `.env.example`, docs, tests, or logs.
