/**
 * Posting-tool types. Provider-agnostic so the native implementation can be
 * swapped for a managed aggregator later without changing the agents.
 */

export type Platform = "gbp" | "instagram" | "facebook";

/**
 * Non-secret, approval-bound provider destination. Credentials authenticate a
 * request; this object says exactly which account/location and API endpoint
 * the approved bytes are allowed to reach.
 */
export interface PublicationTarget {
  /** IG user id, Facebook Page id, or GBP account id. */
  accountId: string;
  /** GBP only. */
  locationId?: string;
  /** Bare, lower-case hostname (never a URL and never a credential). */
  apiHost: string;
  /** Exact provider API version used to build the request. */
  apiVersion: string;
}

/** A single image attached to a post. Must be a public, JPEG URL for Instagram. */
export interface PostImage {
  url: string; // publicly reachable at publish time
  /** SHA-256 of the inspected JPEG bytes addressed by `url`. */
  contentSha256: string;
  altText?: string;
  aiGenerated?: boolean; // honesty: true when the image was AI-generated (IG is_ai_generated)
}

/** GBP call-to-action button. */
export type GbpActionType = "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL";

export interface PostPackage {
  platform: Platform;
  target: PublicationTarget;
  /** Post body / caption / summary. */
  text: string;
  languageCode?: string; // e.g. "en-US" | "es"
  images?: PostImage[];
  /** GBP only. */
  gbp?: {
    topicType?: "STANDARD" | "EVENT" | "OFFER" | "ALERT";
    callToAction?: { actionType: GbpActionType; url: string };
  };
  /** Facebook only. */
  facebook?: {
    link?: string;
    scheduledPublishTime?: number; // unix seconds, 10min–30d out
  };
}

/**
 * Identifies one item inside a hash-bound `social-post-packages/v1` approval
 * subject. This is an identifier, not an authorization secret: the posting
 * tool resolves and verifies current approval state immediately before IO.
 */
export interface PublicationAuthorization {
  approvalId: string;
  packageIndex: number;
}

/** A built HTTP request — pure data, so request construction is unit-testable without network. */
export interface BuiltRequest {
  method: "POST" | "PATCH" | "DELETE" | "GET";
  url: string;
  body?: Record<string, unknown>;
  /** Notes for the caller (e.g. "step 1 of 2: container"). */
  step?: string;
}

export interface PublishResult {
  platform: Platform;
  ok: boolean;
  id?: string; // platform post/media id
  permalink?: string;
  error?: string;
}

/** Tokens are credential-bound; supplied at runtime, never committed. */
export interface PlatformCredentials {
  // Google Business Profile (OAuth)
  gbpAccountId?: string;
  gbpLocationId?: string;
  googleAccessToken?: string;
  // Instagram — default Instagram-Login path: graph.instagram.com + IG user token.
  igUserId?: string;
  igAccessToken?: string;
  igGraphHost?: string; // default "graph.instagram.com"; use "graph.facebook.com" for the Facebook-Login path
  // Facebook Page — Facebook-Login path: graph.facebook.com + Page token.
  fbPageId?: string;
  fbPageAccessToken?: string;
  graphVersion?: string; // e.g. "v25.0"
}

/**
 * Fresh durable authorization check supplied by the posting-tool boundary.
 * Providers MUST await this immediately before every provider HTTP attempt,
 * including reads, retries, and the final step of a multi-request flow.
 */
export interface PublicationGuard {
  beforeMutation(): Promise<void>;
}

export interface PostingProvider {
  readonly name: string;
  publish(pkg: PostPackage, creds: PlatformCredentials, guard: PublicationGuard): Promise<PublishResult>;
}
