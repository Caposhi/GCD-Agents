/**
 * Offline self-test for the content calendar's three-posts-a-week cadence.
 * Pure date arithmetic: no database, no network, no model, no clock — every
 * date is built explicitly in UTC, so the result cannot depend on when or where
 * it runs.
 */

import {
  BRAND_THEMES,
  MAKES,
  POSTING_WEEKDAYS,
  POSTS_PER_WEEK,
  SERVICES,
  TOTAL_VARIATIONS,
  briefForDate,
  isFirstPostingDayOfMonth,
  isPostingDay,
  nextPostingDay,
  postingSlot,
} from "./contentCalendar.js";

let checks = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  checks++;
  if (ok) console.log(`PASS  ${name}`);
  else {
    console.log(`FAIL  ${name}`);
    failures.push(name);
  }
}

const DAY_MS = 86_400_000;
const utc = (y: number, m: number, d: number, h = 13): Date => new Date(Date.UTC(y, m - 1, d, h));
const iso = (d: Date): string => d.toISOString().slice(0, 10);
/** Every UTC date from `from` to `to` inclusive, at 13:00 UTC like the cron. */
function days(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) out.push(new Date(t));
  return out;
}

// --- the schedule itself -------------------------------------------------------------------
check(
  "CAL1. the posting days are exactly Monday, Wednesday and Friday, ascending, three a week",
  JSON.stringify(POSTING_WEEKDAYS) === "[1,3,5]" && POSTS_PER_WEEK === 3,
);
check(
  "CAL2. the slot anchor is a Monday and is slot 0",
  utc(2024, 1, 1).getUTCDay() === 1 && postingSlot(utc(2024, 1, 1)) === 0,
);
{
  // Monday 2026-10-12 … Sunday 2026-10-18.
  const week = days(utc(2026, 10, 12), utc(2026, 10, 18));
  check(
    "CAL3. Monday, Wednesday and Friday are posting days; Tuesday, Thursday, Saturday and Sunday are not",
    week.map(isPostingDay).join() === "true,false,true,false,true,false,false",
  );
  check(
    "CAL4. an off day has no brief, and a posting day has one, at any time of day",
    week.every((d, i) => {
      const expected = [true, false, true, false, true, false, false][i]!;
      return [0, 13, 23].every((h) => {
        const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 59));
        return (briefForDate(at) !== null) === expected;
      });
    }),
  );
}

// --- the rotation index: one slot per post, with no gaps ------------------------------------
{
  const span = days(utc(2022, 1, 1), utc(2029, 12, 31)).filter(isPostingDay);
  let consecutive = true;
  let nonPostingSlot = false;
  for (let k = 1; k < span.length; k++) {
    if (postingSlot(span[k]!) !== postingSlot(span[k - 1]!)! + 1) consecutive = false;
  }
  for (const d of days(utc(2026, 1, 1), utc(2026, 12, 31))) {
    if (!isPostingDay(d) && postingSlot(d) !== null) nonPostingSlot = true;
  }
  check(
    `CAL5. across ${span.length} posting days from 2022 to 2029 (years, leap days and the anchor included) the slot advances by exactly one per post`,
    consecutive,
  );
  check("CAL6. a day that is not a posting day has no slot", !nonPostingSlot);
}

// --- the regression this design exists to prevent -------------------------------------------
{
  const summarize = (from: Date, to: Date) => {
    const makes = new Map<string, number>();
    const combos = new Set<string>();
    let brand = 0;
    let posts = 0;
    for (const d of days(from, to)) {
      const b = briefForDate(d);
      if (b === null) continue;
      posts++;
      if (b.kind === "brand") {
        brand++;
        continue;
      }
      makes.set(b.make!, (makes.get(b.make!) ?? 0) + 1);
      combos.add(b.theme);
    }
    const counts = [...makes.values()];
    return { posts, brand, makes: makes.size, combos: combos.size, spread: Math.max(...counts) - Math.min(...counts) };
  };
  const rest2026 = summarize(utc(2026, 10, 14), utc(2026, 12, 31));
  const y2027 = summarize(utc(2027, 1, 1), utc(2027, 12, 31));
  const twoYears = summarize(utc(2027, 1, 1), utc(2028, 12, 31));
  check(
    `CAL7. the rest of 2026 features all ${MAKES.length} makes (day-of-year indexing on three fixed weekdays showed only 3): ${JSON.stringify(rest2026)}`,
    rest2026.makes === MAKES.length,
  );
  check(
    `CAL8. a whole year features all ${MAKES.length} makes, all ${TOTAL_VARIATIONS} make×service combinations, and no make is favoured by more than 4 posts: ${JSON.stringify(y2027)}`,
    y2027.makes === MAKES.length && y2027.combos === TOTAL_VARIATIONS && y2027.spread <= 4,
  );
  check(
    `CAL9. over two years the make counts stay balanced (spread at most 4) and all combinations recur: ${JSON.stringify(twoYears)}`,
    twoYears.makes === MAKES.length && twoYears.combos === TOTAL_VARIATIONS && twoYears.spread <= 4,
  );
  check(
    "CAL10. 2027 holds 157 posts (52 weeks × 3 plus its 53rd Friday), 12 of them the monthly brand posts",
    y2027.posts === 157 && y2027.brand === 12,
  );
}
{
  let repeats = 0;
  let pairs = 0;
  let previous: ReturnType<typeof briefForDate> = null;
  for (const d of days(utc(2026, 10, 12), utc(2028, 12, 31))) {
    const b = briefForDate(d);
    if (b === null) continue;
    if (b.kind === "make-service" && previous?.kind === "make-service") {
      pairs++;
      if (b.make === previous.make || b.serviceKey === previous.serviceKey) repeats++;
    }
    previous = b;
  }
  check(`CAL11. no make or service repeats between consecutive make×service posts (${pairs} consecutive pairs checked)`, pairs > 200 && repeats === 0);
}

