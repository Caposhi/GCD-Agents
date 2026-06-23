/**
 * Posting-tool types. Provider-agnostic so the native implementation can be
 * swapped for a managed aggregator later without changing the agents.
 */

export type Platform = "gbp" | "instagram" | "facebook";

/** A single image attached to a post. Must be a public, JPEG URL for Instagram. */
export interface PostImage {
  url: string; // publicly reachable at publish time
  altText?: string;
  aiGenerated?: boolean; // honesty: true when the image was AI-generated (IG is_ai_generated)
}

/** GBP call-to-action button. */
export type GbpActionType = "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL";

export interface PostPackage {
  platform: Platform;
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
  /** Optional caller-supplied idempotency key (else derived). */
  idempotencyKey?: string;
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
  gbpAccountId?: string;
  gbpLocationId?: string;
  googleAccessToken?: string;
  igUserId?: string;
  fbPageId?: string;
  metaAccessToken?: string; // page/user token per Meta docs
  graphVersion?: string; // e.g. "v25.0"
}

export interface PostingProvider {
  readonly name: string;
  publish(pkg: PostPackage, creds: PlatformCredentials): Promise<PublishResult>;
}
