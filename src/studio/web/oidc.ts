/**
 * Google OpenID Connect for the Studio web service (docs/CONTENT_STUDIO_DESIGN.md
 * §7.1): the authorization-code flow with PKCE (S256), `state` and `nonce`.
 *
 * - **The endpoints and the accepted issuers are code constants** (`GOOGLE_OIDC`),
 *   taken from Google's discovery document. No environment variable can change
 *   any of them. A test injects its own issuer only through `createStudioWebApp`'s
 *   `oidc` parameter, which the entry point never passes.
 * - **The ID token is accepted only from the token response**, never from the
 *   callback URL, and is verified server-side with `jose`: RS256 only, the
 *   issuer, the audience, `exp` and `iat` within a 60-second skew; then
 *   (`checkAudienceParty`, S5) a single audience and a matching `azp`; and then
 *   (`checkIdentityClaims`) the nonce, `hd`, `email_verified` and the email domain.
 * - **The keys** come from `jose`'s remote key set with an explicit timeout. Its
 *   cache is jose's own (a fixed maximum age, not the response's cache headers;
 *   see design §7.1's dated note). No cache is written here.
 *
 * Every failure is a `SignInRefusal` carrying a reason class only: never a token,
 * a code, a claim value or an error message from the provider.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/** The endpoints and issuers of one OpenID provider. */
export interface OidcProvider {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly issuers: readonly string[];
}

/**
 * Google's, from https://accounts.google.com/.well-known/openid-configuration,
 * read 2026-10-02T13:31:24Z (`authorization_endpoint`, `token_endpoint`,
 * `jwks_uri`). Google documents both issuer spellings for its ID tokens.
 */
export const GOOGLE_OIDC: OidcProvider = Object.freeze({
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: Object.freeze(["https://accounts.google.com", "accounts.google.com"]),
});

/** The only signature algorithm accepted. */
export const ID_TOKEN_ALGORITHMS = ["RS256"] as const;
/** The clock skew allowed on `exp` and `iat`, in seconds (design §7.1: "a small clock skew"). */
export const CLOCK_SKEW_SECONDS = 60;
/** Google's ID tokens live one hour; an older `iat` is refused. */
export const ID_TOKEN_MAX_AGE_SECONDS = 3_600;
/** The token exchange's bound, in milliseconds. */
export const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;
/** The key-set fetch's bound, in milliseconds (jose's `timeoutDuration`). */
export const JWKS_TIMEOUT_MS = 5_000;
/** The largest token response read, in bytes. */
export const TOKEN_RESPONSE_MAX_BYTES = 65_536;
/** The scope requested; `hd` is a hint only — the `hd` claim is the control. */
export const OIDC_SCOPE = "openid email profile";
/** The domain every Studio user's email must end with (the schema's own constraint). */
export const STUDIO_EMAIL_DOMAIN = "germancardepot.com";

/** A refused sign-in: a reason class, and nothing else. */
export class SignInRefusal extends Error {
  constructor(readonly reason: string) {
    super(`sign-in refused (${reason})`);
    this.name = "SignInRefusal";
  }
}

const refuse = (reason: string): never => {
  throw new SignInRefusal(reason);
};

export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
export const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
/** RFC 7636 S256: base64url(sha256(verifier)). */
export const pkceChallenge = (verifier: string): string => createHash("sha256").update(verifier, "ascii").digest("base64url");

/** Whether `value`'s sha256 equals the stored hex digest, compared in constant time. */
export function hashMatches(value: unknown, storedHex: string): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  if (!/^[0-9a-f]{64}$/.test(storedHex)) return false;
  return timingSafeEqual(Buffer.from(sha256Hex(value), "hex"), Buffer.from(storedHex, "hex"));
}

/** The authorization request: response type code, PKCE S256, state, nonce, the scope and the `hd` hint. */
export function authorizationUrl(provider: OidcProvider, request: {
  clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string; hd: string;
}): string {
  const url = new URL(provider.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: OIDC_SCOPE,
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    hd: request.hd,
  }).toString();
  return url.toString();
}

/**
 * Exchanges the code at the token endpoint with the client secret and the PKCE
 * verifier, within `timeoutMs`, following no redirect. Returns the ID token from
 * the token response — the only place one is ever accepted.
 */
