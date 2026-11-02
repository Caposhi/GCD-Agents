/**
 * Classify the search terms that showed the Business Profile, and summarise them.
 *
 * Pure: no I/O, no clock, no environment. Input is `{ term, value?, threshold? }`
 * records (the shape `client.mjs` returns); output is plain data and text.
 *
 * ## What the buckets are for
 *
 * Google's report mixes people who already know the shop, people browsing a map
 * of the area, and people shopping for a German-car mechanic. Only the last group
 * is a content opportunity, and it is a small part of the list. The buckets make
 * that visible so a post is never written to chase "restaurants".
 *
 *   brand     the shop's own name or street — people who already know it
 *   intent    a make, "german" or "european" with a repair or service word
 *   make      a bare make ("volkswagen")
 *   category  a bare "german cars" / "european" with no service word
 *   adjacent  parts, tires, car wash — near the trade, not the trade
 *   geo       a place, address, zip code or coordinates
 *   noise     restaurants, hotels, stores
 *   other     none of the above
 *
 * ## Privacy: the report never lists a term it should not
 *
 * Searchers type their own street addresses and names. Only the buckets a
 * content writer can use — brand, intent, make, category, adjacent — are ever
 * printed term by term. `geo`, `noise` and `other` are COUNTED and never listed,
 * so a report pasted into a ticket cannot carry a stranger's home address.
 *
 * ## Claims: a search term is data, never a fact about the shop
 *
 * A term such as "bmw oil change prices" or "german cars for sale" shows what
 * people want to know. It does not make a price, a financing offer or a sales
 * lot true. The report FLAGS those terms (`needsApprovedFact`) and any service
 * the shop's approved facts do not list (`notInApprovedServices`), so nothing is
 * posted about them until the owner has attested the fact in
 * `config/approved-facts.json`.
 */

/** The makes the shop services, as `config/approved-facts.json` lists them, plus search aliases. */
export const MAKE_PATTERNS = Object.freeze([
  ["BMW", /\bbmw\b/],
  ["Mercedes-Benz", /\b(mercedes|benz|mercedes-benz)\b/],
  ["Audi", /\baudi\b/],
  ["Porsche", /\bporsche\b/],
  ["Volkswagen", /\b(volkswagen|vw)\b/],
  ["Mini Cooper", /\bmini( cooper)?\b/],
  ["Land Rover", /\b(land rover|range rover|landrover)\b/],
]);

const BRAND = /german (car|auto) depot|german depot|\b(car|auto) depot\b|f[i]{1,2}l+more st|filmore st/;
const NOISE = /restaurant|hotel|attraction|\bbar\b|barber|barberia|coffee|cafe|bakery|breakfast|\bfood\b|burger|chipotle|dunkin|publix|walmart|home depot|aldi|cvs|dollar|7-eleven|crunch fitness|carhartt|bank|\batm\b|casino|airport|a[eé]ropuerto|a[eé]roport|grocery|fedex|montessori|academy|university|library|city hall|stadium|beach|mall|trolley|bahamas|foto|apartments|lounge/;
const ADJACENT = /\bparts?\b|\btires?\b|\bponchera\b|car ?wash|wash\b|\bsalvage\b|autozone|advance auto|harbor freight|firestone|goodyear|automax/;
const SERVICE_WORDS = /repair|mechanic|mec[aá]nic|mecahnic|mechanik|taller|reparaci[oó]n|service|shop|garage|inspection|oil change|brake|transmission|battery|air conditioning|\ba\/?c\b|specialist|maintenance|body\b|diagnostic|alignment|suspension|engine|tune ?up|check engine|care\b|restore/;
const CATEGORY = /\b(german|germans|european)( (cars?|auto|autos|vehicles?|imports?|automotive|depot))?\b/;
const GEO =
  /\b(hollywood|miami|fort lauderdale|ft\.? lauderdale|florida|fl|usa|u\.s\.a?|ee\.? ?uu\.?|eua|[eé]tats-unis|stany zjednoczone|stati uniti|verenigde staten|spojen[eé] st[aá]ty|boca raton|hallandale|aventura|pompano|plantation|coral gables|cooper city|broward|doral|pembroke pines|lauderdale lakes|north miami|miami beach|oakland|nha trang|fort walton)\b|\b3[0-9]{4}\b|\b\d{1,5} ?(n|s|e|w|north|south|east|west|nw|ne|sw|se)?\.? ?\w* (st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|hwy|highway|ct|court|way|lane|ln)\b|^\d|°|^-?\d+\.\d+ ?,/;
