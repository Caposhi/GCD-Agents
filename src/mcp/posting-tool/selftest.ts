/**
 * Offline self-test for the posting tool. Validates native request shapes
 * (no network, no real tokens) and adversarially exercises exact-payload
 * approval binding. Run: npm run build && npm run test:posting
 */

import {
  buildGbpLocalPost,
  buildIgCreateContainer,
  buildIgPublish,
  buildFacebookPost,
} from "./native/requests.js";
import {
  forgedGuardRejectedBeforeFetchForSelfTest,
  issuedGuardRejectsRevocationForSelfTest,
  missingProviderIdsRejectedForSelfTest,
} from "./native/provider.js";
import { matchExactPublicationPackage, publishApprovedPackage } from "./index.js";
import { PostPackage, PlatformCredentials } from "./types.js";
import {
  publicationTargetsFromEnv,
  validatePostPackage,
  validateSocialPostSubject,
} from "./validation.js";
import {
  createApproval,
  decideApproval,
  getEphemeralApprovedSubjectForSelfTest,
  revokeApproval,
} from "../../harness/state.js";

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

const creds: PlatformCredentials = {
  gbpAccountId: "111",
  gbpLocationId: "222",
  igUserId: "333",
  fbPageId: "444",
  graphVersion: "v25.0",
  igGraphHost: "graph.instagram.com",
};
const CONTENT_SHA = "c".repeat(64);
const IMAGE_URL = `https://gcd.example/media/00000000-0000-4000-8000-000000000003-${CONTENT_SHA}.jpg`;
const TARGETS = {
  gbp: { accountId: "111", locationId: "222", apiHost: "mybusiness.googleapis.com", apiVersion: "v4" } as const,
  instagram: { accountId: "333", apiHost: "graph.instagram.com", apiVersion: "v25.0" } as const,
  facebook: { accountId: "444", apiHost: "graph.facebook.com", apiVersion: "v25.0" } as const,
};
const derivedTargets = publicationTargetsFromEnv(
  ["instagram", "facebook", "gbp"],
  {
    IG_USER_ID: "333",
    IG_GRAPH_HOST: "graph.facebook.com",
    FB_PAGE_ID: "444",
    GBP_ACCOUNT_ID: "111",
    GBP_LOCATION_ID: "222",
  },
);
check(
  "env target mapping pins ids, allowlisted hosts, and default versions without tokens",
  derivedTargets.instagram.apiHost === "graph.facebook.com"
    && derivedTargets.instagram.apiVersion === "v25.0"
    && derivedTargets.facebook.apiHost === "graph.facebook.com"
    && derivedTargets.gbp.apiHost === "mybusiness.googleapis.com"
    && derivedTargets.gbp.apiVersion === "v4"
    && !("accessToken" in derivedTargets.instagram),
);

// --- GBP ---
const gbpPkg: PostPackage = {
  platform: "gbp",
  target: TARGETS.gbp,
  text: "Brake fluid flush this week — book online.",
  languageCode: "en-US",
  gbp: { topicType: "OFFER", callToAction: { actionType: "BOOK", url: "https://gcd.example/book" } },
  images: [{ url: IMAGE_URL, contentSha256: CONTENT_SHA }],
};
const gbp = buildGbpLocalPost(gbpPkg, creds);
check("gbp url", gbp.url === "https://mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts");
check("gbp summary", gbp.body?.summary === "Brake fluid flush this week — book online.");
check("gbp topicType", gbp.body?.topicType === "OFFER");
check("gbp cta", (gbp.body?.callToAction as any)?.actionType === "BOOK");
check("gbp media PHOTO", (gbp.body?.media as any)?.[0]?.mediaFormat === "PHOTO");
check("gbp missing explicit topicType is invalid", !validatePostPackage({ ...gbpPkg, gbp: {} }).ok);
check("gbp missing explicit languageCode is invalid", !validatePostPackage({ ...gbpPkg, languageCode: undefined }).ok);

// --- Instagram two-step ---
const igPkg: PostPackage = {
  platform: "instagram",
  target: TARGETS.instagram,
  text: "Caption",
  images: [{ url: IMAGE_URL, contentSha256: CONTENT_SHA, altText: "alt", aiGenerated: true }],
};
const igC = buildIgCreateContainer(igPkg, creds);
check("ig container url (graph.instagram.com)", igC.url === "https://graph.instagram.com/v25.0/333/media");
check("ig image_url", igC.body?.image_url === IMAGE_URL);
check("ig alt_text", igC.body?.alt_text === "alt");
check("ig is_ai_generated", igC.body?.is_ai_generated === true);
const igP = buildIgPublish("CONTAINER123", igPkg, creds);
check("ig publish url (graph.instagram.com)", igP.url === "https://graph.instagram.com/v25.0/333/media_publish");
check("ig creation_id", igP.body?.creation_id === "CONTAINER123");

