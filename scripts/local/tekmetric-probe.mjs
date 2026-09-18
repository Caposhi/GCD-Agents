#!/usr/bin/env node
/**
 * Local, read-only Tekmetric API probe: aggregate-only feasibility check for
 * whether repair-order data can support computing the actual observed
 * oil-service interval (miles and months) for GCD's BMW and Mercedes-Benz
 * customers.
 *
 * This is deliberately OUTSIDE the P1-P8 / M2-M7 production-wiring sequence
 * (see docs/ROADMAP.md). It authorizes nothing and deploys nothing: it calls
 * no HTTP route, no worker, no scheduler, no approval path, and no
 * publishing path in this repository. No data-mutating request is ever
 * issued. The only non-GET request is the OAuth2 client-credentials token
 * POST to /api/v1/oauth/token required to authenticate; every data request
 * is a GET. It runs against sandbox by default per the tekmetric-api skill;
 * pass --live-shop-data to acknowledge a non-sandbox (e.g. production) base
 * URL — without that flag, a non-sandbox TEKMETRIC_BASE_URL is refused
 * before the token request is ever made.
 *
 * PII / confidentiality: this script never prints or persists a VIN,
 * customer name, address, phone, email, RO number tied to an identifiable
 * customer, free-text note/concern body, or any monetary figure. It reports
 * counts and aggregates only.
 *
 * Credential handling: the client id/secret are read from environment
 * variables (never hardcoded, never logged, never written to disk). This
 * script is intentionally NOT wired through config/*.env.example or
 * scripts/ci/check-environment-coverage.mjs (which scans only src/**\/*.ts) —
 * these variables are not read by any deployed API, worker, or scheduler,
 * and listing them there would falsely imply otherwise.
 *
 * Required environment variables:
 *   TEKMETRIC_CLIENT_ID       OAuth2 client_credentials client id
 *   TEKMETRIC_CLIENT_SECRET   OAuth2 client_credentials client secret
 *   TEKMETRIC_SHOP_ID         Shop id to query (must be in the token's scope)
 *
 * Optional environment variables:
 *   TEKMETRIC_BASE_URL        Default https://sandbox.tekmetric.com
 *
 * Usage:
 *   TEKMETRIC_CLIENT_ID=... TEKMETRIC_CLIENT_SECRET=... TEKMETRIC_SHOP_ID=... \
 *     node scripts/local/tekmetric-probe.mjs [options]
 *
 * Options:
 *   --months <n>          Lookback window in months for postedDate. Default 24.
 *   --max-requests <n>    Hard cap on total HTTP requests made. Default 400.
 *                         A real shop will likely exceed this default cap
 *                         before all matched vehicles' repair orders are
 *                         fetched, in which case the GATING NUMBER (result
 *                         section 4) is a FLOOR, not the true count, and the
 *                         vehicle whose pagination was interrupted has a
 *                         truncated repair-order list. Raise this for a real
 *                         run once the true vehicle/RO volume is known.
 *   --page-size <n>       Page size for list endpoints (max 100). Default 100.
 *   --live-shop-data      Required to target any non-sandbox base URL (i.e.
 *                         TEKMETRIC_BASE_URL other than the sandbox default).
 *                         Without it, a non-sandbox base URL is refused
 *                         before any request is made, including the token
 *                         request.
 *   -h, --help
 *
 * No data-mutating request is ever issued. The only non-GET request is the
 * OAuth2 client-credentials token POST to /api/v1/oauth/token required to
 * authenticate; every data request is a GET.
 */

