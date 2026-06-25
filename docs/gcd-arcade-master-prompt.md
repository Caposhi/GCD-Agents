# GCD-ARCADE — Master Build Prompt

> Paste this whole document as the opening prompt of a **new Claude Code session**, started from the new `gcd-arcade` repo. Add the sibling repos (`caposhi/gcd-agents`, `german-car-depot-attribution`, `gcd-webhook`) to that session so the agent can read each app's stack when wiring its `/console/*` contract.

---

## 0. What you are building

**GCD-ARCADE** is a retro-console "home screen" for German Car Depot's internal software. It looks and feels like a **PlayStation 3 / PSP XMB (Cross-Media Bar)**: a horizontal ribbon of glossy app icons; scroll left/right to pick a program, press down/enter to open it. Each program opens into its **own themed "live game view"** that visualizes that program's real, live processes (agents working, jobs running, webhooks firing) in a playful arcade style.

It is a **launcher + aggregator**, not a rewrite of the underlying programs. Each program stays in its own repo and deploy; the hub reads from them over a small read-only contract and never owns their data or business logic.

### Locked product decisions (do not relitigate)
- **Front-end:** React + Vite + TypeScript (SPA).
- **Aesthetic:** PS3/PSP XMB cross-media-bar home screen.
- **Access:** private, unguessable URL only (no login screen for v1).
- **View model:** the hub renders every app's view itself (one codebase), each view with its own theme/skin, all fed by that app's `/console/*` feed.
- **Existing dashboards** (Attribution): render a retro live-view summary in the hub + an "Open full dashboard" link-out — do NOT rebuild the existing Next.js UI.
- **Webhook server**: one "Automation Server" tile that opens to 4 sub-view mini-games.
- **v1 scope:** full XMB shell + GCD-SOCIAL view fully live on its SSE feed; other tiles show live `/console` summaries and deepen per app over time.
- **Hosting:** Render (static site for the front-end + one Node web service for the BFF). Same Render account as the other apps.
- **Sensory:** tasteful XMB navigation SFX + background music **toggle (off by default)**, subtle CRT glow/scanline option, short PlayStation-style boot animation. All toggleable and remembered in localStorage.
- **Theming:** GCD brand (navy `#182848`, royal `#18479F`, lemondrop `#F8E000`) on the launcher shell; each app's inner view gets its own distinct world/theme.
- **Devices:** desktop-primary; must also look good full-screen on a wall-mounted shop TV (1080p). Keyboard + gamepad-style arrow navigation.

---

## 1. The app inventory (tiles)

There are **three backend repos**. Two are single-purpose; the third (`gcd-webhook`) is a single Express `server.js` that actually contains ~10 distinct programs — each is its own candidate view/mini-game.

### Backend systems
| Repo | Stack | Console status |
|---|---|---|
| `caposhi/gcd-agents` (GCD-SOCIAL) | Node/TS + Postgres | ✅ `/console/*` implemented (reference) |
| `german-car-depot-attribution` | Next.js + Fastify + Prisma + BullMQ + Redis | ⛏ needs `/console/*` (section 3b) |
| `gcd-webhook` | single-file Express (CommonJS) + Upstash Redis + Telnyx + SendGrid + Tekmetric + GoTo | ⛏ needs `/console/*` (section 3c) — already has an SSE bus (`pushSSEEvent`/`sseClients`) and Redis state to build on |

