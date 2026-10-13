/**
 * Content calendar. Every post pairs ONE make with ONE specific service,
 * so the feed is concrete and varied. The matrix is 7 makes × 10 services = 70
 * unique combinations; because gcd(7,10)=1, indexing make by (i % 7) and service
 * by (i % 10) walks all 70 pairs exactly once over 70 consecutive posts (CRT),
 * and each post advances BOTH make and service so no make or service repeats
 * back-to-back.
 *
 * CADENCE: three posts a week, on Monday, Wednesday and Friday (UTC weekdays 1,
 * 3 and 5). The scheduler's cron still fires every day; on any other weekday
 * `briefForDate` returns null and nothing is enqueued.
 *
 * The rotation index `i` counts POSTING SLOTS from a fixed Monday, not calendar
 * days. An earlier edition indexed by day-of-year, which only works for a daily
 * schedule: 7 divides 70, so the make was then fixed by the weekday, and any
 * three-weekday schedule showed just three of the seven makes (and 30 of the 70
 * combinations) for a whole year. Counting slots advances the index by exactly
 * one per post, whatever the weekdays are.
 *
 * On the FIRST POSTING DAY of each UTC month we run one brand-story post instead
 * (family / warranty / dealership-alternative / the Ollie story), rotating
 * monthly. That post takes the slot, so it skips that slot's make×service
 * combination for the current pass through the cycle.
 *
 * Each brief is only a GOAL + structured make/service fields — the copywriter
 * writes fresh copy every time and the brand-compliance critic verifies every
 * claim against config/approved-facts.json, so the calendar can't introduce an
 * unsourced claim. All services below map to approved-facts "services".
 */

export interface CalendarTheme {
  key: string;
  goal: string;
}

/** All seven makes German Car Depot services (from approved-facts). */
export const MAKES = [
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Porsche",
  "Volkswagen",
  "Mini Cooper",
  "Land Rover",
] as const;

export interface ServiceDef {
  key: string;
  label: string;
  angle: string; // a hint for the copywriter; NOT a claim
}

/** Ten specific services, each grounded in approved-facts "services". */
export const SERVICES: ServiceDef[] = [
  { key: "oil-change", label: "Oil & Filter Change", angle: "on-time oil service protects the engine; the correct oil and filter for this make" },
  { key: "brakes", label: "Brake Service", angle: "safety first; catching pad wear before it scores the rotors" },
  { key: "diagnostics", label: "Check-Engine Diagnostics", angle: "factory-grade diagnostics (ISTA/D for BMW, XENTRY for Mercedes); test first, fix once" },
  { key: "cooling", label: "Cooling System Service", angle: "South Florida heat is brutal on cooling systems; prevent an overheating breakdown" },
  { key: "steering-suspension", label: "Steering & Suspension", angle: "a smoother, safer ride and even tire wear" },
  { key: "transmission", label: "Transmission Service", angle: "smooth shifting and long transmission life" },
  { key: "engine-repair", label: "Engine Repair", angle: "trustworthy diagnosis and repair of engine issues by ASE Master-level techs" },
  { key: "oil-leak", label: "Oil-Leak Repair", angle: "spotting and fixing leaks early protects the engine and keeps the driveway clean" },
  { key: "maintenance", label: "Scheduled Maintenance", angle: "staying on the manufacturer's service schedule keeps repair costs predictable" },
  { key: "ppi", label: "Pre-Purchase Inspection", angle: "buying a used one? know exactly what you're getting before you sign" },
];

/** One brand-story post per month (the first posting day of the month), rotating. */
export const BRAND_THEMES: CalendarTheme[] = [
  { key: "brand-family", goal: "Brand story: family-owned by the Gelfand family in Hollywood, FL since 1992; founder Alan 'Ollie' Gelfand is a Bosch Certified & ASE Master Technician who still oversees the shop. POMG — Peace of Mind Guaranteed." },
  { key: "brand-warranty", goal: "Brand story: the 3-Year / 36,000-Mile warranty on qualifying parts & labor, and the peace of mind that stands behind every repair." },
  { key: "brand-dealership-alternative", goal: "Brand story: The Dealership Alternative — dealer-level expertise on European cars without dealer pricing or pressure." },
  { key: "brand-ollie", goal: "Fun brand story: founder Alan 'Ollie' Gelfand is credited as the inventor of the skateboarding 'Ollie' — tie that precision and innovation to how the shop cares for European cars." },
];

