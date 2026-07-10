/**
 * Daily content calendar. Every post pairs ONE make with ONE specific service,
 * so the feed is concrete and varied. The matrix is 7 makes × 10 services = 70
 * unique combinations; because gcd(7,10)=1, indexing make by (i % 7) and service
 * by (i % 10) walks all 70 pairs exactly once over a 70-day cycle (CRT), and each
 * day advances BOTH make and service so no make or service repeats back-to-back.
 *
 * On the 1st of each month we run one brand-story post instead (family / warranty
 * / dealership-alternative / the Ollie story), rotating monthly.
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

/** One brand-story post per month (1st of the month), rotating. */
export const BRAND_THEMES: CalendarTheme[] = [
  { key: "brand-family", goal: "Brand story: family-owned by the Gelfand family in Hollywood, FL since 1992; founder Alan 'Ollie' Gelfand is a Bosch Certified & ASE Master Technician who still oversees the shop. POMG — Peace of Mind Guaranteed." },
  { key: "brand-warranty", goal: "Brand story: the 3-Year / 36,000-Mile warranty on qualifying parts & labor, and the peace of mind that stands behind every repair." },
  { key: "brand-dealership-alternative", goal: "Brand story: The Dealership Alternative — dealer-level expertise on European cars without dealer pricing or pressure." },
  { key: "brand-ollie", goal: "Fun brand story: founder Alan 'Ollie' Gelfand is credited as the inventor of the skateboarding 'Ollie' — tie that precision and innovation to how the shop cares for European cars." },
];

/** Total make×service combinations — this is the recycle window (in days). */
export const TOTAL_VARIATIONS = MAKES.length * SERVICES.length; // 70

/** UTC day-of-year (1–366), the deterministic rotation index. */
export function dayOfYearUTC(d: Date): number {
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 0);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((today - startOfYear) / 86_400_000);
}

export interface DailyBrief {
  goal: string;
  theme: string;
  kind: "make-service" | "brand";
  make?: string;
  service?: string;
  serviceKey?: string;
}

/** The brief the scheduler enqueues for a given date. */
export function briefForDate(d: Date): DailyBrief {
  // One brand-story post per month, on the 1st.
  if (d.getUTCDate() === 1) {
    const t = BRAND_THEMES[d.getUTCMonth() % BRAND_THEMES.length]!;
    return {
      goal: `${t.goal} Open with a warm, benefit-driven hook, then keep it human and specific. One clear CTA to book online.`,
      theme: t.key,
      kind: "brand",
    };
  }

  const i = dayOfYearUTC(d) % TOTAL_VARIATIONS;
  const make = MAKES[i % MAKES.length]!;
  const svc = SERVICES[i % SERVICES.length]!; // CRT: unique (make, service) across the 70-day cycle
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