export async function exchangeCode(provider: OidcProvider, request: {
  code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string; timeoutMs: number;
}, fetchImpl: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(provider.tokenEndpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs),
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: request.code,
        redirect_uri: request.redirectUri,
        client_id: request.clientId,
        client_secret: request.clientSecret,
        code_verifier: request.verifier,
      }).toString(),
    });
  } catch (error) {
    const name = (error as { name?: unknown })?.name;
    return refuse(name === "TimeoutError" || name === "AbortError" ? "token-endpoint-timeout" : "token-endpoint-unreachable");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return refuse("token-endpoint-timeout");
  }
  if (response.status !== 200) return refuse("token-endpoint-error");
  if (Buffer.byteLength(text, "utf8") > TOKEN_RESPONSE_MAX_BYTES) return refuse("token-response-invalid");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse("token-response-invalid");
  }
  const idToken = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof idToken !== "string" || idToken.length === 0) return refuse("token-response-invalid");
  return idToken;
}

/** A provider's key set: jose's remote key set, with an explicit timeout. */
export function remoteKeySet(provider: OidcProvider, timeoutMs: number = JWKS_TIMEOUT_MS): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(provider.jwksUri), { timeoutDuration: timeoutMs });
}

/** jose's failure, as a reason class. */
function joseReason(error: unknown): string {
  if (error instanceof errors.JWTExpired) return "token-expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "issuer";
    if (error.claim === "aud") return "audience";
    if (error.claim === "iat" || error.claim === "nbf" || error.claim === "exp") return "token-time";
    return "claims-invalid";
  }
  if (error instanceof errors.JOSEAlgNotAllowed) return "algorithm";
  if (error instanceof errors.JWSSignatureVerificationFailed) return "signature";
  if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) return "signature";
  if (error instanceof errors.JWKSTimeout) return "keys-unavailable";
  if (error instanceof errors.JOSENotSupported) return "algorithm";
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return "token-malformed";
  return "token-invalid";
}

/**
 * The signature, issuer, audience and times, verified by jose: RS256 only;
 * `iss` one of the provider's issuers; `aud` the client id; `exp`, and `iat`
 * (no older than an hour, not in the future), within the skew.
 */
export async function verifyIdToken(idToken: string, keys: JWTVerifyGetKey, expected: {
  issuers: readonly string[]; clientId: string; now: number;
}): Promise<JWTPayload> {
  let verified: JWTPayload;
  try {
    const { payload } = await jwtVerify(idToken, keys, {
      algorithms: [...ID_TOKEN_ALGORITHMS],
      issuer: [...expected.issuers],
      audience: expected.clientId,
      clockTolerance: CLOCK_SKEW_SECONDS,
      maxTokenAge: ID_TOKEN_MAX_AGE_SECONDS,
      requiredClaims: ["exp", "iat", "sub"],
      currentDate: new Date(expected.now),
    });
    verified = payload;
  } catch (error) {
    return refuse(joseReason(error));
  }
  checkAudienceParty(verified, expected.clientId);
  return verified;
}

/**
 * After jose's audience check (Content Studio S5, from the S4 review; OpenID
 * Connect Core §3.1.3.7 items 3–5): an `aud` array naming more than one
 * audience is refused even when it includes this client, and an `azp`, when
 * present, must be exactly this client id.
 */
export function checkAudienceParty(payload: JWTPayload, clientId: string): void {
  if (Array.isArray(payload.aud) && payload.aud.length > 1) refuse("audience-multiple");
  if (payload.azp !== undefined && payload.azp !== clientId) refuse("authorized-party");
}

/** Who a verified ID token names. */
export interface VerifiedIdentity {
  /** Lower-cased. */
  email: string;
  sub: string;
  /** The `name` claim, bounded to the schema's 200 characters; null when absent. */
  displayName: string | null;
}

/**
 * The checks after the signature (design §7.1): the nonce matches the stored
 * hash; `hd` equals the allowed domain, and a missing `hd` is refused;
 * `email_verified` is the boolean `true`; the lower-cased email ends
 * `@germancardepot.com`; and `sub` has the schema's shape.
 */
export function checkIdentityClaims(payload: JWTPayload, expected: { nonceHash: string; allowedHd: string }): VerifiedIdentity {
  if (!hashMatches(payload.nonce, expected.nonceHash)) refuse("nonce");
  if (payload.hd !== expected.allowedHd) refuse("hd");
  if (payload.email_verified !== true) refuse("email-unverified");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email.endsWith(`@${STUDIO_EMAIL_DOMAIN}`) || !/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 320) {
    refuse("email-domain");
  }
  const sub = payload.sub;
  if (typeof sub !== "string" || !/^[\x21-\x7e]{1,255}$/.test(sub)) refuse("claims-invalid");
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 200) : "";
  return { email, sub: sub!, displayName: name === "" ? null : name };
}
