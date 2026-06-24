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
  compactContextThreshold: number;
  compactContextInterval: number;
  sessionStartMaxChars: number;
}

function parsePhase(raw: string | undefined): AutonomyPhase {
  return raw === "B" || raw === "C" ? raw : "A";
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
  compactContextThreshold: num("COMPACT_CONTEXT_THRESHOLD", 160_000),
  compactContextInterval: num("COMPACT_CONTEXT_INTERVAL", 60_000),
  sessionStartMaxChars: num("SESSION_START_MAX_CHARS", 20_000),
};
