#!/usr/bin/env node
/**
 * Content Studio S8.4 — the browser form-POST check.
 *
 * The defect it guards (owner-observed in production on 2026-10-12, POST
 * /settings/caps): every page carried `Referrer-Policy: no-referrer`. Under the
 * Fetch standard a browser's form POST (a navigate-mode request) then carries
 * `Origin: null`, and the exact-Origin check (`originAllowed`, which refuses
 * "null" and a missing Origin by design) refused EVERY browser POST with 403
 * before its handler ran. The offline suite could not see it: its requests set
 * the Origin header themselves. Only a real browser decides what Origin a form
 * submission carries, so this check uses one.
 *
 * LOCAL ONLY; not part of CI (the M1 readiness runner pins CI's exact job sets;
 * an accepted limitation recorded in docs/TESTING.md). It needs a build
 * (`npm run build`) and a Chromium binary: the preinstalled one at
 * /opt/pw-browsers/chromium by default, or `CHROMIUM=/path/to/chrome`.
 *
 * What it does, with NO dependency beyond Node 22 itself (the same approach as
 * scripts/local/studio-layout-check.mjs):
 *  - serves the compiled web app on 127.0.0.1:0 over the test-only memory store
 *    (`dist/studio/web/testSupport.js`), signed in as a synthetic owner, with
 *    the app's public origin set to the server's own origin, so the exact-Origin
 *    check is the production one, unchanged;
 *  - serves a CONTROL copy of the same app on a second port whose responses have
 *    only their Referrer-Policy rewritten to `no-referrer` (the pre-S8.4 value),
 *    so the check proves it can tell the two apart;
 *  - launches Chromium headless over the DevTools protocol with Node's built-in
 *    WebSocket, with the session cookie in Chromium's own cookie jar (the app's
 *    attributes, SameSite=Lax), opens the real caps-and-settings page on each,
 *    fills the caps form and clicks its real "Save caps" button;
 *  - asserts, as the server received it and as Chromium reported sending it,
 *    that the app's own form POST carries the page's own origin, is NOT refused
 *    by the Origin check (303 to /settings, no `csrf.refused` log), and that its
 *    handler ran (the caps are stored and audited); and that the control's
 *    POST carries `Origin: null` and is refused (403, `csrf.refused`, nothing
 *    stored) — the production defect, reproduced.
 *
 * Run: npm run build && node scripts/local/studio-form-post-check.mjs
 * Exit 0 when every assertion holds, 1 otherwise. Makes no network request
 * beyond loopback; writes nothing outside a temporary profile directory, which
 * it removes.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = (path) => import(pathToFileURL(resolve(REPO_ROOT, "dist", path)).href);
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";

const { createStudioWebApp, SECURITY_HEADERS } = await dist("studio/web/app.js");
const { MemoryWebStore, syntheticEmail } = await dist("studio/web/testSupport.js");
const { csrfTokenFor, csrfTokenHash, newSessionTimes, randomToken, SESSION_COOKIE, sessionIdHash } = await dist("studio/web/sessions.js");

// --- The fixture apps -----------------------------------------------------------------------------------

const store = new MemoryWebStore(() => Date.now());
const owner = store.insertUser({ email: syntheticEmail("owner"), role: "owner", google_sub: `sub-${randomBytes(4).toString("hex")}`,
  display_name: "Synthetic Owner" });
const cookie = randomToken();
await store.createSession({ idHash: sessionIdHash(cookie), userId: owner.id, csrfHash: csrfTokenHash(csrfTokenFor(cookie)),
  ...newSessionTimes(Date.now()) });

/** One server: the app with its public origin set to the server's own; `control` rewrites only Referrer-Policy. */
async function serve(name, control) {
  const logs = [];
  const posts = [];
  let app;
  const server = createServer((req, res) => {
    if (control) {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = (header, value) => setHeader(header, String(header).toLowerCase() === "referrer-policy" ? "no-referrer" : value);
    }
    if (req.method === "POST") {
      const seen = { path: req.url, origin: req.headers.origin ?? "(missing)", status: null };
      posts.push(seen);
      res.once("finish", () => { seen.status = res.statusCode; });
    }
    void app.handle(req, res);
  });
  await new Promise((settle) => server.listen(0, "127.0.0.1", settle));
  const base = `http://127.0.0.1:${server.address().port}`;
  app = createStudioWebApp({
    store, commit: "0".repeat(40), log: (event, detail) => logs.push({ event, ...detail }),
    config: { publicOrigin: base, allowedHd: "germancardepot.com", clientId: "form-post.apps.test", clientSecret: "form-post-secret",
      bootstrapOwnerEmail: null, ceilings: { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 } },
  });
  return { name, server, base, logs, posts };
}
const fixed = await serve("app", false);
const control = await serve("control (Referrer-Policy rewritten to no-referrer)", true);

