# Credentials & Deploy Setup

How to stand up GCD-SOCIAL on **Render** and wire the **native** publishing
credentials (Instagram, Facebook Page, Google Business Profile). All secret
values live in Render (or a local `.env`) — **never commit them**.

Platform decision: **Render**, not Vercel. The orchestration runs as a
long-running background worker that waits on human approval — serverless
(Vercel) cannot host that. See `BUILD_PLAN.md`.

---

## 1. Deploy on Render (Blueprint)

The repo ships a `render.yaml` Blueprint defining everything: a `web` service
(trigger receiver), a `worker` (orchestration), and a Postgres DB.

1. Render dashboard → **Blueprints** → **New Blueprint Instance** (not the
   "New service" dropdown — that's for one-off services).
2. Connect the GitHub repo **Caposhi/GCD-Agents**, branch **main**.
3. Render reads `render.yaml` and proposes: `gcd-social-api`,
   `gcd-social-worker`, `gcd-social-db`. Apply.
4. It will prompt for every `sync: false` env var — fill them from sections
   2–4 below. `DATABASE_URL` is wired automatically from the DB.
5. After first deploy, run migrations once: a Render **Shell** on the worker →
   `npm run migrate` (or a one-off job) to create the tables.

> Manual alternative (if not using the Blueprint): create **Postgres**, then a
> **Web Service** (`npm run start:api`, health check `/healthz`), then a
> **Background Worker** (`npm run start:worker`), all build `npm ci && npm run build`.

## 2. Instagram (Instagram-Login path)

Posts go through `graph.instagram.com` with an **Instagram user token**.

1. Meta app → use case **"Manage messaging & content on Instagram"**.
2. Permissions & features → add **`instagram_business_content_publish`**
   (plus `instagram_business_basic`). This is what allows publishing.
3. Assign the IG account the **Instagram Tester** role (Roles tab).
4. **Generate token** for the account → copy the IG user token.
5. Env:
   - `IG_USER_ID` = `17841400589230178` (germancardepot) — the **numeric** id, not the handle
   - `IG_ACCESS_TOKEN` = the generated token (secret)
   - `IG_APP_ID` / `IG_APP_SECRET` = from the Instagram API → "API setup with Instagram login" page (app id is not secret; app secret IS). Used by the token-refresh/exchange layer + `appsecret_proof`, **not** by the publish calls. The dashboard token is long-lived (~60 days); refresh before expiry.
- Constraints enforced by the tool: image must be a **public JPEG URL**; AI
  images set `is_ai_generated=true`; 100 posts/24h (we post 1/day).

## 3. Facebook Page (Facebook-Login path)

Posts go through `graph.facebook.com` with a **Page token**.

1. Meta app → use case **"Manage everything on your Page"** (Pages API).
2. Permissions: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.
3. Get a **long-lived Page access token** (Graph API Explorer → exchange for
   long-lived; renew ~every 60 days).
4. Env:
   - `FB_PAGE_ID` = the GCD Page id
   - `FB_PAGE_ACCESS_TOKEN` = long-lived Page token (secret)

## 4. Google Business Profile

Posts use the v4 `localPosts` API with OAuth.

1. Google Cloud project → **submit the Business Profile API access request**
   and wait for approval (the slow gate).
2. OAuth consent screen + OAuth client; scope `https://www.googleapis.com/auth/business.manage`.
3. Authorize once; capture **access + refresh tokens**.
4. Find IDs: `accounts.list` → `GBP_ACCOUNT_ID`; `locations.list` →
   `GBP_LOCATION_ID` (the correct location: Doral vs Hollywood/Wiley St).
5. Env: `GOOGLE_ACCESS_TOKEN`, `GOOGLE_REFRESH_TOKEN`, `GBP_ACCOUNT_ID`,
   `GBP_LOCATION_ID`.

## 5. Other env vars

| Key | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console |
| `IMAGEGEN_API_KEY` | image provider (chosen in Phase 3 image-tool) |
| `APPROVAL_CHANNEL_WEBHOOK` | Slack incoming webhook (approval channel) |
| `AUTONOMY_PHASE` | `A` (default; human approves every post) |
| `DATABASE_URL` | auto-wired by Render Postgres |

## Token lifecycle (TODO before go-live)
- Meta long-lived Page token ≈ 60-day expiry → needs periodic refresh.
- Google access token is short-lived → refresh via `GOOGLE_REFRESH_TOKEN`.
- A token-refresh layer will be added when live creds are wired; until then the
  tool uses the supplied tokens directly and escalates on 401/expiry.

## Testing
- Offline (no creds): `npm run build && npm run test:posting`.
- Live: there is **no sandbox** — test against a dedicated test Page / test IG
  account / test GBP location before touching the real profiles.

## Golden rule
Tokens and keys are secrets. They go in Render's `sync: false` env or a local
`.env` (gitignored). Never paste them into chat, code, commits, or the repo.
