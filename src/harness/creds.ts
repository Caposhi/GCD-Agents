/**
 * Platform credentials assembled from the environment (credential-bound;
 * Render `sync: false`). Never read from a committed file.
 */

import { PlatformCredentials } from "../mcp/posting-tool/index.js";

export function credsFromEnv(): PlatformCredentials {
  return {
    igUserId: process.env.IG_USER_ID,
    igAccessToken: process.env.IG_ACCESS_TOKEN,
    igGraphHost: process.env.IG_GRAPH_HOST, // optional; defaults to graph.instagram.com
    fbPageId: process.env.FB_PAGE_ID,
    fbPageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN,
    gbpAccountId: process.env.GBP_ACCOUNT_ID,
    gbpLocationId: process.env.GBP_LOCATION_ID,
    graphVersion: process.env.GRAPH_VERSION,
  };
}
