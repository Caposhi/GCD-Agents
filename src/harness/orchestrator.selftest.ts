/**
 * Offline self-test for the manager loop. Stubs the subagent runner (no SDK,
 * no API key) and verifies: pass path, revision-on-fail, the 3-cycle cap →
 * escalation, and that `posting` is NEVER invoked by runBrief.
 * Run: npm run build && npm run test:orchestrator
 */

import { runBrief } from "./orchestrator.js";

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

function makeStub(critiqueVerdicts: Array<"PASS" | "FAIL">) {
  const calls: string[] = [];
  const queue = [...critiqueVerdicts];
  const runner = async (name: string, _input: unknown): Promise<any> => {
    calls.push(name);
    switch (name) {
      case "analytics":
        return { headline: "no data — proceed on brand judgment" };
      case "copywriter":
        return [{ platform: "instagram", lang: "en", body: "Your BMW runs best when fluids stay fresh." }];
      case "image":
        return { url: "https://x/y.jpg", alt_text_en: "navy graphic" };
      case "hashtag-seo-timing":
        return [{ platform: "instagram", hashtags: ["#bmwrepair"], recommended_time: "09:00 ET" }];
      case "platform-formatter":
        return [{ platform: "instagram", formatted_body: "..." }];
      case "brand-compliance-critic": {
        const v = queue.shift() ?? "PASS";
        return v === "PASS"
          ? { verdict: "PASS", findings: [] }
          : { verdict: "FAIL", findings: [{ section: "voice", issue: "too hypey", exact_fix: "tone down", owning_subagent: "copywriter" }] };
      }
      default:
        return {};
    }
  };
  return { runner, calls };
}

const brief = { goal: "Promote a brake fluid flush special" };

async function run(): Promise<void> {
  // T1: PASS on first critique
  {
    const { runner, calls } = makeStub(["PASS"]);
    const out = await runBrief(brief, { runner });
    check("T1 awaiting_approval", out.status === "awaiting_approval");
    check("T1 cycles = 1", out.critique.cycles === 1);
    check("T1 formatter ran", calls.includes("platform-formatter"));
    check("T1 posting NEVER called", !calls.includes("posting"));
    check("T1 cost 0 (stub)", out.costUsd === 0);
  }

  // T2: FAIL then PASS → one revision of the owning subagent
  {
    const { runner, calls } = makeStub(["FAIL", "PASS"]);
    const out = await runBrief(brief, { runner });
    check("T2 awaiting_approval", out.status === "awaiting_approval");
    check("T2 cycles = 2", out.critique.cycles === 2);
    check("T2 copywriter re-run (>=2 calls)", calls.filter((c) => c === "copywriter").length >= 2);
    check("T2 posting NEVER called", !calls.includes("posting"));
  }

  // T3: FAIL x3 → escalate, no formatting, no posting
  {
    const { runner, calls } = makeStub(["FAIL", "FAIL", "FAIL"]);
    const out = await runBrief(brief, { runner, maxCritiqueCycles: 3 });
    check("T3 escalated", out.status === "escalated");
    check("T3 cycles = 3", out.critique.cycles === 3);
    check("T3 no formatter on escalate", !calls.includes("platform-formatter"));
    check("T3 posting NEVER called", !calls.includes("posting"));
    check("T3 escalation reason present", typeof out.escalation === "string");
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
