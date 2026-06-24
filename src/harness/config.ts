/**
 * Central runtime configuration, read once from the environment.
 * Credential-bound values (API keys) are intentionally optional here so the
 * skeleton boots locally without them; code paths that need a key assert at use.
 */

export type AutonomyPhase = "A" | "B" | "C";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface Config {
  nodeEnv: string;
  port: number;
  databaseUrl: string | undefined;
  anthropicApiKey: string | undefined;
  imagegenApiKey: string | undefined;
  approvalChannelWebhook: string | undefined;
  publicBaseUrl: string | undefined;
  autonomyPhase: AutonomyPhase;
  activePlatforms: Array<"instagram" | "facebook" | "gbp">;
  compactContextThreshold: number;
  compactContextInterval: number;
  sessionStartMaxChars: number;
}

function parsePhase(raw: string | undefined): AutonomyPhase {
  return raw === "B" || raw === "C" ? raw : "A";
}

type ActivePlatform = "instagram" | "facebook" | "gbp";
function parsePlatforms(raw: string | undefined): ActivePlatform[] {
  const all: ActivePlatform[] = ["instagram", "facebook", "gbp"];
  if (!raw) return all;
  const picked = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ActivePlatform => (all as string[]).includes(s));
  return picked.length ? picked : all;
}

export const config: Config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: num("PORT", 3000),
  databaseUrl: process.env.DATABASE_URL || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  imagegenApiKey: process.env.IMAGEGEN_API_KEY || undefined,
  approvalChannelWebhook: process.env.APPROVAL_CHANNEL_WEBHOOK || undefined,
  // Public URL of the web service (for approval links in Slack). e.g. https://gcd-social-api.onrender.com
  publicBaseUrl: process.env.PUBLIC_BASE_URL || undefined,
  autonomyPhase: parsePhase(process.env.AUTONOMY_PHASE),
  // Which platforms the loop produces/publishes. Set ACTIVE_PLATFORMS=instagram,facebook
  // while GBP API access is pending; add gbp once approved.
  activePlatforms: parsePlatforms(process.env.ACTIVE_PLATFORMS),
  compactContextThreshold: num("COMPACT_CONTEXT_THRESHOLD", 160_000),
  compactContextInterval: num("COMPACT_CONTEXT_INTERVAL", 60_000),
  sessionStartMaxChars: num("SESSION_START_MAX_CHARS", 20_000),
};
