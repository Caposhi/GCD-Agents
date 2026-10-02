/**
 * `npm run start:studio-web`: the Content Studio web service
 * (docs/CONTENT_STUDIO_DESIGN.md §3.2, §3.3, §7). **Not deployed:** no Render
 * file names it (S8 adds `render.studio.yaml`; `render.yaml` is never changed).
 * It never calls a model and holds no provider key.
 *
 * The environment is decided FIRST, by `startup.ts`, before any connection is
 * opened and before the server module loads. It reads: the names of every
 * variable present (for the refusal), `STUDIO_DATABASE_URL`,
 * `STUDIO_PUBLIC_ORIGIN`, `STUDIO_ALLOWED_HD`, `STUDIO_GOOGLE_CLIENT_ID`,
 * `STUDIO_GOOGLE_CLIENT_SECRET`, `STUDIO_BOOTSTRAP_OWNER_EMAIL`, `PORT` and
 * Render's `RENDER_GIT_COMMIT`. It never reads `DATABASE_URL`'s value.
 *
 * It passes no OpenID provider: the service always uses Google's endpoints
 * and issuers, which are code constants (`oidc.ts`).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decideWebStartup, WebStartupRefusal } from "./startup.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** One structured line: ids, states, classes and counts only, never content (design §9.2). */
function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`[studio-web] ${event} ${JSON.stringify(fields)}`);
}

async function main(): Promise<void> {
  const startup = decideWebStartup({
    names: Object.keys(process.env),
    studioDatabaseUrl: process.env.STUDIO_DATABASE_URL,
    publicOrigin: process.env.STUDIO_PUBLIC_ORIGIN,
    allowedHd: process.env.STUDIO_ALLOWED_HD,
    googleClientId: process.env.STUDIO_GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.STUDIO_GOOGLE_CLIENT_SECRET,
    bootstrapOwnerEmail: process.env.STUDIO_BOOTSTRAP_OWNER_EMAIL,
    port: process.env.PORT,
    commit: process.env.RENDER_GIT_COMMIT,
  });
  const { startStudioWeb } = await import("./server.js");
  const web = await startStudioWeb(startup, { repoRoot: REPO_ROOT, log });
  const shutdown = () => { log("stopping", { reason: "signal" }); void web.stop().then(() => log("stopped", {})); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error: unknown) => {
  // The reason and message only: never an error object, which could carry connection details.
  const reason = (error as { reason?: unknown })?.reason;
  if (error instanceof WebStartupRefusal || typeof reason === "string") {
    console.error(`[studio-web] refused (${String(reason)}): ${(error as Error).message}`);
  } else {
    console.error(`[studio-web] fatal (${(error as Error)?.name ?? "Error"})`);
  }
  process.exit(1);
});
