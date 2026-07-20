/**
 * Trigger/webhook receiver (Render `web` service). Minimal Node http server.
 *   GET  /healthz                 — liveness (Render healthCheckPath)
 *   GET  /diag/ig                 — read-only IG/FB credential diagnostic (no posting)
 *   POST /triggers                — accept a brief; enqueue for the worker
 *   GET  /approvals/:id?token=     — human review page (shows package + buttons)
 *   POST /approvals/:id/decision   — record approve/reject (token-guarded)
 *
 * The web service never publishes; it only queues briefs and records the human
 * decision. The worker runs the orchestration and (on approval) the posting.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "../harness/config.js";
import { initState, stateEnabled, enqueueBrief, getApproval, decideApproval, getMedia, recentEvents, consoleSnapshot } from "../harness/state.js";
import { credsFromEnv } from "../harness/creds.js";
import { igTokenStatus, effectiveIgToken } from "../harness/igToken.js";
import { getGoogleAccessToken, googleOAuthConfigured } from "../harness/googleToken.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- console contract (consumed by the gcd-arcade hub) ----

/** Static description of this app for the hub launcher / home screen. */
const CONSOLE_MANIFEST = {
  id: "gcd-social",
  name: "GCD-SOCIAL",
  tagline: "Autonomous social posting — Instagram + Facebook",
  description:
    "A multi-agent manager that drafts, illustrates, fact-checks, and (on human approval) publishes daily posts for German Car Depot.",
  theme: { palette: ["#182848", "#18479F", "#F8E000"], style: "8-bit shop floor", icon: "🔧" },
  agents: ["analytics", "copywriter", "image", "hashtag-seo-timing", "brand-compliance-critic", "platform-formatter", "posting"],
  endpoints: { state: "/console/state", stream: "/console/stream" },
};

/** Read-only telemetry is open by default; lock it by setting CONSOLE_TOKEN. */
function consoleAuthed(url: URL, req: IncomingMessage): boolean {
  const need = process.env.CONSOLE_TOKEN;
  if (!need) return true;
  const got = url.searchParams.get("key") ?? req.headers["x-console-token"];
  return got === need;
}
function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-console-token");
}
function sseFrame(e: { id: number; kind: string }): string {
  return `id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** Server-Sent Events feed of live activity for the "live game view". */
async function streamConsole(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  let cursor = Number(url.searchParams.get("since") ?? 0) || 0;
  let open = true;
  req.on("close", () => {
    open = false;
  });
  // Backlog so a freshly-opened view isn't blank, then tail new events.
  for (let first = true; open; first = false) {
    if (!first) await sleep(1500);
    let batch: Awaited<ReturnType<typeof recentEvents>> = [];
    try {
      batch = await recentEvents({ sinceId: cursor, limit: first ? 50 : 100 });
    } catch {
      batch = [];
    }
    for (const e of batch) {
      res.write(sseFrame(e));
      cursor = e.id;
    }
    res.write(": ping\n\n"); // heartbeat keeps proxies from closing the stream
  }
  res.end();
}

/** Mask a secret to "set (…1234)" so diagnostics can confirm presence without leaking. */
function maskPresence(v: string | undefined): string {
  if (!v) return "MISSING";
  return `set (…${v.slice(-4)})`;
}

/** GET a Graph endpoint with a bearer token; never throws — returns parsed body or the error. */
async function graphGet(urlStr: string, token: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(urlStr, { headers: { authorization: `Bearer ${token}` } });
    const text = await res.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: (err as Error).message };
  }
}

/**
 * Read-only Instagram/Facebook credential diagnostic. Confirms — without running a
 * brief or posting anything — whether the configured IG token + host + user-id are
 * valid (the exact auth context ig:createContainer uses) and whether the Page has a
 * linked IG Business account (the Facebook-Login path). Echoes Meta's own error so
 * code 190 etc. is visible. Never returns token values.
 */
async function diagIg(): Promise<unknown> {
  const c = credsFromEnv();
  const ver = c.graphVersion ?? "v25.0";
  const igHost = c.igGraphHost ?? "graph.instagram.com";
  const out: Record<string, unknown> = {
    env: {
      IG_USER_ID: c.igUserId ?? "MISSING",
      IG_ACCESS_TOKEN: maskPresence(c.igAccessToken),
      IG_GRAPH_HOST: igHost,
      FB_PAGE_ID: c.fbPageId ?? "MISSING",
      FB_PAGE_ACCESS_TOKEN: maskPresence(c.fbPageAccessToken),
      GRAPH_VERSION: ver,
    },
  };

  // 1) Does the LIVE token (DB store first, env fallback) resolve? This tests the
  // exact token the worker publishes with — so a green check means posting is green,
  // regardless of whether the static env seed has drifted from the refreshed token.
  const live = await effectiveIgToken();
  out.igTokenSource = live.source; // "db-store" once the worker has seeded; "env" before then
  if (live.token && c.igUserId) {
    out.igTokenCheck = await graphGet(
      `https://${igHost}/${ver}/${encodeURIComponent(c.igUserId)}?fields=id,username,account_type`,
      live.token,
    );
  } else {
    out.igTokenCheck = { skipped: "need a live IG token (env seed or DB store) and IG_USER_ID" };
  }

  // 2) Is an IG Business account linked to the Page? (Facebook-Login path readiness.)
  if (c.fbPageAccessToken && c.fbPageId) {
    out.pageLinkCheck = await graphGet(
      `https://graph.facebook.com/${ver}/${encodeURIComponent(c.fbPageId)}?fields=instagram_business_account{id,username}`,
      c.fbPageAccessToken,
    );
  } else {
    out.pageLinkCheck = { skipped: "need FB_PAGE_ACCESS_TOKEN and FB_PAGE_ID" };
  }

  // 3) Auto-refresh state (Instagram-Login path only).
  out.igTokenStore = await igTokenStatus(Date.now());

  return out;
}

