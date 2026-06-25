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
import { initState, stateEnabled, enqueueBrief, getApproval, decideApproval, getMedia } from "../harness/state.js";
import { credsFromEnv } from "../harness/creds.js";

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

  // 1) Does the IG token + host + user-id resolve? This is the createContainer auth context.
  if (c.igAccessToken && c.igUserId) {
    out.igTokenCheck = await graphGet(
      `https://${igHost}/${ver}/${encodeURIComponent(c.igUserId)}?fields=id,username,account_type`,
      c.igAccessToken,
    );
  } else {
    out.igTokenCheck = { skipped: "need IG_ACCESS_TOKEN and IG_USER_ID" };
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

  return out;
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
        const pkg = esc(JSON.stringify(row.packageFormatted, null, 2)).slice(0, 8000);
        return html(
          res,
          200,
          `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
          <body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem">
          <h2>GCD-SOCIAL — Approve post</h2>
          <p>${esc(row.summary)}</p>
          <pre style="background:#f4f4f4;padding:1rem;overflow:auto;border-radius:8px">${pkg}</pre>
          <form method="POST" action="/approvals/${esc(id)}/decision" style="display:inline">
            <input type="hidden" name="token" value="${esc(token)}">
            <input type="hidden" name="action" value="approve">
            <button style="background:#18479F;color:#fff;border:0;padding:.8rem 1.4rem;border-radius:8px;font-size:1rem">Approve &amp; publish</button>
          </form>
          <form method="POST" action="/approvals/${esc(id)}/decision" style="display:inline;margin-left:1rem">
            <input type="hidden" name="token" value="${esc(token)}">
            <input type="hidden" name="action" value="reject">
            <button style="background:#fff;color:#b00;border:1px solid #b00;padding:.8rem 1.4rem;border-radius:8px;font-size:1rem">Reject</button>
          </form></body>`,
        );
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