function usage() {
  console.log(`Usage: node scripts/local/tekmetric-probe.mjs [options]

Read-only Tekmetric feasibility probe. Prints AGGREGATE COUNTS ONLY — never a
VIN, customer name, address, phone, email, identifiable RO number, free-text
note body, or monetary figure.

Required environment variables:
  TEKMETRIC_CLIENT_ID       OAuth2 client_credentials client id
  TEKMETRIC_CLIENT_SECRET   OAuth2 client_credentials client secret
  TEKMETRIC_SHOP_ID         Shop id to query

Optional environment variables:
  TEKMETRIC_BASE_URL        Default https://sandbox.tekmetric.com

Options:
  --months <n>          Lookback window in months for postedDate. Default 24.
  --max-requests <n>    Hard cap on total HTTP requests made. Default 400.
                        A real shop will likely exceed this default cap before
                        all matched vehicles' repair orders are fetched. When
                        it binds, the GATING NUMBER (result section 4) is a
                        FLOOR, not the true count, and the vehicle whose
                        pagination was interrupted has a truncated repair-order
                        list. Raise this for a real run once the true
                        vehicle/RO volume is known.
  --page-size <n>       Page size for list endpoints (max 100). Default 100.
  --live-shop-data      Required to target any non-sandbox base URL (i.e. a
                        TEKMETRIC_BASE_URL other than the sandbox default).
                        Without it, a non-sandbox base URL is refused before
                        any request is made, including the OAuth2 token
                        request.
  -h, --help

No data-mutating request is ever issued. The only non-GET request is the
OAuth2 client-credentials token POST to /api/v1/oauth/token required to
authenticate; every data request is a GET.
`);
}

function parseArgs(argv) {
  const args = { months: 24, maxRequests: 400, pageSize: 100, liveShopData: false, help: false };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === "-h" || token === "--help") { args.help = true; continue; }
    if (token === "--months") { args.months = Number(rest.shift()); continue; }
    if (token === "--max-requests") { args.maxRequests = Number(rest.shift()); continue; }
    if (token === "--page-size") { args.pageSize = Math.min(100, Number(rest.shift())); continue; }
    if (token === "--live-shop-data") { args.liveShopData = true; continue; }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

const SANDBOX_BASE_URL = "https://sandbox.tekmetric.com";

let requestCount = 0;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET-only fetch with exponential backoff on 429, per the tekmetric-api
 * skill: wait = min(2^n + random_ms(<=1000), 60000), n starting at 1, up to
 * 5 attempts.
 */
async function getWithBackoff(url, headers, maxRequests) {
  if (requestCount >= maxRequests) {
    throw new Error(`Request budget exhausted (${maxRequests} requests). Aborting.`);
  }
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    requestCount++;
    const res = await fetch(url, { method: "GET", headers });
    if (res.status === 429) {
      const waitMs = Math.min(2 ** attempt + Math.floor(Math.random() * 1000), 60000);
      if (attempt === maxAttempts) {
        throw new Error(`Rate limited (429) after ${maxAttempts} attempts: ${url}`);
      }
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Tekmetric API error ${res.status} on ${new URL(url).pathname}`);
    }
    return res.json();
  }
  throw new Error("unreachable");
}

async function getAccessToken(baseUrl, clientId, clientSecret, maxRequests) {
  if (requestCount >= maxRequests) {
    throw new Error(`Request budget exhausted (${maxRequests} requests). Aborting.`);
  }
  requestCount++;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/api/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`OAuth token request failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  if (!body.access_token) {
    throw new Error("OAuth response did not contain access_token");
  }
  return body.access_token;
}

async function fetchAllPages(baseUrl, headers, path, params, pageSize, maxRequests, describe) {
  const items = [];
  let page = 0;
  let totalPages = 1;
  do {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(pageSize));
    const data = await getWithBackoff(url.toString(), headers, maxRequests);
    const content = Array.isArray(data.content) ? data.content : [];
    items.push(...content);
    totalPages = typeof data.totalPages === "number" ? data.totalPages : 1;
    page++;
    if (describe) {
      process.stderr.write(`  ${describe}: page ${page}/${Math.max(totalPages, 1)}, ${items.length} rows so far (requests used: ${requestCount})\n`);
    }
  } while (page < totalPages && requestCount < maxRequests);
  return items;
}

// Tekmetric make spellings are not guaranteed uniform; normalize and match
// broadly, then report the *actual* distinct spellings observed so the
// matching can be verified rather than assumed.
function normalizeMake(make) {
  return String(make ?? "").trim().toUpperCase();
}

function isTargetMake(make) {
  const m = normalizeMake(make);
  return m === "BMW" || m.startsWith("MERCEDES");
}

function monthsAgoIso(months) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
}