### Programs inside `gcd-webhook` (each a view) — confirmed from `server.js`
| Program | What it does | Live data / source | Existing UI to link out |
|---|---|---|---|
| **Call Transcript Search** (GoTo) | GoToConnect call-transcript DB; nightly sync (2 AM ET), OAuth, full-text search | `transcript-db/*`, mounted `/api/admin/transcripts`; nightly `runNightlySync()` | `/api/admin/transcripts` (existing search UI) — **this is the "Call Tracking Transcripts" app; it already exists** |
| **SMS Inbox** | Real-time two-way Telnyx SMS inbox, Redis-backed threads, SSE live updates | `gcd:sms:inbox`, `gcd:sms:thread:*`; `pushSSEEvent`; inbound `/webhooks/telnyx-incoming` | `/admin/sms` (existing chat UI) |
| **Declined-Job Win-Back** | Tracks declined jobs, tiered discounts, daily 10 AM SMS+email campaign | `gcd:declined-jobs`; `processDailyReminders()`; `/declined-jobs` | — (JSON endpoint only) |
| **DetectAuto Maintenance** | Parses "DA -" concerns, 3-stage (30/90/180-day) maintenance SMS+email | `gcd:maintenance-reminders`; `processMaintenanceReminders()` | — |
| **Customer Validation** | ZeroBounce email + USPS address validation on new customer/RO; writes Tekmetric notes; alerts | `runValidationsAndUpdateCustomer()` via `/webhooks/tekmetric-customer-created` | — |
| **Inspection (DVI) Compliance** | 3-layer check that completed ROs have a DVI; alerts if missing | `gcd:inspections`; `handleCompletedRepairOrder()`; `/inspections` | — |
| **Monthly Email Audit** | Validates ALL customer emails monthly, removes undeliverables, emails a report | `runMonthlyEmailAudit()`; cron 1st @ 10 AM ET | — |
| **Auto Next-Service Scheduler** | Drops TENTATIVE placeholder appointments on the Tekmetric calendar for recurring services | `gcd:next-service-appointments`; `processNextServiceAppointments()`; daily 10:30 AM ET | — |
| **Engagement Tracking** | SendGrid opens/clicks → Google Sheets | `/webhooks/sendgrid-events` → Sheets `Opens`/`Clicks` | Google Sheet |
| **Marketing Bonus** | Monthly marketing-bonus sheet update | `scripts/marketing-bonus`; cron 1st @ 8 AM ET | Google Sheet |

> ⚠️ Correction to the README: outbound SMS is **Telnyx** (`/webhooks/telnyx-incoming`, `sendTelnyxSMS`), not Twilio.

### Recommended XMB tile layout
Top-level tiles on the home ribbon:
1. **🔧 Agents Live View** — GCD-SOCIAL (live now)
2. **📊 Attribution Dashboard** — retro live-view + "Open full dashboard" link-out
3. **📞 Call Transcripts** — GoTo transcript search (its own tile; backend lives in `gcd-webhook`)
4. **💬 SMS Inbox** — two-way messaging (its own tile; it already has a polished UI you can either link out to or re-skin)
5. **🛠️ Automation Server** — one tile that opens to a sub-grid of the remaining `gcd-webhook` programs as mini-games: **Win-Back**, **Maintenance**, **Validation**, **Inspections**, **Email Audit**, **Next-Service**, **Engagement**, **Marketing Bonus**

This keeps the two big standalone apps (Transcripts, SMS Inbox) prominent while grouping the Tekmetric back-office automations. Adjust if the user prefers more/fewer top-level tiles.

---

## 2. The `/console/*` contract (shared across all apps)

Every program exposes the same three **read-only** endpoints. This is the only coupling between the hub and the apps. GCD-SOCIAL already implements this exactly — use it as the reference implementation.

### `GET /console/manifest` → static identity
```json
{
  "id": "gcd-social",
  "name": "GCD-SOCIAL",
  "tagline": "Autonomous social posting — Instagram + Facebook",
  "description": "Multi-agent manager that drafts, illustrates, fact-checks, and (on approval) publishes daily posts.",
  "theme": { "palette": ["#182848", "#18479F", "#F8E000"], "style": "8-bit shop floor", "icon": "🔧" },
  "agents": ["analytics", "copywriter", "image", "hashtag-seo-timing", "brand-compliance-critic", "platform-formatter", "posting"],
  "endpoints": { "state": "/console/state", "stream": "/console/stream" }
}
```

### `GET /console/state` → current snapshot (for tile badges + view header)
App-specific shape, but always small JSON. e.g. GCD-SOCIAL returns autonomy phase, active platforms, brief-queue counts, IG-token health, last brief, and last 20 events.

### `GET /console/stream` → Server-Sent Events (the live game view)
Each event is an SSE frame:
```
id: 1287
event: agent:start
data: {"id":1287,"runId":"<brief-id>","kind":"agent:start","agent":"copywriter","message":"copywriter → running","data":{...},"createdAt":"..."}
```
Query param `?since=<id>` resumes after a cursor. Heartbeat `: ping` every cycle. Common `kind`s GCD-SOCIAL emits: `brief:start`, `agent:start`, `agent:done`, `image:done`, `critic:verdict`, `brief:awaiting_approval`, `brief:published`, `brief:escalated`.

### Rules for the contract
- **Read-only. No secrets** in any payload (token *health* yes, token *values* never).
- **CORS-open** (`access-control-allow-origin: *`); optionally gate with a `CONSOLE_TOKEN` env (`?key=` or `x-console-token` header). The hub's BFF holds those tokens server-side.
- **Fire-and-forget telemetry** — emitting an event must never break the underlying app's real work.

