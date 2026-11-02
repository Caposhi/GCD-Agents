#!/usr/bin/env node
/**
 * GBP search-demand report: which words people typed when they found the
 * Business Profile, bucketed so the useful ones stand out. READ-ONLY.
 *
 *   node scripts/ops/gbp-search-demand/run.mjs --from-file terms.json
 *   node scripts/ops/gbp-search-demand/run.mjs --print-request [--months 3]
 *   node scripts/ops/gbp-search-demand/run.mjs --live [--months 3] [--json]
 *
 * `--from-file` classifies a saved list and contacts nothing. It accepts either
 * a JSON array of `{ "term": "...", "value": 12 }` / `{ "term": "...", "threshold": 15 }`
 * or lines of `term<TAB>count` (or `term,count`); a count of `<15` is read as a threshold.
 *
 * `--live` makes ONE read-only call sequence to Google (the token exchange, then
 * GET requests to the Business Profile Performance API). It needs, from the
 * environment and never from argv: GBP_LOCATION_ID and either
 * GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, or a static
 * GOOGLE_ACCESS_TOKEN. Without `--live` the program never opens a socket.
 *
 * It writes no file, never prints a credential, and changes nothing: no post,
 * no brief, no approved fact. The output is for the owner to read.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { buildUrl, fetchMonthlyKeywords, lastCompleteMonths, refreshAccessToken, validateLocationId } from "./client.mjs";
import { formatReport, summarize } from "./classify.mjs";

/** @param {string} text */
export function parseTermsFile(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("the JSON file must be an array");
    return arr
      .filter((e) => typeof e?.term === "string")
      .map((e) => (Number.isFinite(Number(e.value)) && e.value !== undefined ? { term: e.term, value: Number(e.value) } : { term: e.term, threshold: Number(e.threshold) || 15 }));
  }
  const out = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const m = line.match(/^(.*?)[\t,]\s*(<\s*)?(\d+)\s*$/);
    if (!m) continue;
    const term = m[1].replace(/^\s*\d+\.\s*/, "").trim();
    if (term === "") continue;
    out.push(m[2] ? { term, threshold: Number(m[3]) } : { term, value: Number(m[3]) });
  }
  return out;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const a = { mode: null, file: null, months: 3, json: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--live") a.mode = "live";
    else if (x === "--print-request") a.mode = "print";
    else if (x === "--from-file") { a.mode = "file"; a.file = argv[++i] ?? null; }
    else if (x === "--months") a.months = Number(argv[++i]);
    else if (x === "--json") a.json = true;
    else throw new Error(`unknown argument: ${x}`);
  }
  if (a.mode === null) throw new Error("choose one of --from-file <path>, --print-request or --live");
  if (a.mode === "file" && !a.file) throw new Error("--from-file needs a path");
  return a;
}

/**
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv, now?: Date, fetchImpl?: typeof fetch, readFile?: (p: string) => string, log?: (s: string) => void }} [io]
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const log = io.log ?? ((s) => console.log(s));
  const a = parseArgs(argv);
  const now = io.now ?? new Date();
  const { start, end } = lastCompleteMonths(now, a.months);
  const range = `${start.year}-${String(start.month).padStart(2, "0")} to ${end.year}-${String(end.month).padStart(2, "0")}`;

  if (a.mode === "print") {
    log(buildUrl(validateLocationId(env.GBP_LOCATION_ID), start, end));
    log("(GET; no credential in this URL. `--live` adds an Authorization header and sends it.)");
    return 0;
  }

  let records;
  let label = `${range} (live)`;
  if (a.mode === "file") {
    records = parseTermsFile((io.readFile ?? ((p) => readFileSync(p, "utf8")))(a.file));
    label = `from ${a.file} (no range recorded)`;
  } else {
    const locationId = validateLocationId(env.GBP_LOCATION_ID);
    let accessToken = env.GOOGLE_ACCESS_TOKEN || "";
    if (env.GOOGLE_REFRESH_TOKEN && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      accessToken = await refreshAccessToken(
        { refreshToken: env.GOOGLE_REFRESH_TOKEN, clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
        io.fetchImpl,
      );
    }
    if (!accessToken) throw new Error("no Google credential in the environment (GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, or GOOGLE_ACCESS_TOKEN)");
    records = await fetchMonthlyKeywords({ locationId, start, end, accessToken, fetchImpl: io.fetchImpl });
  }
  const summary = summarize(records);
  if (a.json) {
    // Counts only: the three buckets that may hold a stranger's address are never listed.
    const safe = { ...summary, buckets: Object.fromEntries(Object.entries(summary.buckets).map(([k, v]) => [k, ["geo", "noise", "other"].includes(k) ? { ...v, list: [] } : v])) };
    log(JSON.stringify({ range: label, ...safe }, null, 2));
  } else {
    log(formatReport(summary, { range: label }));
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (err) => {
      // Only the message this program wrote; never a response body or a credential.
      console.error(`gbp-search-demand: ${err instanceof Error ? err.message : "failed"}`);
      process.exitCode = 1;
    },
  );
}