// --- Chromium over the DevTools protocol ----------------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), "gcd-studio-form-post-"));
const browser = spawn(CHROMIUM, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"], detached: true });
const wsUrl = await new Promise((settle, fail) => {
  let text = "";
  const timer = setTimeout(() => fail(new Error("Chromium did not report its DevTools endpoint")), 30_000);
  browser.stderr.on("data", (chunk) => {
    text += chunk;
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
    if (match) { clearTimeout(timer); settle(match[1]); }
  });
  browser.once("exit", (code) => fail(new Error(`Chromium exited (${code})`)));
});

const socket = new WebSocket(wsUrl);
await new Promise((settle, fail) => { socket.onopen = settle; socket.onerror = () => fail(new Error("DevTools socket error")); });
let nextId = 0;
const pending = new Map();
const listeners = [];
socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id !== undefined && pending.has(message.id)) {
    const { settle, fail } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) fail(new Error(`${message.error.message}`)); else settle(message.result);
  } else {
    for (const listener of listeners) listener(message);
  }
};
const send = (method, params = {}, sessionId) => new Promise((settle, fail) => {
  const id = ++nextId;
  pending.set(id, { settle, fail });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const cdp = (method, params) => send(method, params, sessionId);

// What Chromium itself reports: each request's method and URL, the headers it actually sent, and each response's
// Referrer-Policy header.
// A redirect reuses its request's id, so each hop is its own record; the wire headers (ExtraInfo) arrive in hop order
// and join the earliest hop of that id still without them.
const requests = [];
const responses = [];
listeners.push((message) => {
  if (message.sessionId !== sessionId) return;
  const p = message.params;
  if (message.method === "Network.requestWillBeSent") {
    requests.push({ id: p.requestId, method: p.request.method, url: p.request.url, headers: { ...p.request.headers }, wire: false });
  }
  if (message.method === "Network.requestWillBeSentExtraInfo") {
    const hop = requests.find((r) => r.id === p.requestId && !r.wire);
    if (hop) { hop.wire = true; Object.assign(hop.headers, p.headers); }
  }
  if (message.method === "Network.responseReceived") {
    const headers = Object.fromEntries(Object.entries(p.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    responses.push({ url: p.response.url, status: p.response.status, referrerPolicy: headers["referrer-policy"] ?? "(none)" });
  }
});
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");
// The session cookie goes into Chromium's own cookie jar with the app's attributes (Path=/; Secure; HttpOnly;
// SameSite=Lax; Chromium treats 127.0.0.1 as a secure context), one per origin, as a signed-in browser holds it, so
// the form POST and the 303 that follows carry it the way a real browser sends it. (A DevTools extra header would not
// survive the redirect.)
for (const site of [fixed, control]) {
  const { success } = await cdp("Network.setCookie", { name: SESSION_COOKIE, value: cookie, url: site.base, path: "/",
    secure: true, httpOnly: true, sameSite: "Lax" });
  if (!success) throw new Error(`Chromium refused the session cookie for ${site.base}`);
}

const loadFired = () => new Promise((settle) => {
  const listener = (message) => {
    if (message.sessionId === sessionId && message.method === "Page.loadEventFired") {
      listeners.splice(listeners.indexOf(listener), 1);
      settle();
    }
  };
  listeners.push(listener);
});
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { returnByValue: true, expression })).result.value;

/** Opens /settings on `site`, fills the caps form with `daily`/`monthly` and clicks its real submit button. */
async function submitCaps(site, daily, monthly) {
  const opened = loadFired();
  await cdp("Page.navigate", { url: `${site.base}/settings` });
  await opened;
  const pagePolicy = responses.filter((r) => r.url === `${site.base}/settings`).at(-1)?.referrerPolicy;
  const submitted = loadFired();
  const clicked = await evaluate(`(() => {
    const form = document.querySelector('form[action="/settings/caps"]');
    if (!form) return false;
    form.querySelector('[name="daily"]').value = ${JSON.stringify(daily)};
    form.querySelector('[name="monthly"]').value = ${JSON.stringify(monthly)};
    form.querySelector('button[type="submit"]').click();
    return true;
  })()`);
  if (clicked) await submitted;
  const browserPost = requests.filter((r) => r.method === "POST" && r.url === `${site.base}/settings/caps`).at(-1);
  const browserOrigin = browserPost ? (Object.entries(browserPost.headers).find(([k]) => k.toLowerCase() === "origin")?.[1] ?? "(missing)") : undefined;
  return {
    pagePolicy, clicked, browserOrigin,
    serverPost: site.posts.filter((p) => p.path === "/settings/caps").at(-1),
    landedOn: await evaluate("location.pathname"), title: await evaluate("document.title"),
    refused: site.logs.some((l) => l.event === "csrf.refused"),
  };
}

let ok = true;
const assert = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!cond) ok = false;
};
const show = (site, r) => console.log(`${site.name}: page Referrer-Policy ${r.pagePolicy}; Chromium sent Origin ${JSON.stringify(r.browserOrigin)}; `
  + `server received Origin ${JSON.stringify(r.serverPost?.origin)} and answered ${r.serverPost?.status}; landed on ${r.landedOn} `
  + `("${r.title}"); csrf.refused logged: ${r.refused}`);

