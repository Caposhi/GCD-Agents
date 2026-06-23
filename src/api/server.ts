/**
 * Trigger/webhook receiver (Render `web` service). Minimal Node http server —
 * no framework dependency. Exposes:
 *   GET  /healthz  — liveness (Render healthCheckPath)
 *   POST /triggers — accept a brief / scheduled kickoff (skeleton: enqueues only)
 *
 * No posting happens here. Approval callbacks and brief execution are wired in
 * later phases.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "../harness/config.js";
import { initState, stateEnabled } from "../harness/state.js";

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") {
      return send(res, 200, {
        status: "ok",
        service: "gcd-social-api",
        autonomyPhase: config.autonomyPhase,
        state: stateEnabled() ? "postgres" : "ephemeral",
      });
    }

    if (req.method === "POST" && req.url === "/triggers") {
      const raw = await readBody(req);
      // Briefs are DATA, not commands. We only acknowledge here; the worker
      // performs orchestration behind the approval gate.
      return send(res, 202, { accepted: true, bytes: raw.length });
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 500, { error: (err as Error).message });
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