/** Total make×service combinations — this is the recycle window (in posts). */
export const TOTAL_VARIATIONS = MAKES.length * SERVICES.length; // 70

/**
 * Posting days as UTC weekdays (0 = Sunday): Monday, Wednesday, Friday.
 * Ascending, because a day's position in this list is its position in the week.
 */
export const POSTING_WEEKDAYS: readonly number[] = [1, 3, 5];

/** Posts per week. At three a week the 70-combination cycle takes about 23 weeks. */
export const POSTS_PER_WEEK = POSTING_WEEKDAYS.length;

const MS_PER_DAY = 86_400_000;

/**
 * Slot 0 is Monday 2024-01-01 (UTC). The anchor must be a Monday so that whole
 * weeks counted from it start on a Monday and every posting weekday falls in
 * its own week; `contentCalendar.selftest.ts` asserts that it is.
 */
const SLOT_ANCHOR_DAY = Date.UTC(2024, 0, 1) / MS_PER_DAY;

/** The UTC calendar date of `d` as a whole number of days since the Unix epoch. */
function utcDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY);
}

/** True when `d`'s UTC date is a scheduled posting day (Monday, Wednesday or Friday). */
export function isPostingDay(d: Date): boolean {
  return POSTING_WEEKDAYS.includes(d.getUTCDay());
}

/** The first posting day on or after `d`'s UTC date, as a Date at 00:00 UTC. */
export function nextPostingDay(d: Date): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  while (!isPostingDay(day)) day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

/**
 * The zero-based posting slot of a posting day — how many posting days lie
 * between slot 0 and it — or null when `d` is not a posting day. This is the
 * rotation index: it advances by exactly one per post.
 */
export function postingSlot(d: Date): number | null {
  const position = POSTING_WEEKDAYS.indexOf(d.getUTCDay());
  if (position === -1) return null;
  const weeks = Math.floor((utcDayNumber(d) - SLOT_ANCHOR_DAY) / 7);
  return weeks * POSTS_PER_WEEK + position;
}

/** True when `d` is the first posting day of its UTC month — the brand-story slot. */
export function isFirstPostingDayOfMonth(d: Date): boolean {
  if (!isPostingDay(d)) return false;
  for (let day = 1; day < d.getUTCDate(); day++) {
    if (isPostingDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), day)))) return false;
  }
  return true;
}

export interface DailyBrief {
  goal: string;
  theme: string;
  kind: "make-service" | "brand";
  make?: string;
  service?: string;
  serviceKey?: string;
}

export interface BriefForDateOptions {
  /**
   * On a day with no scheduled post, use the NEXT posting day's brief instead of
   * returning null. For an owner re-running the scheduler by hand.
   */
  force?: boolean;
}

/**
 * The brief the scheduler enqueues for a given date, or null when that date is
 * not a posting day (and `force` is not set).
 */
export function briefForDate(d: Date, options: BriefForDateOptions = {}): DailyBrief | null {
  const day = isPostingDay(d) ? d : options.force ? nextPostingDay(d) : null;
  if (day === null) return null;

  // One brand-story post per month, on the first posting day.
  if (isFirstPostingDayOfMonth(day)) {
    const t = BRAND_THEMES[day.getUTCMonth() % BRAND_THEMES.length]!;
    return {
      goal: `${t.goal} Open with a warm, benefit-driven hook, then keep it human and specific. One clear CTA to book online.`,
      theme: t.key,
      kind: "brand",
    };
  }

  const slot = postingSlot(day)!; // `day` is a posting day, so the slot exists
  const i = ((slot % TOTAL_VARIATIONS) + TOTAL_VARIATIONS) % TOTAL_VARIATIONS;
  const make = MAKES[i % MAKES.length]!;
  const svc = SERVICES[i % SERVICES.length]!; // CRT: unique (make, service) across 70 consecutive posts
  return {
    goal:
      `Feature ${make} ${svc.label}. Angle: ${svc.angle}. ` +
      `Open with a customer-benefit hook (the feeling/outcome), THEN make it specific to the ${make} and to ${svc.label}. ` +
      `One clear call to action to book online. Keep every claim within the approved facts.`,
    theme: `${make}:${svc.key}`,
    kind: "make-service",
    make,
    service: svc.label,
    serviceKey: svc.key,
  };
}
