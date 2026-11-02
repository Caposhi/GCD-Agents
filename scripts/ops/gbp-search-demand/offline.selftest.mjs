#!/usr/bin/env node
/**
 * Offline tests for the GBP search-demand report. No network: Google is a stub,
 * so every path — success, paging, thresholds, a refused token, a redirect, a
 * server that echoes a secret — runs without a socket. No term below is a real
 * searcher's: the addresses are invented, because the point of one test is that
 * an address-shaped term is counted and never printed.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bucketOf, flagsOf, formatReport, makesIn, summarize } from "./classify.mjs";
import { PERFORMANCE_HOST, buildUrl, fetchMonthlyKeywords, lastCompleteMonths, parsePage, refreshAccessToken, validateLocationId } from "./client.mjs";
import { main, parseArgs, parseTermsFile } from "./run.mjs";

let checks = 0;
function check(name, ok) {
  checks++;
  if (!ok) {
    console.log(`FAIL  ${name}`);
    process.exitCode = 1;
    throw new Error(`failed: ${name}`);
  }
  console.log(`PASS  ${name}`);
}
const HERE = dirname(fileURLToPath(import.meta.url));

// --- classification ------------------------------------------------------------------------
const cases = [
  ["german car depot", "brand"],
  ["german car depot, fillmore street, hollywood, fl", "brand"],
  ["audi mechanic near me", "intent"],
  ["bmw pre purchase inspection hollywood fl", "intent"],
  ["best mercedes repair near me", "intent"],
  ["european auto repair near me", "intent"],
  ["german car oil change prices broward", "intent"],
  ["bmw repair", "intent"],
  ["car repair", "intent"],
  ["volkswagen", "make"],
  ["bmw", "make"],
  ["german cars", "category"],
  ["german", "category"],
  ["german car", "category"],
  ["auto parts near me", "adjacent"],
  ["bmw parts", "adjacent"],
  ["car wash", "adjacent"],
  ["hollywood, fl", "geo"],
  ["miami, florida, usa", "geo"],
  ["123 example street, hollywood, fl", "geo"],
  ["33020", "geo"],
  ["fort lauderdale, florida, ee. uu.", "geo"],
  ["restaurants", "noise"],
  ["german restaurant", "noise"],
  ["hotels", "noise"],
  ["publix", "noise"],
  ["mecánico bmw en hollywood", "intent"],
  ["taller mecánico cerca de mí", "intent"],
  ["xyzzy", "other"],
];
for (const [term, expected] of cases) check(`bucket: "${term}" -> ${expected}`, bucketOf(term) === expected);
check(
  "bucket: a service word beats a town — a repair search that names Hollywood is intent, not geo",
  bucketOf("bmw auto repair hollywood fl") === "intent" && bucketOf("auto repair shop in hollywood fl") === "intent",
);
check("makes: aliases map to display names (vw, benz, mini)", makesIn("german vw transmission").join() === "Volkswagen" && makesIn("benz service").join() === "Mercedes-Benz" && makesIn("best mini repair").join() === "Mini Cooper");

// --- claims and approved services ---------------------------------------------------------
check("flags: price / financing / sale wording needs an approved fact", flagsOf("german car oil change prices broward").needsApprovedFact && flagsOf("german cars for sale").needsApprovedFact && !flagsOf("audi mechanic near me").needsApprovedFact);
check(
  "flags: a service the approved facts do not list is named (a/c, battery, tires)",
  flagsOf("german car air conditioning").notInApprovedServices.join() === "air conditioning / A/C" && flagsOf("audi battery replacement").notInApprovedServices.join() === "battery" && flagsOf("brake service").notInApprovedServices.length === 0,
);

// The approved-service list in classify.mjs must match config/approved-facts.json, or the "not in approved facts" flag lies.
{
  const facts = JSON.parse(readFileSync(resolve(HERE, "../../../config/approved-facts.json"), "utf8"));
  const text = readFileSync(resolve(HERE, "classify.mjs"), "utf8");
  const mapped = ["oil change", "oil-leak repair", "brake service", "check-engine diagnostics", "cooling system", "steering & suspension", "transmission service", "engine repair", "pre-purchase inspection"];
  check(
    "approved facts: every approved service appears in the classifier's list, and the classifier lists nothing the approved facts lack",
    facts.services.length === 9 && facts.services.every((s) => mapped.some((m) => m.replace("-", " ").includes(s.replace("-", " ").split(" ")[0]))) && mapped.every((m) => text.includes(`"${m}"`)),
  );
  check("approved facts: the seven makes match the classifier's make list", facts.makes.length === 7 && facts.makes.every((m) => text.includes(`["${m}",`)));
}

// --- summary and the report ----------------------------------------------------------------
const records = [
  { term: "german car depot, fillmore street, hollywood, fl", value: 500 },
  { term: "volkswagen", value: 140 },
  { term: "bmw", value: 40 },
  { term: "german cars", value: 180 },
  { term: "hollywood, fl", value: 170 },
  { term: "123 example street, hollywood, fl", value: 30 },
  { term: "restaurants", value: 90 },
  { term: "audi mechanic near me", threshold: 15 },
  { term: "german car air conditioning", threshold: 15 },
  { term: "german car oil change prices broward", threshold: 15 },
  { term: "pompano beach german car specialist", threshold: 15 },
];
const s = summarize(records);
check("summary: exact counts add up across buckets and only exact counts are totalled", s.exactTotal === 1150 && Object.values(s.buckets).reduce((a, b) => a + b.exact, 0) === s.exactTotal && s.belowThresholdTerms === 4);
check("summary: make demand counts only exact numbers", s.makeDemand.Volkswagen === 140 && s.makeDemand.BMW === 40 && s.makeDemand.Audi === 0);
check("summary: a below-threshold term is kept with its threshold, not turned into zero", s.buckets.intent.list.some((e) => e.term === "audi mechanic near me" && e.value === null && e.threshold === 15));
const report = formatReport(s, { range: "2026-08 to 2026-10" });
check("report: names a content term and its count", report.includes("- volkswagen — 140") && report.includes("- audi mechanic near me — below 15"));
check("report: PRIVACY — an address-shaped term is counted, never printed; neither are geo or noise terms", !report.includes("123 example") && !report.includes("restaurants") && !report.includes("- hollywood, fl") && report.includes("counted and never listed"));
check("report: flags price and unapproved-service terms for the owner", report.includes("german car oil change prices broward — price / financing / sale wording") && report.includes("service not in approved facts: air conditioning / A/C"));
check("report: states that a term is data, not a claim, and that nothing is changed", report.includes("A search term is data, not a claim") && report.includes("Nothing here changes a post"));
{
  const json = await (async () => {
    let out = "";
    await main(["--from-file", "x.json", "--json"], { readFile: () => JSON.stringify(records.map((r) => ({ ...r }))), log: (t) => (out += t) });
    return JSON.parse(out);
  })();
  check("json: geo, noise and other buckets carry counts but an empty list", json.buckets.geo.list.length === 0 && json.buckets.noise.list.length === 0 && json.buckets.geo.exact === 200 && !JSON.stringify(json).includes("123 example"));
}

// --- the file reader ---------------------------------------------------------------------
check("file: tab, comma and '<15' forms parse; numbering and blanks are ignored", (() => {
  const r = parseTermsFile("1. german cars\t184\n\naudi repair,<15\nbmw\t41\nnot a count line");
  return r.length === 3 && r[0].value === 184 && r[1].threshold === 15 && r[2].term === "bmw";
})());

// --- the client --------------------------------------------------------------------------
check("location id: digits only, so it can never alter the request path", validateLocationId("locations/1234567890") === "1234567890" && ["../x", "12 34", "abc", "", "123/../456"].every((bad) => { try { validateLocationId(bad); return false; } catch { return true; } }));
{
  const u = new URL(buildUrl("1234567890", { year: 2026, month: 8 }, { year: 2026, month: 10 }, "tok"));
  check(
    "request: one fixed host, GET path, the documented range parameters, page size 100, and no credential in the URL",
    u.host === PERFORMANCE_HOST && u.pathname === "/v1/locations/1234567890/searchkeywords/impressions/monthly"
      && u.searchParams.get("monthlyRange.start_month.year") === "2026" && u.searchParams.get("monthlyRange.end_month.month") === "10"
      && u.searchParams.get("pageSize") === "100" && u.searchParams.get("pageToken") === "tok" && !/token=|access|secret|key/i.test(u.search.replace("pageToken", "")),
  );
  check("request: an inverted or invalid range is refused before any call", [[{ year: 2026, month: 10 }, { year: 2026, month: 8 }], [{ year: 2026, month: 13 }, { year: 2026, month: 13 }]].every(([a, b]) => { try { buildUrl("1234567890", a, b); return false; } catch { return true; } }));
}
check("range: last complete months, across a year boundary", JSON.stringify(lastCompleteMonths(new Date(Date.UTC(2026, 10, 3)), 3)) === JSON.stringify({ start: { year: 2026, month: 8 }, end: { year: 2026, month: 10 } }) && JSON.stringify(lastCompleteMonths(new Date(Date.UTC(2027, 0, 5)), 3)) === JSON.stringify({ start: { year: 2026, month: 10 }, end: { year: 2026, month: 12 } }));
check("range: --months outside 1..12 is refused", [0, 13, 1.5, NaN].every((m) => { try { lastCompleteMonths(new Date(), m); return false; } catch { return true; } }));
check(
  "parse: value and threshold are told apart; a malformed entry is tolerated, not trusted",
  (() => {
    const r = parsePage({ searchKeywordsCounts: [{ searchKeyword: "a", insightsValue: { value: "12" } }, { searchKeyword: "b", insightsValue: { threshold: "15" } }, { searchKeyword: "c", insightsValue: {} }, { nope: 1 }], nextPageToken: "n" });
    return r.records.length === 3 && r.records[0].value === 12 && r.records[1].threshold === 15 && r.records[2].value === undefined && r.nextPageToken === "n";
  })(),
);

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const bad = (status) => ({ ok: false, status, json: async () => ({ error: { message: "SECRET-BODY-TEXT" } }) });
{
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return calls.length === 1
      ? ok({ searchKeywordsCounts: [{ searchKeyword: "audi repair", insightsValue: { value: "20" } }], nextPageToken: "p2" })
      : ok({ searchKeywordsCounts: [{ searchKeyword: "bmw service", insightsValue: { threshold: "15" } }] });
  };
  const recs = await fetchMonthlyKeywords({ locationId: "1234567890", start: { year: 2026, month: 8 }, end: { year: 2026, month: 10 }, accessToken: "AT-123", fetchImpl });
  check("fetch: follows nextPageToken, stops when it is absent, and returns every record", recs.length === 2 && calls.length === 2 && calls[1].url.includes("pageToken=p2"));
  check(
    "fetch: every request is a GET with a bearer header, refuses redirects, and goes only to the Performance API host",
    calls.every((c) => c.init.method === "GET" && c.init.redirect === "error" && c.init.headers.authorization === "Bearer AT-123" && new URL(c.url).host === PERFORMANCE_HOST && c.init.body === undefined),
  );
}
{
  let msg = "";
  try { await fetchMonthlyKeywords({ locationId: "1234567890", start: { year: 2026, month: 8 }, end: { year: 2026, month: 8 }, accessToken: "AT-SECRET", fetchImpl: async () => bad(403) }); } catch (e) { msg = e.message; }
  check("fetch: a refused call names the status and a hint, and never echoes the response body or the token", msg.includes("HTTP 403") && msg.includes("may not be enabled") && !msg.includes("SECRET-BODY-TEXT") && !msg.includes("AT-SECRET"));
  let paged = "";
  try { await fetchMonthlyKeywords({ locationId: "1234567890", start: { year: 2026, month: 8 }, end: { year: 2026, month: 8 }, accessToken: "x", fetchImpl: async () => ok({ searchKeywordsCounts: [], nextPageToken: "again" }) }); } catch (e) { paged = e.message; }
  check("fetch: a response that never stops paging is cut off", paged.includes("stopped after 50 pages"));
}
{
  let seen;
  const tok = await refreshAccessToken({ refreshToken: "RT", clientId: "CID", clientSecret: "CS" }, async (url, init) => { seen = { url, init }; return ok({ access_token: "NEW-AT" }); });
  check("token: exchange is a POST to Google's token endpoint with redirects refused, and returns only the access token", tok === "NEW-AT" && seen.url === "https://oauth2.googleapis.com/token" && seen.init.method === "POST" && seen.init.redirect === "error");
  let m = "";
  try { await refreshAccessToken({ refreshToken: "RT-SECRET", clientId: "CID", clientSecret: "CS-SECRET" }, async () => bad(400)); } catch (e) { m = e.message; }
  check("token: a failed exchange names the status only — no refresh token, client secret or body", m.includes("HTTP 400") && !m.includes("RT-SECRET") && !m.includes("CS-SECRET") && !m.includes("SECRET-BODY-TEXT"));
}

// --- the command line -------------------------------------------------------------------------
check("cli: one mode is required, and an unknown flag is refused", [[], ["--bogus"], ["--from-file"]].every((a) => { try { parseArgs(a); return false; } catch { return true; } }));
{
  let called = 0;
  const out = [];
  await main(["--print-request"], { env: { GBP_LOCATION_ID: "1234567890" }, now: new Date(Date.UTC(2026, 10, 3)), fetchImpl: async () => { called++; return ok({}); }, log: (t) => out.push(t) });
  check("cli: --print-request prints the URL and opens no connection", called === 0 && out[0].startsWith(`https://${PERFORMANCE_HOST}/v1/locations/1234567890/`) && !out.join("").includes("Bearer"));
  let c2 = 0;
  await main(["--from-file", "x.tsv"], { readFile: () => "german cars\t10", fetchImpl: async () => { c2++; return ok({}); }, log: () => {} });
  check("cli: --from-file classifies a saved list and opens no connection", c2 === 0);
  let thrown = "";
  try { await main(["--live"], { env: { GBP_LOCATION_ID: "1234567890" }, fetchImpl: async () => ok({}), log: () => {} }); } catch (e) { thrown = e.message; }
  check("cli: --live with no credential refuses before any request", thrown.includes("no Google credential") && !thrown.includes("1234567890"));
  const out2 = [];
  await main(["--live", "--months", "2"], {
    env: { GBP_LOCATION_ID: "1234567890", GOOGLE_REFRESH_TOKEN: "RT", GOOGLE_CLIENT_ID: "CID", GOOGLE_CLIENT_SECRET: "CS" },
    now: new Date(Date.UTC(2026, 10, 3)),
    fetchImpl: async (url) => (String(url).includes("oauth2") ? ok({ access_token: "AT" }) : ok({ searchKeywordsCounts: [{ searchKeyword: "volkswagen", insightsValue: { value: "9" } }] })),
    log: (t) => out2.push(t),
  });
  check("cli: --live exchanges the token, reads the keywords, and prints a report with no credential in it", out2.join("").includes("volkswagen — 9") && !/RT|CID|CS|AT\b/.test(out2.join("").replace(/\bAudi|\bBMW|CATEGORY|category|CS/g, "")) && out2.join("").includes("2026-09 to 2026-10"));
}

// --- the file's own promises -----------------------------------------------------------------
{
  const src = ["classify.mjs", "client.mjs", "run.mjs"].map((f) => readFileSync(resolve(HERE, f), "utf8")).join("\n");
  check("source: no write, no delete, no spawn — the only methods are GET and the token POST", !/writeFile|appendFile|unlink|\brm\(|\bspawn|child_process|method:\s*"(PUT|PATCH|DELETE)"/.test(src) && /method: "GET"/.test(src) && /method: "POST"/.test(src));
  check("source: redirects are refused on every request", (src.match(/^\s+redirect: "error",/gm) ?? []).length === 2);
  check("source: it imports no live-service module and reads no other credential", !/from "\.\.\/\.\.\/\.\.\/(src|dist)/.test(src) && !/process\.env\.(DATABASE_URL|ANTHROPIC|IMAGEGEN|SLACK|CONSOLE)/.test(src));
}

console.log(`GBP search-demand offline self-test passed: ${checks} checks`);
