/**
 * Instagram-Login access-token lifecycle.
 *
 * Tokens on the graph.instagram.com path are treated as expiring and refreshed
 * by this module. Facebook-login Page-token lifecycle is not managed here and
 * must be verified/rotated operationally. This module keeps the Instagram-login
 * token fresh automatically so posting does not silently break:
 * it persists the live token in Postgres (session_state) and proactively calls
 * Instagram's refresh endpoint well before its estimated expiry. Refresh is
 * skipped on the Facebook-login path because it uses a different token flow.
 *
 * Operator override: changing IG_ACCESS_TOKEN in the environment re-seeds the
 * store — a freshly minted token always wins over a stale persisted one.
 *
 * This is operational plumbing, not a guardrail: it never touches the approval
 * gate or the posting deny-rules.
 */

import { loadSessionState, saveSessionState } from "./state.js";
import { config } from "./config.js";
import { approvalWebhookRequestInit, validateApprovalChannelWebhook } from "./hitl.js";
import { sanitizeSlackSummaryText } from "./packageMap.js";
import {
  DEFAULT_IG_API_HOST,
  FACEBOOK_API_HOST,
  IG_API_HOSTS,
} from "../mcp/posting-tool/validation.js";

const STORE_KEY = "cred:ig_access_token";
const DAY = 24 * 60 * 60 * 1000;
const MIN_AGE_MS = 25 * 60 * 60 * 1000; // IG requires a token >=24h old before it can be refreshed
const REFRESH_EVERY_MS = 45 * DAY; // proactively renew roughly every 45 days...
const REFRESH_WINDOW_MS = 10 * DAY; // ...or whenever fewer than 10 days remain
const SEED_TTL_MS = 50 * DAY; // assumed remaining life of a freshly generated token, until first real refresh
const DEFAULT_EXPIRES_IN = 60 * 24 * 60 * 60; // 60 days in seconds (Instagram's long-lived default)

interface StoredToken {
  token: string;
  expiresAt: number; // ms epoch (an estimate until the first real refresh returns expires_in)
  refreshedAt: number; // ms epoch of the last seed/refresh
  envSeed: string; // the env value we seeded from — lets us detect a manual rotation
}

/** Resolve only the two exact Meta Graph hosts admitted by publication. */
export function validatedIgGraphHost(value = process.env.IG_GRAPH_HOST): string {
  const host = value?.trim() || DEFAULT_IG_API_HOST;
  if (!IG_API_HOSTS.has(host)) {
    throw new Error(
      `BLOCKED: IG_GRAPH_HOST must be exactly ${DEFAULT_IG_API_HOST} or ${FACEBOOK_API_HOST}`,
    );
  }
  return host;
}

/** Only the Instagram-login path is managed by this refresh implementation. */
function isIgLoginPath(): boolean {
  return validatedIgGraphHost() === DEFAULT_IG_API_HOST;
}

/** Page the human via the Slack approval channel when self-healing can't heal. */
async function postAlert(text: string): Promise<void> {
  const safeText = sanitizeSlackSummaryText(text.slice(0, 1_500));
  const hook = config.approvalChannelWebhook;
  if (!hook) {
    console.warn(`[ig-token] ALERT (no APPROVAL_CHANNEL_WEBHOOK): ${safeText}`);
    return;
  }
  try {
    const webhookUrl = validateApprovalChannelWebhook(hook, config.nodeEnv) as string;
    await fetch(webhookUrl, approvalWebhookRequestInit({
      text: `*GCD-SOCIAL — Instagram token alert*\n\`${safeText}\``,
    }));
  } catch (err) {
    console.error("[ig-token] alert post failed:", (err as Error).message);
  }
}

