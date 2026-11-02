/**
 * Read-only client for the Business Profile Performance API's monthly search
 * keywords: `GET /v1/locations/{locationId}/searchkeywords/impressions/monthly`.
 *
 * Reference (verified 2026-10-28 against Google's REST page for
 * `locations.searchkeywords.impressions.monthly.list`): host
 * `businessprofileperformance.googleapis.com`; required `monthlyRange` with
 * inclusive start and end months (query names `monthlyRange.start_month.year`
 * and so on, as the page's own example writes them); `pageSize` up to 100;
 * `pageToken`; scope `https://www.googleapis.com/auth/business.manage`; each
 * `searchKeywordsCounts[]` entry carries a lower-cased `searchKeyword` and an
 * `insightsValue` of EITHER `value` (unique users, summed over the range) OR
 * `threshold` (the true count is below it). The page states no maximum range.
 *
 * ## What this file never does
 *
 *   - It sends only `GET` to one fixed host, and `POST` only to Google's token
 *     endpoint to exchange the refresh token. It writes nothing to the profile.
 *   - It follows no redirect: a redirect would carry the bearer token to a host
 *     this file did not choose, so `redirect: "error"` is set on every request.
 *   - It never returns, logs or puts in an error message a token, a client
 *     secret or a response body. Failures are fixed strings plus a status code.
 *
 * Network access is injected (`fetchImpl`) so the offline suite drives every path
 * with a stub and no socket is ever opened by a test.
 */

export const PERFORMANCE_HOST = "businessprofileperformance.googleapis.com";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPE = "https://www.googleapis.com/auth/business.manage";
const MAX_PAGES = 50; // 5,000 terms: far beyond any single profile's list, and a bound on a runaway token loop
const TIMEOUT_MS = 15_000;

/** A numeric Google location id — digits only, so it can never alter the request path. */
export function validateLocationId(id) {
  const v = String(id ?? "").trim().replace(/^locations\//, "");
  if (!/^[0-9]{5,25}$/.test(v)) throw new Error("GBP_LOCATION_ID must be the numeric location id (digits only)");
  return v;
}

/** @param {{year:number,month:number}} d */
const okMonth = (d) => Number.isInteger(d?.year) && d.year >= 2020 && d.year <= 2100 && Number.isInteger(d?.month) && d.month >= 1 && d.month <= 12;

/**
 * The request URL. No credential is ever in it.
 * @param {string} locationId
 * @param {{year:number,month:number}} start inclusive
 * @param {{year:number,month:number}} end inclusive
 * @param {string} [pageToken]
 */
export function buildUrl(locationId, start, end, pageToken) {
  if (!okMonth(start) || !okMonth(end)) throw new Error("monthlyRange needs a valid year and month for start and end");
  if (start.year * 12 + start.month > end.year * 12 + end.month) throw new Error("monthlyRange start is after its end");
  const loc = validateLocationId(locationId);
  const u = new URL(`https://${PERFORMANCE_HOST}/v1/locations/${loc}/searchkeywords/impressions/monthly`);
  u.searchParams.set("monthlyRange.start_month.year", String(start.year));
  u.searchParams.set("monthlyRange.start_month.month", String(start.month));
  u.searchParams.set("monthlyRange.end_month.year", String(end.year));
  u.searchParams.set("monthlyRange.end_month.month", String(end.month));
  u.searchParams.set("pageSize", "100");
  if (pageToken) u.searchParams.set("pageToken", pageToken);
  return u.toString();
}

/**
 * The last `months` COMPLETE calendar months before `now`, inclusive, UTC.
 * @param {Date} now
 * @param {number} months 1–12
 */
export function lastCompleteMonths(now, months) {
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new Error("--months must be a whole number from 1 to 12");
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based current month => 1-based previous month
  if (m === 0) { y -= 1; m = 12; }
  const end = { year: y, month: m };
  let sy = y;
  let sm = m - (months - 1);
  while (sm < 1) { sm += 12; sy -= 1; }
  return { start: { year: sy, month: sm }, end };
}

/**
 * Parse one response page. Exactly one of `value` / `threshold` is trusted per term.
 * @returns {{ records: {term:string,value?:number,threshold?:number}[], nextPageToken?: string }}
 */
export function parsePage(json) {
  if (json === null || typeof json !== "object") throw new Error("unexpected response shape");
  const list = json.searchKeywordsCounts ?? [];
  if (!Array.isArray(list)) throw new Error("unexpected response shape");
  const records = [];
  for (const e of list) {
    if (typeof e?.searchKeyword !== "string") continue;
    const iv = e.insightsValue ?? {};
    const value = iv.value !== undefined ? Number(iv.value) : undefined;
    const threshold = iv.threshold !== undefined ? Number(iv.threshold) : undefined;
    if (value !== undefined && Number.isFinite(value)) records.push({ term: e.searchKeyword, value });
    else if (threshold !== undefined && Number.isFinite(threshold)) records.push({ term: e.searchKeyword, threshold });
    else records.push({ term: e.searchKeyword });
  }
  const next = typeof json.nextPageToken === "string" && json.nextPageToken !== "" ? json.nextPageToken : undefined;
  return { records, nextPageToken: next };
}

function signal() {
  return AbortSignal.timeout(TIMEOUT_MS);
}

/**
 * Exchange the refresh token for a short-lived access token. The secrets are in a
 * POST body to Google only, with redirects refused.
 * @param {{ refreshToken: string, clientId: string, clientSecret: string }} c
 * @param {typeof fetch} fetchImpl
 */
export async function refreshAccessToken(c, fetchImpl = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" }),
    redirect: "error",
    signal: signal(),
  });
  if (!res.ok) throw new Error(`google token refresh failed (HTTP ${res.status})`);
  const json = await res.json().catch(() => null);
  if (typeof json?.access_token !== "string" || json.access_token === "") throw new Error("google token refresh returned no access token");
  return json.access_token;
}

/**
 * Every search keyword for the range, across pages.
 * @param {{ locationId: string, start: object, end: object, accessToken: string, fetchImpl?: typeof fetch }} o
 */
export async function fetchMonthlyKeywords(o) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const records = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchImpl(buildUrl(o.locationId, o.start, o.end, pageToken), {
      method: "GET",
      headers: { authorization: `Bearer ${o.accessToken}`, accept: "application/json" },
      redirect: "error",
      signal: signal(),
    });
    if (!res.ok) {
      const hint =
        res.status === 403 ? " — the Business Profile Performance API may not be enabled for the Google Cloud project, or the account has no quota for it"
        : res.status === 401 ? " — the access token was refused"
        : res.status === 404 ? " — check GBP_LOCATION_ID"
        : res.status === 429 ? " — quota exceeded; try again later"
        : "";
      throw new Error(`performance API request failed (HTTP ${res.status})${hint}`);
    }
    const json = await res.json().catch(() => null);
    const parsed = parsePage(json);
    records.push(...parsed.records);
    if (!parsed.nextPageToken) return records;
    pageToken = parsed.nextPageToken;
  }
  throw new Error(`stopped after ${MAX_PAGES} pages; the response kept paging`);
}