// --- the monthly brand post ------------------------------------------------------------------
{
  let months = 0;
  let wrongCount = 0;
  let wrongTheme = 0;
  for (let y = 2026; y <= 2028; y++) {
    for (let m = 1; m <= 12; m++) {
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of the next month
      const inMonth = days(utc(y, m, 1), utc(y, m, lastDay));
      const brandDays = inMonth.filter((d) => briefForDate(d)?.kind === "brand");
      const firstPosting = inMonth.find(isPostingDay)!;
      months++;
      if (brandDays.length !== 1 || iso(brandDays[0]!) !== iso(firstPosting)) wrongCount++;
      if (briefForDate(firstPosting)!.theme !== BRAND_THEMES[(m - 1) % BRAND_THEMES.length]!.key) wrongTheme++;
    }
  }
  check(`CAL12. every one of ${months} months from 2026 to 2028 has exactly one brand post, on its first posting day`, wrongCount === 0);
  check("CAL13. the brand theme rotates by month through the four stories", wrongTheme === 0);
}
check(
  "CAL14. concrete first posting days: Fri 2026-10-02, Mon 2026-11-02, Wed 2026-12-02, and Fri 2027-01-01 when the 1st itself is one",
  briefForDate(utc(2026, 10, 2))!.kind === "brand"
    && briefForDate(utc(2026, 10, 5))!.kind === "make-service"
    && briefForDate(utc(2026, 11, 2))!.kind === "brand"
    && briefForDate(utc(2026, 12, 2))!.kind === "brand"
    && briefForDate(utc(2027, 1, 1))!.kind === "brand"
    && isFirstPostingDayOfMonth(utc(2027, 1, 1))
    && !isFirstPostingDayOfMonth(utc(2027, 1, 4)),
);

// --- what a make×service brief says -----------------------------------------------------------
{
  const b = briefForDate(utc(2026, 10, 14))!;
  const svc = SERVICES.find((s) => s.key === b.serviceKey)!;
  check(
    "CAL15. a make×service brief names its make and service, in its goal, its theme and its fields",
    b.kind === "make-service"
      && b.theme === `${b.make}:${b.serviceKey}`
      && b.goal.startsWith(`Feature ${b.make} ${b.service}.`)
      && b.goal.includes(svc.angle)
      && MAKES.includes(b.make as (typeof MAKES)[number]),
  );
  check("CAL16. the same date always gives the same brief", JSON.stringify(briefForDate(utc(2026, 10, 14))) === JSON.stringify(briefForDate(utc(2026, 10, 14, 1))));
}

// --- forcing an off day -------------------------------------------------------------------------
{
  const tuesday = utc(2026, 10, 13);
  check("CAL17. nextPostingDay of an off day is the next posting day, and of a posting day is itself", iso(nextPostingDay(tuesday)) === "2026-10-14" && iso(nextPostingDay(utc(2026, 10, 17))) === "2026-10-19" && iso(nextPostingDay(utc(2026, 10, 16))) === "2026-10-16");
  check(
    "CAL18. --force on an off day returns exactly the next posting day's brief; without it there is none",
    briefForDate(tuesday) === null
      && JSON.stringify(briefForDate(tuesday, { force: true })) === JSON.stringify(briefForDate(utc(2026, 10, 14)))
      && JSON.stringify(briefForDate(utc(2026, 10, 17), { force: true })) === JSON.stringify(briefForDate(utc(2026, 10, 19))),
  );
  check(
    "CAL19. --force on a posting day changes nothing",
    JSON.stringify(briefForDate(utc(2026, 10, 14), { force: true })) === JSON.stringify(briefForDate(utc(2026, 10, 14))),
  );
  check(
    "CAL20. --force across a month end uses the next month's first posting day, so it is that month's brand post",
    briefForDate(utc(2026, 10, 31), { force: true })!.kind === "brand"
      && JSON.stringify(briefForDate(utc(2026, 10, 31), { force: true })) === JSON.stringify(briefForDate(utc(2026, 11, 2))),
  );
}

console.log(failures.length === 0
  ? `content calendar self-test: ALL PASS (${checks} checks — Mon/Wed/Fri cadence, post-count rotation, brand post, --force)`
  : `content calendar self-test: ${failures.length} FAILED of ${checks}`);
if (failures.length > 0) process.exit(1);