function median(sortedNums) {
  if (sortedNums.length === 0) return null;
  const mid = Math.floor(sortedNums.length / 2);
  return sortedNums.length % 2 === 0
    ? (sortedNums[mid - 1] + sortedNums[mid]) / 2
    : sortedNums[mid];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  const clientId = process.env.TEKMETRIC_CLIENT_ID;
  const clientSecret = process.env.TEKMETRIC_CLIENT_SECRET;
  const shopId = process.env.TEKMETRIC_SHOP_ID;
  const baseUrl = process.env.TEKMETRIC_BASE_URL || SANDBOX_BASE_URL;

  if (baseUrl !== SANDBOX_BASE_URL && !args.liveShopData) {
    console.error(`Refusing: TEKMETRIC_BASE_URL is set to a non-sandbox base URL (${baseUrl}). Pass --live-shop-data to acknowledge querying a non-sandbox (e.g. production customer) target. No request has been made.`);
    process.exitCode = 1;
    return;
  }

  if (!clientId || !clientSecret || !shopId) {
    console.error("Missing required environment variables. Run with --help for details.");
    process.exitCode = 1;
    return;
  }

  const postedDateStart = monthsAgoIso(args.months);
  console.error(`Tekmetric probe starting. Base URL: ${baseUrl}. Shop: ${shopId}. Window: postedDate >= ${postedDateStart}. Max requests: ${args.maxRequests}.`);

  const token = await getAccessToken(baseUrl, clientId, clientSecret, args.maxRequests);
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Fetch vehicles for the shop and filter to BMW / Mercedes-Benz client-side
  //    (the vehicles list endpoint has no `make` filter).
  const allVehicles = await fetchAllPages(
    baseUrl, headers, "/api/v1/vehicles", { shop: shopId }, args.pageSize, args.maxRequests, "vehicles"
  );

  const distinctMakesSeen = new Map();
  for (const v of allVehicles) {
    const key = normalizeMake(v.make);
    distinctMakesSeen.set(key, (distinctMakesSeen.get(key) ?? 0) + 1);
  }

  const targetVehicles = allVehicles.filter((v) => isTargetMake(v.make));
  const targetMakesSeen = new Map();
  for (const v of targetVehicles) {
    const key = normalizeMake(v.make);
    targetMakesSeen.set(key, (targetMakesSeen.get(key) ?? 0) + 1);
  }

  console.error(`Vehicles: ${allVehicles.length} total, ${targetVehicles.length} matched BMW/Mercedes-Benz.`);

  // 2. For each target vehicle, fetch repair orders in the posted-date window.
  const perVehicleRos = new Map(); // vehicleId -> RO[]
  for (const v of targetVehicles) {
    if (requestCount >= args.maxRequests) {
      console.error(`Request budget exhausted before finishing all vehicles (${targetVehicles.length} total, request cap ${args.maxRequests} hit).`);
      break;
    }
    const ros = await fetchAllPages(
      baseUrl, headers, "/api/v1/repair-orders",
      { shop: shopId, vehicleId: v.id, postedDateStart },
      args.pageSize, args.maxRequests, null
    );
    perVehicleRos.set(v.id, { make: normalizeMake(v.make), year: v.year, ros });
  }

  // ---- Aggregate ----
  let totalRos = 0;
  let milesInNonNull = 0, milesInNull = 0;
  let milesOutNonNull = 0, milesOutNull = 0;
  const fillByMakePostedYear = new Map(); // "MAKE|POSTED_YEAR" -> {total, milesInFilled, milesOutFilled}
  const fillByMakeModelYear = new Map(); // "MAKE|MODEL_YEAR" -> {total, milesInFilled, milesOutFilled}
  const rosPerVehicleHist = new Map(); // count -> numVehicles
  let vehiclesQueried = 0;
  let vehiclesWithAnyRo = 0;
  let vehiclesWithTwoPlusUsable = 0;

  // structured-field oil-service identification check
  let jobsSampledForOilCheck = 0;
  let jobsWithOilInName = 0;

  for (const [, entry] of perVehicleRos) {
    vehiclesQueried++;
    const { make, year, ros } = entry;
    totalRos += ros.length;
    if (ros.length > 0) vehiclesWithAnyRo++;

    const bucket = rosPerVehicleHist.get(ros.length) ?? 0;
    rosPerVehicleHist.set(ros.length, bucket + 1);

    const modelYearKey = `${make}|${year ?? "unknown"}`;
    const fyModel = fillByMakeModelYear.get(modelYearKey) ?? { total: 0, milesInFilled: 0, milesOutFilled: 0 };

    const usable = [];
    for (const ro of ros) {
      const hasMilesIn = ro.milesIn !== null && ro.milesIn !== undefined;
      const hasMilesOut = ro.milesOut !== null && ro.milesOut !== undefined;

      const parsedPostedDate = ro.postedDate ? new Date(ro.postedDate) : null;
      const postedYear = parsedPostedDate && !Number.isNaN(parsedPostedDate.getTime())
        ? String(parsedPostedDate.getUTCFullYear())
        : "unknown/unparseable postedDate";
      const postedYearKey = `${make}|${postedYear}`;
      const fyPosted = fillByMakePostedYear.get(postedYearKey) ?? { total: 0, milesInFilled: 0, milesOutFilled: 0 };

      fyModel.total++;
      fyPosted.total++;
      if (hasMilesIn) { milesInNonNull++; fyModel.milesInFilled++; fyPosted.milesInFilled++; } else { milesInNull++; }
      if (hasMilesOut) { milesOutNonNull++; fyModel.milesOutFilled++; fyPosted.milesOutFilled++; } else { milesOutNull++; }
      if (hasMilesIn && ro.postedDate) {
        usable.push({ milesIn: ro.milesIn, postedDate: ro.postedDate });
      }
      fillByMakePostedYear.set(postedYearKey, fyPosted);

      // Structured-field oil-service identification: sample job names, do
      // not read free-text note bodies, count matches only.
      if (Array.isArray(ro.jobs) && jobsSampledForOilCheck < 2000) {
        for (const job of ro.jobs) {
          if (jobsSampledForOilCheck >= 2000) break;
          jobsSampledForOilCheck++;
          const name = String(job?.name ?? "").toLowerCase();
          if (name.includes("oil")) jobsWithOilInName++;
        }
      }
    }
    fillByMakeModelYear.set(modelYearKey, fyModel);

    if (usable.length >= 2) {
      vehiclesWithTwoPlusUsable++;
      usable.sort((a, b) => new Date(a.postedDate) - new Date(b.postedDate));
      let positivePlausible = 0, zero = 0, negativeOrAbsurd = 0;
      for (let i = 1; i < usable.length; i++) {
        const delta = usable[i].milesIn - usable[i - 1].milesIn;
        if (delta === 0) zero++;
        else if (delta < 0 || delta > 60000) negativeOrAbsurd++; // >60k mi between visits treated as implausible
        else positivePlausible++;
      }
      entry.deltaSummary = { positivePlausible, zero, negativeOrAbsurd };
    }
  }

  const totalDistinctVehicles = perVehicleRos.size;

  let deltaPositivePlausible = 0, deltaZero = 0, deltaNegativeOrAbsurd = 0;
  for (const [, entry] of perVehicleRos) {
    if (entry.deltaSummary) {
      deltaPositivePlausible += entry.deltaSummary.positivePlausible;
      deltaZero += entry.deltaSummary.zero;
      deltaNegativeOrAbsurd += entry.deltaSummary.negativeOrAbsurd;
    }
  }

  console.error(`Probe complete. Total HTTP requests made: ${requestCount}.`);

  console.log("\n=== TEKMETRIC PROBE RESULTS (aggregates only) ===\n");
  console.log(`Total HTTP requests made: ${requestCount} (cap ${args.maxRequests})`);
  console.log(`Window: postedDate >= ${postedDateStart} (${args.months} months)\n`);

  console.log("--- Distinct make spellings observed on all vehicles (denominator: all vehicles fetched) ---");
  for (const [make, count] of [...distinctMakesSeen.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${JSON.stringify(make)}: ${count}`);
  }

  console.log(`\n--- Target-make vehicles matched (denominator: total vehicles = ${allVehicles.length}) ---`);
  for (const [make, count] of targetMakesSeen.entries()) {
    console.log(`  ${make}: ${count}`);
  }
  console.log(`  Total target-make vehicles: ${targetVehicles.length}`);
  console.log(`  Vehicles actually queried before any request-budget stop: ${vehiclesQueried}`);

  console.log(`\n--- 1. ROs in window / vehicles (denominator: target-make vehicles queried = ${vehiclesQueried}) ---`);
  console.log(`  Total ROs in window: ${totalRos}`);
  console.log(`  Distinct vehicles queried: ${vehiclesQueried}`);
  console.log(`  Vehicles with at least 1 RO in window: ${vehiclesWithAnyRo}`);

  console.log(`\n--- 2. milesIn / milesOut fill rate (denominator: total ROs in window = ${totalRos}) ---`);
  console.log(`  milesIn:  non-null=${milesInNonNull}, null=${milesInNull}, fill rate=${totalRos ? (milesInNonNull / totalRos * 100).toFixed(1) : "n/a"}%`);
  console.log(`  milesOut: non-null=${milesOutNonNull}, null=${milesOutNull}, fill rate=${totalRos ? (milesOutNonNull / totalRos * 100).toFixed(1) : "n/a"}%`);

  console.log(`\n--- 3. Fill rate by make and RO POSTED year (year the RO's own postedDate falls in; denominator: ROs in that make+posted-year cell) ---`);
  for (const [key, fy] of [...fillByMakePostedYear.entries()].sort()) {
    const [make, postedYear] = key.split("|");
    const miPct = fy.total ? (fy.milesInFilled / fy.total * 100).toFixed(1) : "n/a";
    const moPct = fy.total ? (fy.milesOutFilled / fy.total * 100).toFixed(1) : "n/a";
    console.log(`  ${make} posted ${postedYear}: n=${fy.total}, milesIn fill=${miPct}%, milesOut fill=${moPct}%`);
  }

  console.log(`\n--- 3b. Fill rate by make and vehicle MODEL year (the vehicle's own model year, NOT when the RO was posted; denominator: ROs against vehicles of that make+model-year) ---`);
  for (const [key, fy] of [...fillByMakeModelYear.entries()].sort()) {
    const [make, modelYear] = key.split("|");
    const miPct = fy.total ? (fy.milesInFilled / fy.total * 100).toFixed(1) : "n/a";
    const moPct = fy.total ? (fy.milesOutFilled / fy.total * 100).toFixed(1) : "n/a";
    console.log(`  ${make} model-year ${modelYear}: n=${fy.total}, milesIn fill=${miPct}%, milesOut fill=${moPct}%`);
  }

  console.log(`\n--- 4. GATING NUMBER: vehicles with >=2 usable ROs (milesIn AND postedDate present) ---`);
  console.log(`  (denominator: distinct target-make vehicles queried = ${vehiclesQueried})`);
  console.log(`  Vehicles with >=2 usable ROs: ${vehiclesWithTwoPlusUsable}`);
  console.log(`  ROs-per-vehicle distribution (count of ROs -> number of vehicles):`);
  for (const [count, numVehicles] of [...rosPerVehicleHist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${count} ROs: ${numVehicles} vehicles`);
  }

  console.log(`\n--- 5. Consecutive-RO mileage delta, structural usability only (denominator: vehicles with >=2 usable ROs = ${vehiclesWithTwoPlusUsable}) ---`);
  console.log(`  Positive & plausible deltas (0 < delta <= 60,000 mi): ${deltaPositivePlausible}`);
  console.log(`  Zero deltas: ${deltaZero}`);
  console.log(`  Negative or absurd deltas (rollback or >60,000 mi jump): ${deltaNegativeOrAbsurd}`);
  console.log(`  (No median computed, per scope — this is a structural-usability check only.)`);

  console.log(`\n--- 6. Oil-service identifiability from structured fields (denominator: jobs sampled = ${jobsSampledForOilCheck}, cap 2000) ---`);
  console.log(`  Jobs whose structured "name" field contains "oil": ${jobsWithOilInName}`);
  console.log(`  Method: checked job.name only (a structured field), never job.note free text.`);
  console.log(`  Conclusion basis: if jobsWithOilInName is a small fraction of oil-service jobs actually`);
  console.log(`  performed, structured fields alone under-identify oil services and free-text reading`);
  console.log(`  would be required — this script does not read free text, so it cannot resolve that`);
  console.log(`  without further authorization to inspect note bodies (which would need its own PII review).`);

  console.log("\n=== END RESULTS ===\n");
}

main().catch((err) => {
  console.error(`Probe failed: ${err.message}`);
  process.exitCode = 1;
});
