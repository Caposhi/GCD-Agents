/**
 * Offline self-test for the Phase 6 approval gate (in-memory state; no DB, no
 * network). Verifies: brief queue, tokenized approval decisions, waitForApproval
 * resolution, and the assertPublishAllowed guard.
 * Run: npm run build && npm run test:gate
 */

import { enqueueBrief, claimNextBrief, completeBrief, createApproval, getApproval, decideApproval } from "./state.js";
import { requestApproval, waitForApproval, assertPublishAllowed, postingRequiresApproval } from "./hitl.js";

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

async function run(): Promise<void> {
  // brief queue
  const bid = await enqueueBrief({ goal: "test" });
  const claimed = await claimNextBrief();
  check("brief claimed", claimed?.id === bid);
  check("queue drains", (await claimNextBrief()) === null);
  await completeBrief(bid, "done", { ok: true });

  // tokenized approval
  const { id, token } = await createApproval("summary", [{ platform: "instagram", formatted_body: "hi" }]);
  check("approval pending", (await getApproval(id))?.status === "pending");
  check("wrong token rejected", !(await decideApproval(id, "WRONG", "approved")).ok);
  check("still pending after bad token", (await getApproval(id))?.status === "pending");
  check("right token approves", (await decideApproval(id, token, "approved")).ok);
  check("approved is terminal", !(await decideApproval(id, token, "rejected")).ok);

  // waitForApproval resolves to the recorded decision
  const w = await waitForApproval(id, { pollMs: 5, timeoutMs: 500 });
  check("wait sees approved", w === "approved");

  // rejected path
  const r = await createApproval("s2", []);
  await decideApproval(r.id, r.token, "rejected");
  check("wait sees rejected", (await waitForApproval(r.id, { pollMs: 5, timeoutMs: 500 })) === "rejected");

  // timeout path (never decided)
  const t = await createApproval("s3", []);
  check("wait times out", (await waitForApproval(t.id, { pollMs: 5, timeoutMs: 60 })) === "timeout");

  // requestApproval returns a handle (no webhook configured → logs, no network)
  const h = await requestApproval({ summary: "x", packageFormatted: [] });
  check("requestApproval returns id+token", !!h.id && !!h.token);

  // the hard guard
  check("Phase A requires approval", postingRequiresApproval() === true);
  let blocked = false;
  try { assertPublishAllowed(false); } catch { blocked = true; }
  check("assertPublishAllowed blocks unapproved", blocked);
  let allowed = true;
  try { assertPublishAllowed(true); } catch { allowed = false; }
  check("assertPublishAllowed allows approved", allowed);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
