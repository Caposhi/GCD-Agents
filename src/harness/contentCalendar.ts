/**
 * Daily content calendar for automated posting. A fixed rotation of on-brand
 * themes so each day's post is genuinely different (repetitive content reads as
 * spam and gets suppressed by the platforms). The scheduler picks one theme per
 * day deterministically by day-of-year, so the rotation is reproducible and never
 * repeats within a cycle.
 *
 * Each theme is only a GOAL (a directive to the manager). The copywriter writes
 * fresh copy every time and the brand-compliance critic verifies every claim
 * against config/approved-facts.json — so the calendar can't introduce an
 * unsourced claim. Keep goals grounded in approved facts.
 */

export interface CalendarTheme {
  key: string;
  goal: string;
}

// 30 themes → a full-month rotation before any theme recycles. Each recurrence
// still gets freshly generated copy + image, so no two days are identical.
export const CONTENT_CALENDAR: CalendarTheme[] = [
  {
    key: "routine-maintenance",
    goal: "Friendly reminder to book routine European-car maintenance online before small issues become big ones.",
  },
  {
    key: "factory-diagnostics",
    goal: "Highlight factory-grade diagnostics — ISTA/D for BMW and XENTRY for Mercedes — and the 'test first, fix once' approach.",
  },
  {
    key: "dealership-alternative",
    goal: "Position German Car Depot as The Dealership Alternative: dealer-level expertise on European cars without dealer pricing or pressure.",
  },
  {
    key: "warranty-peace-of-mind",
    goal: "Explain the 2-Year / 24,000-Mile warranty on qualifying parts and labor and the peace of mind it gives owners.",
  },
  {
    key: "gelfand-family-story",
    goal: "Tell the family-owned story: serving Hollywood, FL since 1992; founder Alan 'Ollie' Gelfand is a Bosch Certified and ASE Master Technician who still oversees the shop.",
  },
  {
    key: "ollie-funfact",
    goal: "Fun brand story: founder Alan 'Ollie' Gelfand is widely credited as the inventor of the skateboarding 'Ollie' — tie his precision and innovation to the care the shop gives European cars.",
  },
  {
    key: "cooling-system-summer",
    goal: "South Florida heat is hard on cooling systems — encourage a cooling-system service/check before a hot-weather breakdown.",
  },
  {
    key: "spotlight-bmw",
    goal: "BMW owner spotlight: specialized BMW service and ISTA/D diagnostics from independent specialists who know the marque.",
  },
  {
    key: "spotlight-mercedes",
    goal: "Mercedes-Benz owner spotlight: XENTRY diagnostics and expert Mercedes service without dealer pricing.",
  },
  {
    key: "spotlight-audi",
    goal: "Audi owner spotlight: precise European service from technicians who specialize in the make.",
  },
  {
    key: "spotlight-porsche",
    goal: "Porsche owner spotlight: meticulous service for European performance cars, dealer-level expertise without dealer pressure.",
  },
  {
    key: "spotlight-vw",
    goal: "Volkswagen owner spotlight: dependable, specialized VW service and diagnostics.",
  },
  {
    key: "spotlight-mini",
    goal: "Mini Cooper owner spotlight: expert care for these European cars from specialists who know them well.",
  },
  {
    key: "spotlight-landrover",
    goal: "Land Rover owner spotlight: specialized service and diagnostics for European/British marques.",
  },
  {
    key: "brake-service",
    goal: "Brake service and safety: encourage owners to get brakes inspected, framed around confidence and safety on South Florida roads.",
  },
  {
    key: "oil-change",
    goal: "Oil change service: keep a European engine healthy with proper, on-schedule oil service.",
  },
  {
    key: "check-engine-diagnostics",
    goal: "Check-engine light on? Explain check-engine diagnostics — fault codes traced before any repair, so you fix the right thing once.",
  },
  {
    key: "engine-repair",
    goal: "Engine repair expertise: trustworthy diagnosis and repair for European engines from ASE Master-level technicians.",
  },
  {
    key: "oil-leak-repair",
    goal: "Oil-leak repair: spotting drips early protects the engine — encourage owners to have leaks diagnosed and fixed properly.",
  },
  {
    key: "transmission-service",
    goal: "Transmission service: smooth shifting and longevity through proper European-car transmission care.",
  },
  {
    key: "steering-suspension",
    goal: "Steering & suspension service: a smoother, safer ride and even tire wear — get worn components checked.",
  },
  {
    key: "pre-purchase-inspection",
    goal: "Buying a used European car? Recommend a pre-purchase inspection so buyers know what they're getting before they sign.",
  },
  {
    key: "oem-parts-trust",
    goal: "Why it matters: genuine OEM or OEM-quality parts, explained and approved upfront — quality you can trust.",
  },
  {
    key: "written-estimate",
    goal: "No surprises: every job starts with a written estimate you approve before any work begins.",
  },
  {
    key: "loaner-rideshare",
    goal: "Stay mobile while we work: loaner vehicles available (ask when booking) and free rideshare on approved repairs.",
  },
  {
    key: "financing-options",
    goal: "Unexpected repair? Financing is available — apply at the counter — so necessary work doesn't have to wait.",
  },
  {
    key: "same-week-appointments",
    goal: "Convenience angle: same-week appointments are often available — book online and get back on the road sooner.",
  },
  {
    key: "trusted-by-neighbors",
    goal: "Community trust: 25,000+ German & European vehicles repaired in Hollywood, FL since 1992 — invite neighbors to book online.",
  },
  {
    key: "serving-broward",
    goal: "Service-area shout-out: proudly serving Hollywood, Aventura, Hallandale, and the greater Broward / South Florida area.",
  },
  {
    key: "pomg-peace-of-mind",
    goal: "Brand tagline focus: POMG — Peace of Mind Guaranteed, the Gelfand family motto — what it means for every customer.",
  },
];

/** UTC day-of-year (1–366), used as the deterministic rotation index. */
export function dayOfYearUTC(d: Date): number {
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 0);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((today - startOfYear) / 86_400_000);
}

export function themeForDate(d: Date): CalendarTheme {
  const idx = dayOfYearUTC(d) % CONTENT_CALENDAR.length;
  return CONTENT_CALENDAR[idx]!;
}

/** The brief object the scheduler enqueues for a given date. */
export function briefForDate(d: Date): { goal: string; theme: string; source: string } {
  const t = themeForDate(d);
  return { goal: t.goal, theme: t.key, source: "scheduler" };
}