---

## 3. Paste-ready `/console/*` for each existing app

### 3a. GCD-SOCIAL (`caposhi/gcd-agents`) — DONE ✅
Already implemented in `src/api/server.ts` (`/console/manifest|state|stream`), backed by an `events` table (migration `004_events.sql`) the worker appends to. Nothing to do; use it as the contract reference.

### 3b. Attribution Dashboard (`german-car-depot-attribution`, Fastify `apps/api`)
Add a Fastify plugin `apps/api/src/routes/console.ts` and register it. Skeleton (adapt field names to the real Prisma models / BullMQ queues):

```ts
import { FastifyInstance } from "fastify";
import { prisma } from "../db"; // adjust import to repo

const MANIFEST = {
  id: "attribution",
  name: "Attribution Dashboard",
  tagline: "Meta Ads ↔ Tekmetric offline revenue attribution",
  description: "Matches leads to repair orders, attributes revenue to campaigns, and sends offline conversions to Meta.",
  theme: { palette: ["#0b1f3a", "#1877F2", "#42b72a"], style: "neon trading terminal", icon: "📊" },
  endpoints: { state: "/console/state", stream: "/console/stream" },
  externalUrl: process.env.PUBLIC_WEB_URL ?? null, // the existing Next.js dashboard, for "Open full dashboard"
};

export async function consoleRoutes(app: FastifyInstance) {
  app.get("/console/manifest", async () => MANIFEST);

  app.get("/console/state", async () => {
    // Pull a compact snapshot — adapt to real models:
    //  - latest KPIs: spend, revenue, ROAS, CAC over last 30d
    //  - data_quality_metrics latest row (match rate, CAPI acceptance)
    //  - recent job runs (BullMQ): name, status, finishedAt
    const dq = await prisma.data_quality_metrics.findFirst({ orderBy: { date: "desc" } });
    return {
      id: "attribution",
      kpis: { /* spend, revenue, roas, cac — compute from meta_daily_stats + attributed_conversions */ },
      dataQuality: dq ?? null,
      jobs: [ /* { name, status, lastRunAt } for the 5 BullMQ jobs */ ],
      externalUrl: MANIFEST.externalUrl,
    };
  });

  // SSE: stream BullMQ job lifecycle + attribution events.
  app.get("/console/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache",
      connection: "keep-alive", "access-control-allow-origin": "*",
    });
    // Subscribe to BullMQ QueueEvents (active/completed/failed) for each queue and
    // write SSE frames: kind "job:active" | "job:completed" | "job:failed".
    // Send ": ping\n\n" every ~20s. Clean up listeners on req.raw.on("close").
  });
}
```
The cleanest live feed here is **BullMQ `QueueEvents`** (`active`, `completed`, `failed`, `progress`) for the 5 queues — that *is* the "live game view" of jobs running.

### 3c. `gcd-webhook` (single-file Express, CommonJS — powers Automation Server + Call Transcripts + SMS Inbox)
This one repo backs several tiles, so its contract is **multi-program**: every event carries a `program` field so the hub can route it to the right view/sub-view. It already has an SSE bus (`pushSSEEvent`/`sseClients`) and Redis-backed state — build on those. Add a console ring buffer, push to it at each program's milestones, and expose the three routes. Drop into `server.js`:

```js
// --- console contract (multi-program) ---
const consoleEvents = [];
let consoleSeq = 0;
function pushConsole(program, kind, message, data) {
  const e = { id: ++consoleSeq, program, kind, message, data: data || null, createdAt: new Date().toISOString() };
  consoleEvents.push(e);
  if (consoleEvents.length > 1000) consoleEvents.shift();
  // (optional) also fan out to the existing SSE bus if you want one stream:
  // pushSSEEvent("console", e);
}
// Call pushConsole(<program>, ...) at milestones, e.g.:
//   pushConsole("validation",  "zerobounce", `ZeroBounce ${priority}`, { email }) in runValidationsAndUpdateCustomer
//   pushConsole("inspections", status,        `RO #${roNum}`,           { repairOrderId }) in handleCompletedRepairOrder
//   pushConsole("winback",     "sms",         `reminder → ${name}`,     { jobId }) in processDailyReminders
//   pushConsole("maintenance", `stage:${stage.key}`, name,             { reminderId }) in processMaintenanceReminders
//   pushConsole("next-service","created",     `${rule.service} ${dueDate}`, { ro }) in processNextServiceAppointments
//   pushConsole("email-audit", "removed",     `${removed} bad emails`,  {}) in runMonthlyEmailAudit
//   pushConsole("engagement",  ev.event,      email,                    { url }) in /webhooks/sendgrid-events
//   pushConsole("sms-inbox",   message.dir,   message.text.slice(0,40), { phone }) alongside saveSMSMessage()
//   pushConsole("transcripts", "sync",        `synced ${n} calls`,      {}) in runNightlySync()

