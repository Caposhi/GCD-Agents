/**
 * Google OAuth access-token supply for the Google Business Profile (GMB v4)
 * posting path. Google access tokens expire hourly, so daily posting needs a
 * fresh one each run. If a refresh token + client id/secret are configured, we
 * exchange them for a fresh access token (cached in-process until ~1 min before
 * expiry); otherwise we fall back to a static GOOGLE_ACCESS_TOKEN env value.
 *
 * Operational plumbing only — no guardrail impact.
 */

interface GoogleCreds {
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
}

function creds(): GoogleCreds {
  return {
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || undefined,
    clientId: process.env.GOOGLE_CLIENT_ID || undefined,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || undefined,
    accessToken: process.env.GOOGLE_ACCESS_TOKEN || undefined,
  };
}

/** True when we can self-refresh (preferred over a static, hourly-expiring token). */
export function googleOAuthConfigured(): boolean {
  const c = creds();
  return !!(c.refreshToken && c.clientId && c.clientSecret);
}

let cached: { token: string; expiresAt: number } | undefined;

/** Fresh Google access token: refresh-flow first, static env fallback. */
export async function getGoogleAccessToken(nowMs: number = Date.now()): Promise<string | undefined> {
  const c = creds();
  if (!googleOAuthConfigured()) return c.accessToken;
  if (cached && cached.expiresAt - nowMs > 60_000) return cached.token;

  const body = new URLSearchParams({
    client_id: c.clientId!,
    client_secret: c.clientSecret!,
    refresh_token: c.refreshToken!,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google token refresh -> ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json?.access_token) throw new Error(`google token refresh: no access_token in response`);
  cached = { token: json.access_token as string, expiresAt: nowMs + (Number(json.expires_in) || 3600) * 1000 };
  return cached.token;
}