/** Terms that ask for something the approved facts do not state: a price, financing, a sale. */
const NEEDS_FACT = /\b(price|prices|pricing|cost|costs|cheap|cheapest|afford\w*|financ\w*|for sale|sales|buy|used cars?|lease|coupon|discount|free estimate)\b/;
/** Services people search for that `config/approved-facts.json` does not list. */
const NOT_APPROVED_SERVICES = Object.freeze([
  ["air conditioning / A/C", /air conditioning|\ba\/?c\b/],
  ["battery", /battery/],
  ["tires / wheels", /\btires?\b|\bwheels?\b|\bponchera\b/],
  ["car wash / detailing", /car ?wash|detail/],
  ["body work / collision", /body (shop|work)|collision|auto body/],
  ["car sales", /for sale|\bsales\b|\bused\b|\bbuy\b|financ/],
]);
/** The in-scope services, from `config/approved-facts.json` — word forms people type. */
const APPROVED_SERVICES = Object.freeze([
  ["oil change", /oil change|oil service/],
  ["oil-leak repair", /oil leak/],
  ["brake service", /brake/],
  ["check-engine diagnostics", /check engine|diagnostic/],
  ["cooling system", /cooling|overheat|radiator/],
  ["steering & suspension", /steering|suspension/],
  ["transmission service", /transmission|mechatronic/],
  ["engine repair", /engine/],
  ["pre-purchase inspection", /pre[- ]?purchase|inspection/],
  ["scheduled maintenance", /maintenance|full car service|car service/],
]);

/** Towns that appear in the data and are NOT named in the approved service area (Hollywood, Aventura, Hallandale, Broward / South Florida). */
export const TOWNS = Object.freeze(["coral gables", "cooper city", "pompano", "boca raton", "plantation", "doral", "pembroke pines", "miami beach", "fort lauderdale", "miami"]);