const CONSOLE_MANIFEST = {
  id: "gcd-webhook",
  name: "GCD Automation",
  tagline: "Webhooks, validation, compliance, win-back, transcripts & SMS",
  description: "A fleet of Tekmetric-driven automations plus the call-transcript DB and two-way SMS inbox.",
  theme: { palette: ["#1a1a2e", "#e94560", "#0f3460"], style: "control-room terminal", icon: "🛠️" },
  // Each program is a view; the hub decides which become top-level tiles vs sub-views.
  programs: [
    { id: "transcripts",  name: "Call Transcripts",   icon: "📞", externalUrl: "/api/admin/transcripts" },
    { id: "sms-inbox",    name: "SMS Inbox",          icon: "💬", externalUrl: "/admin/sms" },
    { id: "winback",      name: "Declined-Job Win-Back", icon: "🎯" },
    { id: "maintenance",  name: "DetectAuto Maintenance", icon: "🔧" },
    { id: "validation",   name: "Customer Validation", icon: "✅" },
    { id: "inspections",  name: "DVI Compliance",     icon: "🔎" },
    { id: "email-audit",  name: "Monthly Email Audit", icon: "📧" },
    { id: "next-service", name: "Next-Service Scheduler", icon: "🗓️" },
    { id: "engagement",   name: "Engagement Tracking", icon: "📈" },
    { id: "marketing-bonus", name: "Marketing Bonus", icon: "💰" },
  ],
  endpoints: { state: "/console/state", stream: "/console/stream" },
};
function cors(res){ res.setHeader("access-control-allow-origin","*"); res.setHeader("access-control-allow-headers","content-type,x-console-token"); }

app.get("/console/manifest", (req,res)=>{ cors(res); res.json(CONSOLE_MANIFEST); });

app.get("/console/state", async (req,res)=>{
  cors(res);
  const jobs        = await loadDeclinedJobs();
  const maint       = await loadMaintenanceReminders();
  const inspections = await loadCompletedInspections();
  const inbox       = (await redisGet(SMS_INBOX_KEY)) || {};
  const j = Object.values(jobs);
  res.json({
    id: "gcd-webhook",
    programs: {
      winback:      { total: j.length, remindersSent: j.filter(x=>x.reminderSent).length, pending: j.filter(x=>!x.reminderSent).length },
      maintenance:  { tracked: Object.keys(maint).length },
      inspections:  { tracked: Object.keys(inspections).length },
      "sms-inbox":  { threads: Object.keys(inbox).length, unread: Object.values(inbox).reduce((s,c)=>s+(c.unread||0),0) },
      transcripts:  { authorized: isAuthorized() },
      // add next-service / engagement counts as desired
    },
    remindersPaused: REMINDERS_PAUSED,
    recentEvents: consoleEvents.slice(-30),
  });
});

