/** Environment scrub used by the simulated dry-run launcher before config loads. */
export const SIMULATED_DRYRUN_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "APPROVAL_CHANNEL_WEBHOOK",
  "CONSOLE_TOKEN",
  "DATABASE_URL",
  "FB_PAGE_ACCESS_TOKEN",
  "FB_PAGE_ID",
  "GBP_ACCOUNT_ID",
  "GBP_LOCATION_ID",
  "GOOGLE_ACCESS_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GRAPH_VERSION",
  "IG_ACCESS_TOKEN",
  "IG_GRAPH_HOST",
  "IG_USER_ID",
  "IMAGEGEN_API_KEY",
  "MANAGER_MODEL",
  "PUBLIC_BASE_URL",
] as const;

export function clearSimulatedDryRunEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  for (const key of SIMULATED_DRYRUN_ENV_KEYS) delete env[key];
}

/** Prepare a deterministic non-production process before config is imported. */
export function prepareSimulatedDryRunEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  clearSimulatedDryRunEnvironment(env);
  env.NODE_ENV = "test";
}
