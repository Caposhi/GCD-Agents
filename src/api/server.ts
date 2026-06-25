/**
 * Trigger/webhook receiver (Render `web` service). Minimal Node http server.
 *   GET  /healthz                 — liveness (Render healthCheckPath)
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