async function callRefresh(current: string): Promise<{ token: string; expiresIn: number }> {
  if (!isIgLoginPath()) throw new Error("BLOCKED: Instagram refresh is only supported on graph.instagram.com");
  const url = `https://${DEFAULT_IG_API_HOST}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`;
  const res = await fetch(url, {
    // A redirect could replay the token-bearing query to another origin.
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ig refresh -> ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json?.access_token) throw new Error(`ig refresh: no access_token in response: ${text.slice(0, 120)}`);
  return { token: json.access_token as string, expiresIn: Number(json.expires_in) || DEFAULT_EXPIRES_IN };
}

/**
 * Return the IG access token to publish with, refreshing + persisting it when due.
 * Falls back to the raw env token if the store is unavailable or a refresh fails,
 * so a refresh hiccup never blocks a post that the current token can still make.
 */
export async function getCurrentIgToken(nowMs: number): Promise<string | undefined> {
  const envToken = process.env.IG_ACCESS_TOKEN || undefined;
  if (!isIgLoginPath()) return envToken; // Facebook-login lifecycle is managed outside this module

  let stored = await loadSessionState<StoredToken>(STORE_KEY).catch(() => undefined);

  // Seed, or re-seed when the operator has rotated IG_ACCESS_TOKEN in the env.
  if (envToken && (!stored || stored.envSeed !== envToken)) {
    stored = { token: envToken, expiresAt: nowMs + SEED_TTL_MS, refreshedAt: nowMs, envSeed: envToken };
    await saveSessionState(STORE_KEY, stored).catch(() => {});
    return stored.token;
  }
  if (!stored) return envToken;

  const age = nowMs - stored.refreshedAt;
  const due = age >= REFRESH_EVERY_MS || stored.expiresAt - nowMs <= REFRESH_WINDOW_MS;
  if (due && age >= MIN_AGE_MS) {
    try {
      const { token, expiresIn } = await callRefresh(stored.token);
      stored = { token, expiresAt: nowMs + expiresIn * 1000, refreshedAt: nowMs, envSeed: stored.envSeed };
      await saveSessionState(STORE_KEY, stored).catch(() => {});
      console.log(`[ig-token] refreshed — valid ~${Math.round(expiresIn / 86400)} more days`);
    } catch (err) {
      const daysLeft = Math.round((stored.expiresAt - nowMs) / DAY);
      console.error(`[ig-token] refresh FAILED, still using current token (~${daysLeft}d left): ${(err as Error).message}`);
      // Self-healing couldn't heal — page a human while the current token still works.
      await postAlert(
        `Auto-refresh FAILED — est. ~${daysLeft} days of validity left.\nError: ${(err as Error).message}\n` +
          `Posting still works for now. If this persists, generate a fresh long-lived IG token and update IG_ACCESS_TOKEN on the worker (it re-seeds automatically).`,
      );
    }
  }
  return stored.token;
}

/**
 * The token the worker actually publishes with: DB store first, env fallback.
 * Read-only — never refreshes or seeds. Used by diagnostics so /diag/ig reflects
 * the live posting token, not the (intentionally static) env seed.
 */
export async function effectiveIgToken(): Promise<{ token?: string; source: "db-store" | "env" | "none" }> {
  const envToken = process.env.IG_ACCESS_TOKEN || undefined;
  if (!isIgLoginPath()) return { token: envToken, source: envToken ? "env" : "none" };
  const stored = await loadSessionState<StoredToken>(STORE_KEY).catch(() => undefined);
  if (stored?.token) return { token: stored.token, source: "db-store" };
  return { token: envToken, source: envToken ? "env" : "none" };
}

/** Read-only snapshot for diagnostics. Never returns the token value. */
export async function igTokenStatus(nowMs: number): Promise<unknown> {
  if (!isIgLoginPath()) return { path: "facebook-login", refresh: "not managed; verify provider expiry/rotation" };
  const stored = await loadSessionState<StoredToken>(STORE_KEY).catch(() => undefined);
  if (!stored) return { path: "instagram-login", store: "empty (worker seeds from env on first tick)" };
  return {
    path: "instagram-login",
    refreshedAt: new Date(stored.refreshedAt).toISOString(),
    estExpiresAt: new Date(stored.expiresAt).toISOString(),
    daysLeftEst: Math.round((stored.expiresAt - nowMs) / DAY),
    matchesEnv: stored.envSeed === (process.env.IG_ACCESS_TOKEN || undefined),
  };
}