try {
  console.log(`built SECURITY_HEADERS["referrer-policy"]: ${SECURITY_HEADERS["referrer-policy"]}`);
  const auditBefore = store.auditLog.length;
  const app = await submitCaps(fixed, "40.00", "150.00");
  show(fixed, app);
  assert("app: the settings page's Referrer-Policy is not no-referrer (no-referrer makes a form POST carry Origin: null)",
    app.pagePolicy !== undefined && app.pagePolicy !== "no-referrer", app.pagePolicy);
  assert("app: the caps form was found and its real submit button clicked", app.clicked === true, app);
  assert(`app: Chromium's form POST carried the page's own origin (${fixed.base})`, app.browserOrigin === fixed.base, app.browserOrigin);
  assert("app: the server received that same Origin on POST /settings/caps", app.serverPost?.origin === fixed.base, app.serverPost);
  assert("app: the POST was not refused by the Origin check (no 403, no csrf.refused) and the handler answered 303 to /settings",
    app.serverPost?.status === 303 && !app.refused && app.landedOn === "/settings" && app.title.startsWith("Caps and settings"),
    { post: app.serverPost, refused: app.refused, at: app.landedOn, title: app.title });
  assert("app: the handler ran — the caps are stored ($40.00 / $150.00) and audited once (settings.update)",
    store.settings?.dailyCapMicros === 40_000_000 && store.settings?.monthlyCapMicros === 150_000_000
      && store.auditLog.length === auditBefore + 1 && store.auditLog.at(-1)?.action === "settings.update",
    { settings: store.settings, audit: store.auditLog.slice(auditBefore).map((a) => a.action) });

  const before = JSON.stringify(store.settings);
  const auditAtControl = store.auditLog.length;
  const ctl = await submitCaps(control, "41.00", "151.00");
  show(control, ctl);
  assert("control: the page's Referrer-Policy is no-referrer, as before S8.4", ctl.pagePolicy === "no-referrer", ctl.pagePolicy);
  assert("control: Chromium's form POST carried Origin: null (the Fetch standard's no-referrer rule)",
    ctl.clicked === true && ctl.browserOrigin === "null" && ctl.serverPost?.origin === "null", { browser: ctl.browserOrigin, server: ctl.serverPost });
  assert("control: the unchanged Origin check refused it (403, csrf.refused) and nothing was written",
    ctl.serverPost?.status === 403 && ctl.refused && JSON.stringify(store.settings) === before && store.auditLog.length === auditAtControl,
    { post: ctl.serverPost, refused: ctl.refused, settings: store.settings });
} finally {
  socket.close();
  // Chromium and every helper process it started (its own process group) are stopped, and the profile is removed
  // only once Chromium has exited, so nothing is still writing to it.
  const exited = browser.exitCode !== null || browser.signalCode !== null ? Promise.resolve() : new Promise((settle) => browser.once("exit", settle));
  try { process.kill(-browser.pid, "SIGKILL"); } catch { browser.kill("SIGKILL"); }
  await exited;
  await new Promise((settle) => setTimeout(settle, 300));
  for (const site of [fixed, control]) await new Promise((settle) => { site.server.closeAllConnections(); site.server.close(() => settle()); });
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(ok ? "\nstudio form-POST check: ALL PASS" : "\nstudio form-POST check: FAILED");
process.exit(ok ? 0 : 1);
