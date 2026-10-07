#!/usr/bin/env node
/**
 * Content Studio S5 — the phone-layout check (docs/CONTENT_STUDIO_DESIGN.md §8,
 * §10's S5 row: "phone-width layout checked in a headless Chromium at 375 px,
 * with no horizontal scroll"), extended in S6.2 to the new-run, quote and
 * spend pages, and in S7.2 to the fact versions, upload, check-result and
 * import pages and an archived import's report.
 *
 * LOCAL ONLY; not part of CI (an accepted limitation recorded in docs/TESTING.md).
 * It needs a build (`npm run build`) and a Chromium binary: the preinstalled one
 * at /opt/pw-browsers/chromium by default, or `CHROMIUM=/path/to/chrome`.
 *
 * What it does, with NO dependency beyond Node 22 itself:
 *  - serves the compiled web app on 127.0.0.1:0 over the test-only memory store
 *    (`dist/studio/web/testSupport.js`), signed in as a synthetic viewer, with a
 *    fixture run whose captions, goal, fingerprints and findings include long
 *    unbroken words and a wide request table;
 *  - launches Chromium headless and drives it over the DevTools protocol with
 *    Node's built-in WebSocket (no Playwright, no Puppeteer), sending the
 *    session cookie as a request header;
 *  - S6.2: signed in as a synthetic owner too, it serves the new-run page, a
 *    quoted full run's page (a breakdown with long model labels), a quoted
 *    revise's page (planRevision's plan for the fixture critic), the spend
 *    panel with an unacknowledged overrun, and the run report with its action
 *    buttons;
 *  - S7.2: as the owner, the fact versions list (long tags, an active and a
 *    retired version), the upload page, an accepted check's page (an over-cap
 *    warning, long unknown field names), the import page, and an archived
 *    import's report (a long reason, recorded files by base name);
 *  - at 375 px (a phone) it asserts, on every one of those pages and on the
 *    runs list and the run report,
 *    that `document.scrollingElement.scrollWidth <= 375` (no horizontal scroll),
 *    that every visible link, button, select and summary is at least 44 px in
 *    both directions, that "Needs your decision" comes before the captions, and
 *    that each Copy button's attribute, as Chromium's own HTML parser reads it,
 *    is exactly the expected text; and at 1024 px that the sections are back in
 *    the design's order;
 *  - fails if the browser reports any Content-Security-Policy violation (an
 *    inline script or style would be one).
 *
 * Run: npm run build && node scripts/local/studio-layout-check.mjs
 * Exit 0 when every assertion holds, 1 otherwise. Makes no network request
 * beyond loopback; writes nothing outside a temporary profile directory, which
 * it removes.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = (path) => import(pathToFileURL(resolve(REPO_ROOT, "dist", path)).href);
const CHROMIUM = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium";
const PHONE = 375;
const DESKTOP = 1024;
const MIN_TAP = 44;

const { createStudioWebApp } = await dist("studio/web/app.js");
const { MemoryWebStore, syntheticEmail, syntheticRunArtifacts } = await dist("studio/web/testSupport.js");
const { csrfTokenFor, csrfTokenHash, newSessionTimes, randomToken, SESSION_COOKIE, sessionIdHash } = await dist("studio/web/sessions.js");
const { providerTextWithContact } = await dist("harness/agents/providerText.js");
const { localDay, preflightRequest } = await dist("studio/web/actions.js");
const { planRevision } = await dist("harness/agents/revision.js");

// --- The fixture app --------------------------------------------------------------------------------

const store = new MemoryWebStore(() => Date.now());
const owner = store.insertUser({ email: syntheticEmail("owner"), role: "owner", google_sub: `sub-${randomBytes(4).toString("hex")}`,
  display_name: "Synthetic Owner" });
const viewer = store.insertUser({ email: syntheticEmail("viewer"), role: "viewer", created_by: owner.id,
  display_name: "Synthetic viewer with a fairly long display name" });
const cookie = randomToken();
await store.createSession({ idHash: sessionIdHash(cookie), userId: viewer.id, csrfHash: csrfTokenHash(csrfTokenFor(cookie)),
  ...newSessionTimes(Date.now()) });

const LONG = `Unbroken${"x".repeat(240)}`;
const run = store.addRun(owner, {
  goal: `A deliberately long goal for the layout check: ${LONG} — brake fluid service explained plainly for drivers`,
  platforms: ["instagram", "facebook", "google_business_profile"], scope_tags: ["brakes", LONG.slice(0, 80)],
  approved_facts_sha256: createHash("sha256").update("a").digest("hex"), automotive_facts_sha256: createHash("sha256").update("b").digest("hex"),
  evidence_pack_sha256: createHash("sha256").update("c").digest("hex"), code_commit: "c".repeat(40), runner: "live",
  reserved_usd: "21.650000", actual_usd: "1.234567", verdict: "needs_revision", blocking_findings: 1, advisory_findings: 1,
  fact_version_id: crypto.randomUUID(),
});
const files = syntheticRunArtifacts(`${LONG} `);
for (const [name, text] of Object.entries(files)) store.addArtifact(run.id, name, text);
store.findings.set(run.id, [
  { idx: 0, lens: "voice-and-craft", severity: "blocking", category: "voice_clarity", owner: "packaging-adaptation", issue: `Issue ${LONG}`, owner_item: false },
  { idx: 1, lens: "production-coherence", severity: "advisory", category: "human_decision", owner: "human_review", issue: `Decide ${LONG}`, owner_item: true },
]);
store.requests.set(run.id, ["strategy-concept", "automotive-truth", "hook-story-script", "production-direction", "packaging-adaptation"]
  .map((stage, i) => ({ seq: i + 1, stage, lens: null, model: "claude-model-with-a-long-identifier-for-the-table", ceiling_usd: "4.330000",
    input_tokens: 123456, output_tokens: 65432, cost_usd: "0.987654", charged_usd: "0.987654", outcome: "succeeded" })));
for (let i = 0; i < 6; i += 1) store.addRun(owner, { goal: `Fixture run ${i} ${LONG}`, state: i === 0 ? "running" : "succeeded" });

const pkgs = JSON.parse(files["05-packaging-adaptation.json"]).output.provisional.packages;
const contacts = JSON.parse(files["05b-contact-lines.json"]).packages;
const expectedCopies = pkgs.flatMap((p, i) => (p.platform === "google_business_profile" ? [p.caption]
  : [providerTextWithContact(p.caption, p.hashtags, contacts[i].contact), p.caption]));

// S6.2: the owner's session, a fact version, a fresh heartbeat, two quoted price requests and a spend ledger.
const ownerCookie = randomToken();
await store.createSession({ idHash: sessionIdHash(ownerCookie), userId: owner.id, csrfHash: csrfTokenHash(csrfTokenFor(ownerCookie)),
  ...newSessionTimes(Date.now()) });
const factVersion = store.addFactVersion({ brakes: 3, [LONG.slice(0, 80)]: 2, "synthetic-tag-with-a-long-name-for-the-list": 1 });
store.heartbeat = { commit: "0".repeat(40), approvedFactsSha256: "a".repeat(64), priceTableSha256: "b".repeat(64),
  tagCounts: { brakes: 1 }, beatAtMs: Date.now() };
const LONG_MODEL = "synthetic-model-with-a-long-identifier-for-the-breakdown-table";
const breakdown = [
  ...["strategy-concept", "automotive-truth", "hook-story-script", "production-direction", "packaging-adaptation"].map((stage) => ({
    item: stage, unit: "request", ceilingUsd: "0.640000", lines: [{ label: stage, model: LONG_MODEL, maxTokens: 64000, costUsd: 0.64 }] })),
  { item: "final-critic", unit: "critic-panel", ceilingUsd: "18.450000", lines: ["evidence-fidelity", "platform-and-local", "voice-and-craft",
    "production-coherence"].map((lens) => ({ label: `final-critic:${lens}`, model: LONG_MODEL, maxTokens: 32000, costUsd: 4.6125 })) },
];
const full = await store.createPreflightRequest(preflightRequest({ userId: owner.id, action: "full",
  goal: `A long new-run goal ${LONG}`, platforms: ["instagram", "facebook", "google_business_profile"], scopeTags: ["brakes"],
  sourceRunId: null, factVersionId: factVersion }));
store.answerPreflight(full.requestId, { quote: { ceilingMicros: 21_650_000, breakdown } });
const plan = JSON.parse(JSON.stringify(planRevision(JSON.parse(files["06-final-critic.json"]).output)));
const revise = await store.createPreflightRequest(preflightRequest({ userId: owner.id, action: "revise", goal: null,
  platforms: ["instagram", "facebook", "google_business_profile"], scopeTags: null, sourceRunId: run.id, factVersionId: factVersion }));
store.answerPreflight(revise.requestId, { quote: { ceilingMicros: 9_150_000, breakdown: breakdown.slice(4) } }, plan);
const today = localDay(Date.now());
store.ledger.push({ entry: "reserve", runId: run.id, amountMicros: 21_650_000, day: today },
  { entry: "release", runId: run.id, amountMicros: 20_415_433, day: today },
  { entry: "overrun", runId: run.id, amountMicros: 1_234_567, day: today });

// S7.2: fact versions, an accepted check with warnings, and an archived import.
const retired = store.addFactVersion({ [`retired-${LONG.slice(0, 60)}`]: 4 }, false);
store.factVersions.get(retired).status = "retired";
const factsBytes = Buffer.from(JSON.stringify({ facts: [], layout: LONG }), "utf8");
const staged = await store.stageFactUpload({ ownerId: owner.id, content: factsBytes,
  sha256: createHash("sha256").update(factsBytes).digest("hex") });
store.answerFactCheck(staged.checkId, { accepted: { recordCount: 70, overCap: true,
  tagCounts: { brakes: 30, [LONG.slice(0, 120)]: 40 } } }, [`facts[].${LONG.slice(0, 100)}`, "exportedBy", "facts[].vin"]);
const archivedImport = store.addRun(owner, { kind: "imported", runner: "live", state: "succeeded", import_tier: "archived_unverified",
  goal: `An imported goal ${LONG}`, failure_class: "revalidation_failed", failure_message: `the saved output no longer revalidates: ${LONG}` });
store.addArtifact(archivedImport.id, "run-meta.json", JSON.stringify({ runner: "live",
  approvedFacts: { path: `/Users/synthetic-owner/${LONG}/config/approved-facts.json` },
  automotiveFacts: { path: `/Users/synthetic-owner/private/${LONG.slice(0, 120)}.json` } }));

const app = createStudioWebApp({
  store, commit: "0".repeat(40), log: () => {},
  config: { publicOrigin: "https://studio.test", allowedHd: "germancardepot.com", clientId: "layout.apps.test", clientSecret: "layout-secret",
    bootstrapOwnerEmail: null, ceilings: { dailyMicros: 75_000_000, monthlyMicros: 300_000_000 } },
});
const server = createServer((req, res) => { void app.handle(req, res); });
await new Promise((settle) => server.listen(0, "127.0.0.1", settle));
const base = `http://127.0.0.1:${server.address().port}`;

// --- Chromium over the DevTools protocol --------------------------------------------------------------

const profile = mkdtempSync(join(tmpdir(), "gcd-studio-layout-"));
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
const violations = [];
listeners.push((message) => {
  if (message.sessionId !== sessionId) return;
  if (message.method === "Log.entryAdded" && /Content Security Policy|Refused to/i.test(message.params.entry.text)) {
    violations.push(message.params.entry.text);
  }
  if (message.method === "Runtime.consoleAPICalled" || message.method === "Runtime.exceptionThrown") {
    const text = JSON.stringify(message.params).slice(0, 300);
    if (/Content Security Policy|Refused to/i.test(text)) violations.push(text);
  }
});
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Log.enable");
await cdp("Network.enable");
await cdp("Network.setExtraHTTPHeaders", { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });

async function visit(path, width) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height: 812, deviceScaleFactor: 2, mobile: width < 700 });
  const loaded = new Promise((settle) => {
    const listener = (message) => {
      if (message.sessionId === sessionId && message.method === "Page.loadEventFired") {
        listeners.splice(listeners.indexOf(listener), 1);
        settle();
      }
    };
    listeners.push(listener);
  });
  await cdp("Page.navigate", { url: `${base}${path}` });
  await loaded;
  const { result } = await cdp("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const targets = [...document.querySelectorAll("a, button, select, summary, input:not([type=hidden])")].filter(visible)
        .map((el) => { const r = el.getBoundingClientRect();
          return { tag: el.tagName.toLowerCase(), text: (el.textContent || "").trim().slice(0, 40), width: Math.round(r.width * 10) / 10,
            height: Math.round(r.height * 10) / 10 }; });
      const top = (selector) => { const el = document.querySelector(selector); return el ? el.getBoundingClientRect().top + scrollY : null; };
      return {
        title: document.title,
        scrollWidth: document.scrollingElement.scrollWidth,
        clientWidth: document.scrollingElement.clientWidth,
        targets,
        small: targets.filter((t) => t.width < ${MIN_TAP} || t.height < ${MIN_TAP}),
        copies: [...document.querySelectorAll("button.copy")].map((b) => b.getAttribute("data-copy")),
        text: document.body.innerText,
        stylesheetLoaded: [...document.styleSheets].some((s) => (s.href || "").includes("/static/studio.css")),
        decisionsTop: top("section.decisions"), captionsTop: top("section.captions"), findingsTop: top("section.findings"),
      };
    })()`,
  });
  return result.value;
}

const results = {};
let ok = true;
const assert = (name, cond, detail) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!cond) ok = false;
};
try {
  results.listPhone = await visit("/runs", PHONE);
  results.reportPhone = await visit(`/runs/${run.id}`, PHONE);
  results.reportLens = await visit(`/runs/${run.id}?group=lens`, PHONE);
  results.reportDesktop = await visit(`/runs/${run.id}`, DESKTOP);
  await cdp("Network.setExtraHTTPHeaders", { headers: { cookie: `${SESSION_COOKIE}=${ownerCookie}` } });
  results.newRunPhone = await visit("/new", PHONE);
  results.quotePhone = await visit(`/preflights/${full.requestId}`, PHONE);
  results.revisePhone = await visit(`/preflights/${revise.requestId}`, PHONE);
  results.spendPhone = await visit("/spend", PHONE);
  results.ownerReportPhone = await visit(`/runs/${run.id}`, PHONE);
  results.versionsPhone = await visit("/facts", PHONE);
  results.uploadPhone = await visit("/facts/upload", PHONE);
  results.checkPhone = await visit(`/facts/checks/${staged.checkId}`, PHONE);
  results.importPhone = await visit("/imports/new", PHONE);
  results.importReportPhone = await visit(`/runs/${archivedImport.id}`, PHONE);
  const S62_PAGES = {
    newRunPhone: ["Check and get a price", "Start FAKE — wiring test"],
    quotePhone: ["Confirm", "$21.65"],
    revisePhone: ["Confirm", "$9.15"],
    spendPhone: ["Overruns", "Acknowledge"],
    ownerReportPhone: ["Revise"],
    versionsPhone: ["Fact versions", "ACTIVE", "Make active", "Restore"],
    uploadPhone: ["Upload a facts file", "Upload and check"],
    checkPhone: ["Accepted", "70 records", "an unscoped run will be refused", "exportedBy"],
    importPhone: ["Import a run folder", "Run folder", "The known files"],
    importReportPhone: ["Not revalidated", "approved-facts.json"],
  };
  for (const [key, words] of Object.entries(S62_PAGES)) {
    assert(`${key}: the page rendered what it is for (${words.join(", ")})`, words.every((w) => results[key].text.includes(w)),
      results[key].text.slice(0, 400));
  }
  for (const key of ["listPhone", "reportPhone", "reportLens", ...Object.keys(S62_PAGES)]) {
    const r = results[key];
    console.log(`${key}: scrollWidth ${r.scrollWidth} (client ${r.clientWidth}), ${r.targets.length} tap targets, smallest `
      + `${Math.min(...r.targets.map((t) => t.height))}x${Math.min(...r.targets.map((t) => t.width))} px, stylesheet ${r.stylesheetLoaded}`);
    assert(`${key}: no horizontal scroll at ${PHONE} px (document.scrollingElement.scrollWidth <= ${PHONE})`, r.scrollWidth <= PHONE, r.scrollWidth);
    assert(`${key}: every visible tap target is at least ${MIN_TAP} px in both directions`, r.small.length === 0 && r.targets.length > 3, r.small);
    assert(`${key}: the stylesheet loaded from /static/studio.css`, r.stylesheetLoaded, r.title);
  }
  const phone = results.reportPhone;
  assert("report at 375 px: \"Needs your decision\" is shown before the captions", phone.decisionsTop !== null
    && phone.decisionsTop < phone.captionsTop, [phone.decisionsTop, phone.captionsTop]);
  const desk = results.reportDesktop;
  assert("report at 1024 px: the sections are in the design's order (findings, then \"Needs your decision\")",
    desk.captionsTop < desk.findingsTop && desk.findingsTop < desk.decisionsTop, [desk.captionsTop, desk.findingsTop, desk.decisionsTop]);
  assert("report: each Copy button's attribute, as Chromium parses it, is exactly the expected text (CR LF kept)",
    JSON.stringify(phone.copies) === JSON.stringify(expectedCopies) && phone.copies.every((c) => c.includes("\r\n")),
    { got: phone.copies.map((c) => c.length), want: expectedCopies.map((c) => c.length) });
  assert("archived import report: the recorded files are shown by base name only (no absolute path)",
    !results.importReportPhone.text.includes("/Users/") && results.importReportPhone.text.includes("approved-facts.json"),
    results.importReportPhone.text.slice(0, 400));
  assert("no Content-Security-Policy violation was reported on any page", violations.length === 0, violations);
} finally {
  socket.close();
  // (S7.2) Chromium and every helper process it started (its own process group) are stopped, and the profile is
  // removed only once Chromium has exited, so nothing is still writing to it.
  const exited = browser.exitCode !== null || browser.signalCode !== null ? Promise.resolve() : new Promise((settle) => browser.once("exit", settle));
  try { process.kill(-browser.pid, "SIGKILL"); } catch { browser.kill("SIGKILL"); }
  await exited;
  await new Promise((settle) => setTimeout(settle, 300));
  await new Promise((settle) => { server.closeAllConnections(); server.close(() => settle()); });
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(ok ? "\nstudio layout check: ALL PASS" : "\nstudio layout check: FAILED");
process.exit(ok ? 0 : 1);