/** @param {string} raw */
export function normalizeTerm(raw) {
  return String(raw ?? "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * The bucket one term belongs to. Order matters and is the rule: a term with a
 * service word is `intent` even when it names a town ("bmw repair hollywood fl").
 * @param {string} raw
 * @returns {"brand"|"intent"|"make"|"category"|"adjacent"|"geo"|"noise"|"other"}
 */
export function bucketOf(raw) {
  const t = normalizeTerm(raw);
  if (t === "") return "other";
  if (BRAND.test(t)) return "brand";
  if (NOISE.test(t)) return "noise";
  const hasMake = MAKE_PATTERNS.some(([, re]) => re.test(t));
  const hasService = SERVICE_WORDS.test(t);
  if (ADJACENT.test(t) && !hasService) return "adjacent";
  if (hasService) return "intent"; // a service word beats a town: "mecánico en hollywood" is a repair search
  if (hasMake) return /^\W*(\w+( \w+)?)\W*$/.test(t) && t.split(" ").length <= 2 ? "make" : "intent";
  if (CATEGORY.test(t) && t.split(" ").length <= 3 && !GEO.test(t)) return "category";
  if (GEO.test(t)) return "geo";
  if (ADJACENT.test(t)) return "adjacent";
  return "other";
}

/** The makes a term names, by display name. */
export function makesIn(raw) {
  const t = normalizeTerm(raw);
  return MAKE_PATTERNS.filter(([, re]) => re.test(t)).map(([name]) => name);
}

/** Flags a content writer must see before using a term. */
export function flagsOf(raw) {
  const t = normalizeTerm(raw);
  const notInApprovedServices = NOT_APPROVED_SERVICES.filter(([, re]) => re.test(t)).map(([name]) => name);
  return { needsApprovedFact: NEEDS_FACT.test(t), notInApprovedServices };
}

/**
 * @typedef {{ term: string, value?: number, threshold?: number }} TermCount
 * `value` is an exact count of unique users; `threshold` means "fewer than this".
 */

const PRINTED = new Set(["brand", "intent", "make", "category", "adjacent"]);
const ORDER = ["brand", "intent", "make", "category", "adjacent", "geo", "noise", "other"];

/**
 * @param {TermCount[]} records
 */
export function summarize(records) {
  const buckets = Object.fromEntries(ORDER.map((b) => [b, { exact: 0, terms: 0, belowThreshold: 0, list: [] }]));
  const makeDemand = new Map(MAKE_PATTERNS.map(([n]) => [n, 0]));
  const towns = new Map();
  const flagged = [];
  let exactTotal = 0;
  let belowThresholdTerms = 0;
  for (const r of records) {
    const term = normalizeTerm(r.term);
    if (term === "") continue;
    const b = bucketOf(term);
    const exact = typeof r.value === "number" && Number.isFinite(r.value);
    if (exact) {
      buckets[b].exact += r.value;
      exactTotal += r.value;
    } else {
      buckets[b].belowThreshold += 1;
      belowThresholdTerms += 1;
    }
    buckets[b].terms += 1;
    if (PRINTED.has(b)) buckets[b].list.push({ term, value: exact ? r.value : null, threshold: exact ? null : (r.threshold ?? null) });
    if (exact) for (const m of makesIn(term)) makeDemand.set(m, makeDemand.get(m) + r.value);
    if (b === "geo" || b === "intent") for (const t of TOWNS) if (term.includes(t) && t !== "miami") towns.set(t, (towns.get(t) ?? 0) + (exact ? r.value : 0));
    const f = flagsOf(term);
    if (PRINTED.has(b) && (f.needsApprovedFact || f.notInApprovedServices.length > 0)) flagged.push({ term, ...f });
  }
  for (const b of Object.values(buckets)) b.list.sort((x, y) => (y.value ?? -1) - (x.value ?? -1) || x.term.localeCompare(y.term));
  return { exactTotal, belowThresholdTerms, buckets, makeDemand: Object.fromEntries(makeDemand), towns: Object.fromEntries(towns), flagged };
}

const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a");

/**
 * The text report. Terms are printed for the content buckets only.
 * @param {ReturnType<typeof summarize>} s
 * @param {{ range?: string, topN?: number }} [opts]
 */
export function formatReport(s, opts = {}) {
  const topN = opts.topN ?? 25;
  const out = [];
  out.push("GBP search-demand report (read-only)");
  if (opts.range) out.push(`Range: ${opts.range}`);
  out.push(
    `Counted searches (terms with an exact count): ${s.exactTotal}. Terms returned only as "below a threshold": ${s.belowThresholdTerms} — their volume is unknown, not zero.`,
  );
  out.push("");
  out.push("| Bucket | Searches | Share | Terms | Below-threshold terms |");
  out.push("|---|---:|---:|---:|---:|");
  for (const b of ORDER) {
    const x = s.buckets[b];
    out.push(`| ${b} | ${x.exact} | ${pct(x.exact, s.exactTotal)} | ${x.terms} | ${x.belowThreshold} |`);
  }
  out.push("");
  out.push("Terms are listed below only for buckets a content writer can use. geo, noise and other are counted and never listed (searchers type their own addresses).");
  for (const b of ["intent", "make", "category", "brand", "adjacent"]) {
    const list = s.buckets[b].list;
    if (list.length === 0) continue;
    out.push("");
    out.push(`## ${b} (${list.length} terms${list.length > topN ? `, top ${topN}` : ""})`);
    for (const e of list.slice(0, topN)) out.push(`- ${e.term} — ${e.value ?? `below ${e.threshold ?? "threshold"}`}`);
  }
  const makeTotal = Object.values(s.makeDemand).reduce((a, b) => a + b, 0);
  out.push("");
  out.push("## Make demand (exact counts only) against an equal 1-in-7 rotation");
  for (const [m, v] of Object.entries(s.makeDemand).sort((a, b) => b[1] - a[1])) out.push(`- ${m}: ${v} (${pct(v, makeTotal)} of make-named searches; rotation share 14.3%)`);
  const towns = Object.entries(s.towns).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (towns.length) {
    out.push("");
    out.push("## Places named in searches (counts only; compare with the approved service area before naming any in a post)");
    for (const [t, v] of towns) out.push(`- ${t}: ${v}`);
  }
  if (s.flagged.length) {
    out.push("");
    out.push("## Do not post about these until the owner has attested the fact in config/approved-facts.json");
    for (const f of s.flagged.slice(0, topN)) {
      const why = [f.needsApprovedFact ? "price / financing / sale wording" : "", f.notInApprovedServices.length ? `service not in approved facts: ${f.notInApprovedServices.join(", ")}` : ""].filter(Boolean).join("; ");
      out.push(`- ${f.term} — ${why}`);
    }
  }
  out.push("");
  out.push("A search term is data, not a claim about the shop. Nothing here changes a post, a brief or an approved fact.");
  return out.join("\n");
}