// --- Facebook feed vs photo ---
const fbFeed = buildFacebookPost({ platform: "facebook", target: TARGETS.facebook, text: "Hello", facebook: { link: "https://x.y" } }, creds);
check("fb feed url", fbFeed.url === "https://graph.facebook.com/v25.0/444/feed");
check("fb feed message", fbFeed.body?.message === "Hello");
const fbPhoto = buildFacebookPost(
  { platform: "facebook", target: TARGETS.facebook, text: "Cap", images: [{ url: IMAGE_URL, contentSha256: CONTENT_SHA }] },
  creds,
);
check("fb photo url", fbPhoto.url === "https://graph.facebook.com/v25.0/444/photos");
check("fb photo url field", fbPhoto.body?.url === IMAGE_URL);

// --- missing-credential guard ---
let threw = false;
try {
  buildGbpLocalPost({
    platform: "gbp",
    target: TARGETS.gbp,
    text: "x",
    languageCode: "en-US",
    gbp: { topicType: "STANDARD" },
  }, {});
} catch {
  threw = true;
}
check("missing gbp creds throws", threw);

async function isBlocked(fn: () => unknown | Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function gateTests(): Promise<void> {
  const exact: PostPackage = {
    platform: "gbp",
    target: TARGETS.gbp,
    text: "Exact approved caption #gcd",
    languageCode: "en-US",
    images: [{ url: IMAGE_URL, contentSha256: CONTENT_SHA }],
    gbp: {
      topicType: "STANDARD",
      callToAction: { actionType: "BOOK", url: "https://gcd.example/book" },
    },
  };

  // The old `(pkg, true, creds)` shape is rejected at runtime as well as by
  // TypeScript. A caller-controlled boolean can never become authorization.
  check(
    "fabricated approved=true without a record is blocked",
    await isBlocked(() => (publishApprovedPackage as any)(exact, true, creds)),
  );

  check(
    "made-up approval id is blocked",
    await isBlocked(() => publishApprovedPackage(
      exact,
      { approvalId: "00000000-0000-0000-0000-000000000000", packageIndex: 0 },
      creds,
    )),
  );

  const approvalA = await createApproval("exact payload", [exact]);
  await decideApproval(approvalA.id, approvalA.token, "approved", "offline-reviewer");
  const ephemeralA = await getEphemeralApprovedSubjectForSelfTest<unknown[]>(approvalA.id);

  check("empty approved package arrays are invalid", !validateSocialPostSubject([]).ok);
  check(
    "one valid package cannot hide a malformed approved sibling",
    !validateSocialPostSubject([exact, { platform: "instagram", text: "malformed sibling" }]).ok,
  );
  check(
    "one approval subject cannot contain duplicate platform payloads",
    !validateSocialPostSubject([exact, { ...exact }]).ok,
  );

  check(
    "even an exact ephemeral approval cannot call the publication boundary",
    await isBlocked(() => publishApprovedPackage(
      exact,
      { approvalId: approvalA.id, packageIndex: 0 },
      creds,
    )),
  );

  const payloadB: PostPackage = { ...exact, text: "Mutated caption #different" };
  check(
    "approval for payload A cannot publish payload B",
    await isBlocked(() => matchExactPublicationPackage(ephemeralA.subject, payloadB, 0)),
  );

  const ctaMutation: PostPackage = {
    ...exact,
    gbp: { ...exact.gbp, callToAction: { actionType: "LEARN_MORE", url: "https://evil.example" } },
  };
  check(
    "post-approval CTA mutation is blocked",
    await isBlocked(() => matchExactPublicationPackage(ephemeralA.subject, ctaMutation, 0)),
  );

  const mediaMutation: PostPackage = {
    ...exact,
    images: [{ url: `https://evil.example/replacement-${CONTENT_SHA}.jpg`, contentSha256: CONTENT_SHA }],
  };
  check(
    "post-approval media mutation is blocked",
    await isBlocked(() => matchExactPublicationPackage(ephemeralA.subject, mediaMutation, 0)),
  );

  const altMutation = {
    ...exact,
    images: [{ ...exact.images![0]!, altText: "Provider-ignored field" }],
  } as unknown as PostPackage;
  check(
    "post-approval provider-ignored media field is blocked",
    await isBlocked(() => matchExactPublicationPackage(ephemeralA.subject, altMutation, 0)),
  );

  const targetMutation: PostPackage = {
    ...exact,
    target: { ...exact.target, accountId: "different-account" },
  };
  check(
    "post-approval destination substitution is blocked",
    await isBlocked(() => matchExactPublicationPackage(ephemeralA.subject, targetMutation, 0)),
  );

  const unknownMutation = { ...exact, ignoredProviderField: "surprise" } as unknown as PostPackage;
  check(
    "unknown or ignored package field is blocked",
    !validatePostPackage(unknownMutation).ok
      && await isBlocked(() => matchExactPublicationPackage(ephemeralA.subject, unknownMutation, 0)),
  );

  check(
    "runtime account mismatch blocks request construction",
    await isBlocked(() => buildGbpLocalPost(exact, { ...creds, gbpAccountId: "999" })),
  );
  check(
    "runtime Meta version mismatch blocks request construction",
    await isBlocked(() => buildIgCreateContainer(igPkg, { ...creds, graphVersion: "v26.0" })),
  );
  check(
    "runtime Instagram host mismatch blocks request construction",
    await isBlocked(() => buildIgCreateContainer(igPkg, { ...creds, igGraphHost: "graph.facebook.com" })),
  );
  const badHost = { ...igPkg, target: { ...igPkg.target, apiHost: "evil.example" } } as PostPackage;
  check("non-allowlisted Instagram API host is rejected", !validatePostPackage(badHost).ok);
  const unknownTargetField = {
    ...igPkg,
    target: { ...igPkg.target, token: "must never be approval data" },
  } as unknown as PostPackage;
  check("unknown or secret-like target field is rejected", !validatePostPackage(unknownTargetField).ok);

  check(
    "wrong package index is blocked",
    await isBlocked(() => matchExactPublicationPackage(ephemeralA.subject, exact, 1)),
  );

  const matchedExact = matchExactPublicationPackage(ephemeralA.subject, exact, 0);
  check("exact approved text matches", matchedExact.text === exact.text);
  check("exact approved CTA matches", matchedExact.gbp?.callToAction?.url === exact.gbp?.callToAction?.url);
  check("exact approved media matches", matchedExact.images?.[0]?.url === exact.images?.[0]?.url);
  check("pure matcher returns an independent canonical copy", matchedExact !== (ephemeralA.subject as PostPackage[])[0]);

  const expired = await createApproval("expired", [exact], {
    tokenExpiresAt: new Date(Date.now() + 60_000),
    authorizationExpiresAt: new Date(Date.now() - 1_000),
  });
  await decideApproval(expired.id, expired.token, "approved");
  check(
    "expired approval is blocked by approval semantics",
    await isBlocked(() => getEphemeralApprovedSubjectForSelfTest(expired.id)),
  );

  const revoked = await createApproval("revoked", [exact]);
  await decideApproval(revoked.id, revoked.token, "approved");
  await revokeApproval(revoked.id, "owner", "content withdrawn");
  check(
    "revoked approval is blocked by approval semantics",
    await isBlocked(() => getEphemeralApprovedSubjectForSelfTest(revoked.id)),
  );

  check(
    "issued guard rechecks and blocks mid-flow revocation",
    await issuedGuardRejectsRevocationForSelfTest(),
  );

  // The native class remains import-compatible, but its mutation sender rejects
  // any caller-forged/no-op guard before its transport is reached.
  const forgedGuard = await forgedGuardRejectedBeforeFetchForSelfTest();
  check(
    "direct native publish rejects caller-forged guard",
    forgedGuard.blocked,
  );
  check("forged guard is rejected before fetch", forgedGuard.beforeFetch);

  const missingIds = await missingProviderIdsRejectedForSelfTest();
  check("GBP 2xx without post id is failure", missingIds.gbp);
  check("Instagram 2xx without post id is failure", missingIds.instagram);
  check("Facebook 2xx without post id is failure", missingIds.facebook);
  check("native provider requests refuse automatic redirects", missingIds.redirects);
  check("Instagram guard runs before create, status read, and publish", missingIds.igGuardsEveryAttempt);

  // Legacy still-image compatibility: an approved array can carry the exact
  // Instagram, Facebook, and GBP packages through the exact matcher.
  const legacyStill: PostPackage[] = [
    {
      platform: "instagram",
      target: TARGETS.instagram,
      text: "IG exact",
      images: [{ url: IMAGE_URL, contentSha256: CONTENT_SHA, altText: "Still image", aiGenerated: true }],
    },
    {
      platform: "facebook",
      target: TARGETS.facebook,
      text: "FB exact",
      images: [{ url: IMAGE_URL, contentSha256: CONTENT_SHA }],
    },
    {
      platform: "gbp",
      target: TARGETS.gbp,
      text: "GBP exact",
      languageCode: "en-US",
      images: [{ url: IMAGE_URL, contentSha256: CONTENT_SHA }],
      gbp: { topicType: "STANDARD" },
    },
  ];
  const legacyApproval = await createApproval("legacy still-image package", legacyStill);
  await decideApproval(legacyApproval.id, legacyApproval.token, "approved");
  const legacySubject = await getEphemeralApprovedSubjectForSelfTest<unknown[]>(legacyApproval.id);
  let legacyMatches = 0;
  for (let i = 0; i < legacyStill.length; i++) {
    const matched = matchExactPublicationPackage(legacySubject.subject, legacyStill[i]!, i);
    if (matched.platform === legacyStill[i]!.platform && matched.text === legacyStill[i]!.text) legacyMatches++;
  }
  check("legacy approved still-image payloads remain compatible", legacyMatches === 3);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void gateTests();