app.get("/console/stream", (req,res)=>{
  res.writeHead(200,{ "content-type":"text/event-stream","cache-control":"no-cache",connection:"keep-alive","access-control-allow-origin":"*" });
  let cursor = Number(req.query.since||0)||0;
  const program = req.query.program || null; // optional filter for a single view
  const tick = ()=>{ for (const e of consoleEvents.filter(e=>e.id>cursor && (!program||e.program===program))) {
      res.write(`id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`); cursor=e.id; }
    res.write(": ping\n\n"); };
  tick(); const iv = setInterval(tick, 1500);
  req.on("close", ()=>clearInterval(iv));
});
```
Notes:
- The hub's BFF can request `/console/stream?program=winback` to feed a single sub-view, or the whole stream and split client-side by `program`.
- **Call Transcripts** and **SMS Inbox** already have polished admin UIs (`/api/admin/transcripts`, `/admin/sms`) guarded by `ADMIN_SECRET` — for v1 the hub can link out to them (like the Attribution dashboard) and/or render retro live summaries from `/console/state`.
- File-fallback state is non-durable on Render; all real counts come from **Upstash Redis** (the server's preferred backend) — make sure the BFF reads a deployment that has Redis configured.

---

## 4. Repo structure (the hub)

```
gcd-arcade/
├── apps/
│   ├── web/                      # React + Vite + TS — the XMB front-end
│   │   ├── src/
│   │   │   ├── shell/            # XMB ribbon, navigation, boot animation, CRT/sound layers
│   │   │   ├── views/            # one folder per tile's themed live view
│   │   │   │   ├── agents/       # GCD-SOCIAL (8-bit shop floor)
│   │   │   │   ├── attribution/  # neon trading terminal
│   │   │   │   ├── transcripts/  # call-transcript search (gcd-webhook)
│   │   │   │   ├── sms-inbox/    # two-way SMS messaging (gcd-webhook)
│   │   │   │   ├── automation/   # control-room hub of the remaining gcd-webhook programs
│   │   │   │   └── placeholder/  # "insert coin" for any not-yet-built apps
│   │   │   ├── lib/              # SSE client, BFF client, registry types
│   │   │   ├── theme/            # shared retro primitives (pixel font, palettes, sfx)
│   │   │   └── main.tsx
│   │   └── index.html
│   └── bff/                      # Node + TS aggregator (the only thing that holds app tokens)
│       ├── src/
│       │   ├── registry.ts       # the app registry (base URLs + token env per app)
│       │   ├── proxy.ts          # /api/apps/:id/state, /api/apps/:id/stream (SSE pass-through)
│       │   └── server.ts
│       └── ...
├── packages/
│   └── shared/                   # shared TS types for the /console contract
├── render.yaml                   # static site (web) + web service (bff)
└── README.md
```

### The app registry (`apps/bff/src/registry.ts`)
```ts
export interface AppEntry {
  id: string;
  baseUrl: string;            // from env, e.g. https://gcd-social-api.onrender.com
  consoleToken?: string;      // optional per-app CONSOLE_TOKEN, server-side only
  enabled: boolean;
}
export const REGISTRY: AppEntry[] = [
  { id: "gcd-social",  baseUrl: process.env.GCD_SOCIAL_URL!,  consoleToken: process.env.GCD_SOCIAL_CONSOLE_TOKEN, enabled: true },
  { id: "attribution", baseUrl: process.env.ATTRIBUTION_URL!, consoleToken: process.env.ATTRIBUTION_CONSOLE_TOKEN, enabled: true },
  // One backend, multiple tiles: gcd-webhook's manifest.programs[] yields the
  // Call Transcripts + SMS Inbox top-level tiles and the Automation sub-views.
  { id: "gcd-webhook", baseUrl: process.env.GCD_WEBHOOK_URL!, consoleToken: process.env.GCD_WEBHOOK_CONSOLE_TOKEN, enabled: true },
];
```

### The BFF (backend-for-frontend)
- `GET /api/apps` → merged manifests from every enabled app (`/console/manifest`), for the home-screen ribbon. **Expand `gcd-webhook`'s `manifest.programs[]` into multiple tiles** (Call Transcripts + SMS Inbox as top-level, the rest grouped under Automation) per the recommended layout.
- `GET /api/apps/:id/state` → proxies that app's `/console/state` (adds its token server-side).
- `GET /api/apps/:id/stream` → **SSE pass-through** of that app's `/console/stream` (the BFF holds one upstream connection per active viewer and relays frames).
- The browser only ever talks to the BFF — never directly to the apps. Tokens never reach the client.
- Caches manifests; tolerates a down app (tile shows "offline", not a crash).

---

## 5. The XMB shell (front-end behavior)

- **Boot:** short PlayStation-style intro animation (skippable, shown once per session) → home screen.
- **Home (XMB):** horizontal ribbon of app icons pulled from `GET /api/apps`. Left/right (arrows or A/D or gamepad) moves the selection; the selected icon enlarges and a vertical sub-menu/preview drops beneath it (recent activity from `/console/state`). Enter/down opens the app's view.
- **Tile badges:** each tile shows a tiny live status from `/console/state` (e.g. GCD-SOCIAL "awaiting approval", Attribution "ROAS 3.4×", Automation "3 reminders today"). Disabled apps render a dim "INSERT COIN / Coming soon" tile.
- **App view:** routes to `views/<id>`. Each view opens an SSE connection via `GET /api/apps/:id/stream` and animates events in that app's theme. Back button / Esc returns to the XMB.
- **Global layers:** CRT glow + scanline overlay (toggle), sound (nav blips, open/close, ambient music toggle), a clock, and a settings panel. All prefs in localStorage.
- **TV mode:** a layout that scales cleanly to 1080p and is readable across a room.

### Per-view direction (each its own world)
- **Agents Live View (8-bit shop floor):** the 7 agents as little pixel workers at stations; an event like `agent:start copywriter` lights up the copywriter; `critic:verdict PASS` stamps approval; `brief:published` drives a car off the lot. Use GCD-SOCIAL's real SSE `kind`s.
- **Attribution (neon trading terminal):** tickers for spend/revenue/ROAS/CAC, the 5 BullMQ jobs as pipelines that pulse when `job:active`/`job:completed`, a funnel that fills. "Open full dashboard" button → the existing Next.js app.
- **Automation (control-room):** a wall of consoles, one per `gcd-webhook` program — webhooks arrive as blips; the 10 AM win-back run and the 3-stage DetectAuto maintenance run play as batch animations (SMS/email counters); validation shows ZeroBounce/USPS pass/fail stamps; DVI compliance flashes red on a missing inspection; the next-service scheduler drops calendar pins; engagement ticks opens/clicks. Drive these off `/console/stream` filtered by `program`.
- **Call Transcripts (📞, its own tile):** a retro "case files" terminal — recent synced calls, a search box hitting the live data, nightly-sync status; "Open full search" links to `/api/admin/transcripts`.
- **SMS Inbox (💬, its own tile):** a pixel messaging terminal showing live threads/unread counts from `/console/state` and new-message blips from the stream; "Open inbox" links to the existing `/admin/sms` UI.
- **Placeholder:** "insert coin" arcade cabinet for any genuinely future app.

---

## 6. Deployment (`render.yaml`)
- **Static site** (`gcd-arcade-web`): build the Vite app, publish `apps/web/dist`. Env: `VITE_BFF_URL`.
- **Web service** (`gcd-arcade-bff`): Node, runs the BFF. Env (all `sync: false`): `GCD_SOCIAL_URL`, `ATTRIBUTION_URL`, `GCD_WEBHOOK_URL`, the optional `*_CONSOLE_TOKEN`s, and `GCD_WEBHOOK_ADMIN_SECRET` (only if you link out to the existing `/admin/sms` and `/api/admin/transcripts` UIs, which require `?secret=`). Private; share the URL only with the team.
- No database needed for the hub (it's stateless; all data is federated live). Add one later only if you want hub-side caching/history.

---

## 7. Build sequence (suggested)
1. Scaffold the monorepo (web + bff + shared types) and `render.yaml`.
2. Build the **shared `/console` TS types** and the **BFF**: registry, `/api/apps`, state proxy, SSE pass-through. Point it at the live GCD-SOCIAL URL and verify you can read its manifest/state/stream.
3. Build the **XMB shell**: ribbon, navigation, boot animation, settings/sound/CRT layers, tile badges from `/console/state`.
4. Build the **Agents Live View** fully against GCD-SOCIAL's real SSE feed (this is the proof the whole pattern works end-to-end).
5. Add the **`/console/*` contract to the Attribution repo and the Webhook repo** (section 3), deploy them, register their URLs in the BFF.
6. Build the **Attribution** and **Automation** views (live summaries first, deepen the animations after).
7. Add the **Call Tracking placeholder** tile.
8. Polish: TV mode, sound design, boot animation, transitions.

---

## 8. Operating rules / guardrails
- **Never modify the underlying apps' business logic.** Only add the read-only `/console/*` endpoints (and, for the webhook server, the in-memory event ring buffer). Telemetry is fire-and-forget and must not affect their real work.
- **No secrets in the front-end or in any `/console` payload.** App tokens live only in the BFF's env. Token *health* is fine to show; token *values* never.
- **Each app stays independently deployable.** The hub depends on them; they must not depend on the hub.
- **Fail soft:** a down or slow app must degrade to an "offline" tile, never crash the shell.
- **Commit/push on a feature branch; don't push to main without explicit approval; do not open PRs unless asked.**

---

## 9. Context you'll want open in the new session
- This repo (`gcd-arcade`), plus read access to `caposhi/gcd-agents`, `german-car-depot-attribution`, `gcd-webhook`.
- GCD-SOCIAL's live console contract is the reference: `https://gcd-social-api.onrender.com/console/manifest` (and `/console/state`).
- The existing 8-bit "shop floor" dashboard artifact is the visual seed for the Agents view and the overall retro tone.
- GCD brand palette: navy `#182848`, royal `#18479F`, lemondrop `#F8E000`.

> Start by confirming the repo scaffold + BFF reading GCD-SOCIAL's live feed, then build outward per the sequence above.
