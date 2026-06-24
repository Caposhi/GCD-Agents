/**
 * Offline self-test for the posting tool. Validates native request shapes
 * (no network, no real tokens) and proves the approval gate blocks an
 * unapproved publish. Run: npm run build && npm run test:posting
 */

import {
  buildGbpLocalPost,
  buildIgCreateContainer,
  buildIgPublish,
  buildFacebookPost,
} from "./native/requests.js";
import { publishApprovedPackage } from "./index.js";
import { PostPackage, PlatformCredentials, PostingProvider } from "./types.js";

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
};

// --- GBP ---
const gbp = buildGbpLocalPost(
  {
    platform: "gbp",
    text: "Brake fluid flush this week — book online.",
    languageCode: "en-US",
    gbp: { topicType: "OFFER", callToAction: { actionType: "BOOK", url: "https://gcd.example/book" } },
    images: [{ url: "https://gcd.example/img.jpg" }],
  },
  creds,
);
check("gbp url", gbp.url === "https://mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts");
check("gbp summary", gbp.body?.summary === "Brake fluid flush this week — book online.");
check("gbp topicType", gbp.body?.topicType === "OFFER");
check("gbp cta", (gbp.body?.callToAction as any)?.actionType === "BOOK");
check("gbp media PHOTO", (gbp.body?.media as any)?.[0]?.mediaFormat === "PHOTO");

// --- Instagram two-step ---
const igPkg: PostPackage = {
  platform: "instagram",
  text: "Caption",
  images: [{ url: "https://gcd.example/i.jpg", altText: "alt", aiGenerated: true }],
};
const igC = buildIgCreateContainer(igPkg, creds);
check("ig container url (graph.instagram.com)", igC.url === "https://graph.instagram.com/v25.0/333/media");
check("ig image_url", igC.body?.image_url === "https://gcd.example/i.jpg");
check("ig alt_text", igC.body?.alt_text === "alt");
check("ig is_ai_generated", igC.body?.is_ai_generated === true);
const igP = buildIgPublish("CONTAINER123", creds);
check("ig publish url (graph.instagram.com)", igP.url === "https://graph.instagram.com/v25.0/333/media_publish");
check("ig creation_id", igP.body?.creation_id === "CONTAINER123");

// --- Facebook feed vs photo ---
const fbFeed = buildFacebookPost({ platform: "facebook", text: "Hello", facebook: { link: "https://x.y" } }, creds);
check("fb feed url", fbFeed.url === "https://graph.facebook.com/v25.0/444/feed");
check("fb feed message", fbFeed.body?.message === "Hello");
const fbPhoto = buildFacebookPost(
  { platform: "facebook", text: "Cap", images: [{ url: "https://gcd.example/p.jpg" }] },
  creds,
);
check("fb photo url", fbPhoto.url === "https://graph.facebook.com/v25.0/444/photos");
check("fb photo url field", fbPhoto.body?.url === "https://gcd.example/p.jpg");

// --- missing-credential guard ---
let threw = false;
try {
  buildGbpLocalPost({ platform: "gbp", text: "x" }, {});
} catch {
  threw = true;
}
check("missing gbp creds throws", threw);

// --- approval gate ---
const fakeProvider: PostingProvider = {
  name: "fake",
  async publish(pkg) {
    return { platform: pkg.platform, ok: true, id: "FAKE" };
  },
};

async function gateTests(): Promise<void> {
  let blocked = false;
  try {
    await publishApprovedPackage({ platform: "facebook", text: "x" }, false, creds, fakeProvider);
  } catch {
    blocked = true;
  }
  check("gate BLOCKS unapproved publish (Phase A)", blocked);

  const res = await publishApprovedPackage({ platform: "facebook", text: "x" }, true, creds, fakeProvider);
  check("gate ALLOWS approved publish", res.ok && res.id === "FAKE");

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void gateTests();