/**
 * Read-only Google Business Profile diagnostic. Confirms the Google token,
 * lists the accessible accounts + locations (so you can copy the exact
 * GBP_ACCOUNT_ID / GBP_LOCATION_ID), and never returns the token value.
 */
async function diagGbp(): Promise<unknown> {
  const out: Record<string, unknown> = {
    env: {
      GBP_ACCOUNT_ID: process.env.GBP_ACCOUNT_ID ?? "MISSING",
      GBP_LOCATION_ID: process.env.GBP_LOCATION_ID ?? "MISSING",
      googleAuth: googleOAuthConfigured()
        ? "refresh-token configured (self-renewing)"
        : process.env.GOOGLE_ACCESS_TOKEN
          ? "static GOOGLE_ACCESS_TOKEN only (expires hourly)"
          : "MISSING",
      ACTIVE_PLATFORMS: config.activePlatforms.join(","),
    },
  };

  let token: string | undefined;
  try {
    token = await getGoogleAccessToken();
  } catch (err) {
    out.tokenError = (err as Error).message;
    return out;
  }
  if (!token) {
    out.tokenError = "no Google token — set GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID/SECRET (preferred) or GOOGLE_ACCESS_TOKEN";
    return out;
  }

  // Accounts (My Business Account Management API v1)
  out.accounts = await graphGet("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token);

  // Locations for the chosen account (env first, else the first account returned)
  let acctId = process.env.GBP_ACCOUNT_ID;
  const firstName = (out.accounts as any)?.body?.accounts?.[0]?.name; // "accounts/123"
  if (!acctId && typeof firstName === "string") acctId = firstName.split("/")[1];
  if (acctId) {
    out.locations = await graphGet(
      `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${encodeURIComponent(acctId)}/locations?readMask=name,title,storefrontAddress`,
      token,
    );
    out.suggested = {
      GBP_ACCOUNT_ID: acctId,
      note: "GBP_LOCATION_ID = the number after 'locations/' in locations[].name",
    };
  }
  return out;
}

/**
 * Mobile-first approval page: a mock social post — chosen image on top, an
 * Instagram-style caption below (with FB/Google captions a tap away), the
 * QC-rejected candidates in a collapsible section, and Approve/Reject buttons.
 */
function renderReviewPage(id: string, token: string, pkg: any, summary: string): string {
  const imgUrl = pkg?.image?.url as string | undefined;
  const rejected: Array<{ url: string; issues: string[] }> = Array.isArray(pkg?.image?.rejected) ? pkg.image.rejected : [];
  const platforms: any[] = Array.isArray(pkg?.platforms) ? pkg.platforms : [];
  const label: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", gbp: "Google" };

  const tabs = platforms
    .map((p, i) => `<button type="button" class="tab${i === 0 ? " on" : ""}" data-t="${esc(String(p.platform))}">${esc(label[p.platform] ?? String(p.platform))}</button>`)
    .join("");

  const caps = platforms
    .map((p, i) => {
      const body = esc(String(p.body ?? ""));
      const tags = Array.isArray(p.hashtags) && p.hashtags.length ? `\n\n<span class="tags">${esc(p.hashtags.join(" "))}</span>` : "";
      const when = p.scheduledTime ? `<div class="when">🕗 ${esc(String(p.scheduledTime))}</div>` : "";
      return `<div class="cap${i === 0 ? " on" : ""}" id="cap-${esc(String(p.platform))}"><span class="cap-body"><b>germancardepot</b> ${body}${tags}</span>${when}</div>`;
    })
    .join("");

  const img = imgUrl ? `<img class="photo" src="${esc(imgUrl)}" alt="chosen post image">` : `<div class="noimg">No image</div>`;

  const rej = rejected.length
    ? `<details class="rej"><summary>Other versions the QC rejected (${rejected.length})</summary>
       <p class="rej-note">Auto-generated, failed the legibility check, and NOT chosen:</p>
       <div class="rej-grid">${rejected
         .map((r) => `<figure><img src="${esc(r.url)}" alt="rejected version" loading="lazy"><figcaption>${esc((r.issues || []).join("; ")).slice(0, 240)}</figcaption></figure>`)
         .join("")}</div></details>`
    : "";

  const css = `*{box-sizing:border-box}body{margin:0;background:#0f1420;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:470px;margin:0 auto;padding:16px 12px 40px}
.top{display:flex;gap:10px;align-items:center;color:#fff;margin:6px 4px 14px}
.top .logo{width:34px;height:34px;border-radius:8px;background:#F8E000;color:#182848;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:12px}
.top .t{font-weight:700;font-size:17px}.top .s{font-size:12px;color:#9fb0c9;line-height:1.35;margin-top:2px}
.card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.head{display:flex;align-items:center;gap:10px;padding:10px 12px}
.avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#18479F,#182848);color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center}
.who b{font-size:14px;display:block;line-height:1.1}.who span{font-size:11px;color:#666}
.photo{display:block;width:100%;height:auto}.noimg{padding:60px;text-align:center;color:#999;background:#f2f2f2}
.bar{display:flex;gap:16px;padding:10px 12px 2px;font-size:20px}.bar .save{margin-left:auto}
.tabs{display:flex;gap:6px;padding:8px 12px 0}
.tab{border:0;background:#f0f2f5;color:#333;font-size:12px;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer}
.tab.on{background:#182848;color:#fff}
.cap{display:none;padding:10px 14px 16px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}
.cap.on{display:block}.cap b{margin-right:3px}.cap .tags{color:#18479F}
.cap .when{margin-top:10px;font-size:12px;color:#888;white-space:normal}
.rej{margin:14px 2px 0;background:#151b28;border:1px solid #263149;border-radius:12px;color:#c8d3e6;padding:2px 12px}
.rej summary{cursor:pointer;padding:11px 0;font-weight:600;font-size:14px}
.rej-note{font-size:12px;color:#8ea3c2;margin:0 0 8px}
.rej-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-bottom:12px}
.rej figure{margin:0}.rej img{width:100%;border-radius:8px;display:block;opacity:.8}
.rej figcaption{font-size:10px;color:#94a3bd;line-height:1.35;margin-top:4px}
.btns{display:flex;flex-direction:column;gap:10px;margin-top:18px}.btns form{margin:0}
.btns button{width:100%;border:0;border-radius:12px;padding:16px;font-size:16px;font-weight:700;cursor:pointer}
.approve{background:#18479F;color:#fff}.reject{background:transparent;color:#ff8080;border:1px solid #7a2a2a}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>GCD-SOCIAL — Review post</title><style>${css}</style></head>
<body><div class="wrap">
  <header class="top"><div class="logo">GCD</div><div><div class="t">Review post</div><div class="s">${esc(summary || "Approve to publish to the active platforms.")}</div></div></header>
  <div class="card">
    <div class="head"><div class="avatar">GCD</div><div class="who"><b>germancardepot</b><span>Hollywood, FL</span></div></div>
    ${img}
    <div class="bar"><span>♥</span><span>💬</span><span>➤</span><span class="save">🔖</span></div>
    <div class="tabs">${tabs}</div>
    ${caps}
  </div>
  ${rej}
  <div class="btns">
    <form method="POST" action="/approvals/${esc(id)}/decision"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="approve"><button class="approve">Approve &amp; publish</button></form>
    <form method="POST" action="/approvals/${esc(id)}/decision"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="action" value="reject"><button class="reject">Reject</button></form>
  </div>
</div>
<script>
document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){
  document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('on')});
  document.querySelectorAll('.cap').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');var el=document.getElementById('cap-'+b.dataset.t);if(el)el.classList.add('on');
});});
</script></body></html>`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/healthz") {
      return json(res, 200, {
        status: "ok",
        service: "gcd-social-api",
        autonomyPhase: config.autonomyPhase,
        state: stateEnabled() ? "postgres" : "ephemeral",
      });
    }

    // Read-only credential diagnostic for the Instagram/Facebook auth setup.
    if (req.method === "GET" && path === "/diag/ig") {
      return json(res, 200, await diagIg());
    }

    // Read-only Google Business Profile diagnostic (lists accounts + locations).
    if (req.method === "GET" && path === "/diag/gbp") {
      return json(res, 200, await diagGbp());
    }

    // ---- console contract (hub launcher + live game view) ----
    if (path.startsWith("/console/")) {
      cors(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      if (!consoleAuthed(url, req)) return json(res, 401, { error: "console token required" });

      if (req.method === "GET" && path === "/console/manifest") {
        return json(res, 200, CONSOLE_MANIFEST);
      }
      if (req.method === "GET" && path === "/console/state") {
        const snap = await consoleSnapshot();
        return json(res, 200, {
          id: "gcd-social",
          autonomyPhase: config.autonomyPhase,
          activePlatforms: config.activePlatforms,
          state: stateEnabled() ? "postgres" : "ephemeral",
          igToken: await igTokenStatus(Date.now()),
          ...snap,
          recentEvents: await recentEvents({ limit: 20 }),
        });
      }
      if (req.method === "GET" && path === "/console/stream") {
        return streamConsole(req, res, url);
      }
      return json(res, 404, { error: "unknown console endpoint" });
    }

    // Hosted media: serve transcoded JPEGs to the social platforms.
    const media = path.match(/^\/media\/([^/.]+)(?:\.[a-z0-9]+)?$/i);
    if (req.method === "GET" && media) {
      const m = await getMedia(media[1]!);
      if (!m) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": m.mime, "cache-control": "public, max-age=31536000" });
      res.end(m.bytes);
      return;
    }

    if (req.method === "POST" && path === "/triggers") {
      const raw = await readBody(req);
      let brief: unknown;
      try {
        brief = raw ? JSON.parse(raw) : {};
      } catch {
        return json(res, 400, { error: "invalid JSON" });
      }
      if (!brief || typeof (brief as any).goal !== "string") {
        return json(res, 400, { error: "brief.goal (string) is required" });
      }
      const id = await enqueueBrief(brief);
      return json(res, 202, { accepted: true, briefId: id });
    }

    // /approvals/:id  and  /approvals/:id/decision
    const m = path.match(/^\/approvals\/([^/]+)(\/decision)?$/);
    if (m) {
      const id = m[1]!;
      const isDecision = !!m[2];
      const row = await getApproval(id);
      if (!row) return html(res, 404, "<h2>Not found</h2>");

      if (req.method === "GET" && !isDecision) {
        const token = url.searchParams.get("token") ?? "";
        if (token !== row.token) return html(res, 403, "<h2>Invalid or missing token</h2>");
        if (row.status !== "pending") return html(res, 200, `<h2>Already ${esc(row.status)}</h2>`);
        return html(res, 200, renderReviewPage(id, token, row.packageFormatted, row.summary));
      }

      if (req.method === "POST" && isDecision) {
        const body = await readBody(req);
        const params = new URLSearchParams(body);
        const token = params.get("token") ?? "";
        const action = params.get("action");
        if (action !== "approve" && action !== "reject") return html(res, 400, "<h2>Bad action</h2>");
        const decision = action === "approve" ? "approved" : "rejected";
        const result = await decideApproval(id, token, decision);
        if (!result.ok) return html(res, 403, `<h2>Could not record decision: ${esc(result.reason ?? "")}</h2>`);
        return html(res, 200, `<h2>Recorded: ${decision}.</h2><p>You can close this window.</p>`);
      }
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    return json(res, 500, { error: (err as Error).message });
  }
});

async function main(): Promise<void> {
  await initState();
  server.listen(config.port, () => {
    console.log(`[api] gcd-social-api listening on :${config.port} (phase ${config.autonomyPhase})`);
  });
}

main().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
