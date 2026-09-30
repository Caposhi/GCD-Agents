/**
 * The fake runner: canned, deterministic responses for every stage and critic
 * lens, so a run can be exercised end to end with no network and no cost.
 * Moved unchanged from `scripts/local/content-run.mjs` (Content Studio S1).
 */

function short(text: unknown, max: number): string {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Canned, deterministic per-stage responses for `--runner fake`.
 *
 * Every citation these responses make is a real evidence id drawn from the
 * caller's own evidence pack or from the immediately preceding stage's own
 * validated output — never an invented fact. That is what makes this safe to
 * run with no model call: the wiring is exercised, not the facts.
 */
export function buildFakeStageResponses(goal: string, pack: any) {
  const bizIds: string[] = pack.allowedFacts.filter((r: any) => r.kind === "verified_business_fact").map((r: any) => r.id);
  const autoIds: string[] = pack.allowedFacts.filter((r: any) => r.kind === "verified_automotive_fact").map((r: any) => r.id);

  return {
    strategyConcept() {
      return {
        angle: `A "peace of mind, done right the first time" angle for: ${short(goal, 160)}`,
        concept: "Short-form piece pairing a real shop fact with the goal, framed around trust and transparency rather than a discount.",
        rationale: "Anchoring on verified business facts (warranty, diagnostics process, ownership) keeps the piece defensible; automotive-truth reviews every citation before anything downstream can use it.",
        supportingFactIds: bizIds.slice(0, 3),
        observationIds: [],
        performanceSignalIds: [],
        hypotheses: [{ statement: "Leading with the warranty term increases trust before price is ever mentioned.", basis: "creative" }],
        assumptions: ["The audience has not worked with GCD before."],
      };
    },
    automotiveTruth() {
      const allowedClaims = [
        ...autoIds.slice(0, 3).map((factId) => ({
          factId, claimClass: "automotive",
          restatement: "Restated plainly, without adding a number, interval, or guarantee the source does not state.",
        })),
        ...bizIds.slice(0, 2).map((factId) => ({
          factId, claimClass: "business",
          restatement: "Restated plainly from the approved business fact, unchanged in meaning.",
        })),
      ];
      return {
        assessment: allowedClaims.length
          ? `${allowedClaims.length} claim(s) are citable against the supplied evidence; everything else stage 1 proposed is forbidden pending real evidence.`
          : "No automotive fact was supplied, so no automotive claim may be made; only business facts remain citable.",
        allowedClaims,
        forbiddenClaims: [{ claim: "Any specific mileage, price, or timeframe not stated verbatim in the cited evidence.", reason: "no_citable_fact" }],
        requiredCaveats: ["Every number or interval in the final copy must trace to a cited fact, verbatim."],
        openQuestions: ["Is there a verified, sourced maintenance interval for the specific system this piece is about?"],
      };
    },
    hookStoryScript(truthOutput: any) {
      const permitted: string[] = truthOutput.constraints.allowed.map((a: any) => a.factId);
      const claimUse = permitted.slice(0, 2).map((factId, i) => ({
        factId, usedIn: i === 0 ? "hook" : "script",
        paraphrase: "Used exactly as automotive-truth permitted it, with no added specifics.",
      }));
      return {
        hook: `Here's what "${short(goal, 80)}" actually looks like at a shop that shows you the diagnosis first.`,
        storyBeats: [
          { beat: "Open on the customer's problem and the uncertainty of not knowing what a shop will find.", role: "setup" },
          { beat: "Show the permitted fact in action — the process, not a promise.", role: "insight" },
          { beat: "Close on the invitation to book, no pressure.", role: "closing" },
        ],
        script: "VO: You don't have to guess what a repair will cost or whether it's needed. That's what the permitted facts back up here, and nothing more than that.",
        claimUse,
        openQuestions: [],
      };
    },
    productionDirection(scriptOutput: any) {
      const usedIds: string[] = scriptOutput.claimUse.used.map((u: any) => u.factId);
      return {
        visualApproach: "Handheld, in-bay footage that shows the work rather than describing it.",
        shots: [
          {
            purpose: "establishing", subject: "The bay, mid-inspection.", framing: "wide", movement: "static",
            action: "Technician reviewing a diagnostic readout.",
            composition: "Vehicle on the lift, readout visible but not legible on camera.",
            continuityNote: "Same technician and bay across every shot in this piece.",
          },
          {
            purpose: "demonstration", subject: "The permitted fact, shown rather than narrated.", framing: "medium", movement: "handheld",
            action: "Technician points to the specific component the permitted fact is about.",
            composition: "Over-the-shoulder, hands and part in frame.",
            continuityNote: "Same lighting as the establishing shot.",
          },
        ],
        overlayText: [],
        productionRequirements: [{ requirement: "Written customer/vehicle consent to film in the bay.", category: "permission" }],
        claimVisuals: usedIds.slice(0, 1).map((factId) => ({
          factId, shotIndex: 1,
          directionSummary: "The second shot exists specifically to show this permitted fact, not to illustrate anything beyond it.",
        })),
        openQuestions: [],
      };
    },
    packagingAdaptation(scriptOutput: any, platforms: string[]) {
      const usedIds: string[] = scriptOutput.claimUse.used.map((u: any) => u.factId);
      const factId = usedIds[0];
      const packages = platforms.map((platform) => {
        const base = "Real diagnosis before real work — that's the whole method. No guessing, no upsell theater.";
        if (platform === "instagram") {
          return {
            platform, caption: base,
            hashtags: ["GermanCarDepot", "BMWRepair", "MercedesRepair", "AudiRepair", "PorscheRepair", "EuroCarCare", "HollywoodFL", "DealershipAlternative"].map((t) => `#${t}`),
            localKeywords: ["Hollywood FL European auto repair", "BMW Mercedes Audi Porsche service Broward"],
            recommendedTime: "09:00 ET",
            openQuestions: [],
          };
        }
        if (platform === "facebook") {
          return {
            platform, caption: base,
            hashtags: ["#GermanCarDepot", "#EuroCarCare"],
            localKeywords: ["Hollywood FL European auto repair"],
            recommendedTime: "12:00 ET",
            openQuestions: [],
          };
        }
        return {
          platform, caption: base,
          hashtags: [],
          localKeywords: ["European auto repair Hollywood FL"],
          recommendedTime: "10:00 ET",
          openQuestions: [],
        };
      });
      const claimUse = factId
        ? platforms.map((platform) => ({ platform, factId, summary: "This platform's caption relies on the same permitted, script-used fact and no other." }))
        : [];
      return { packages, claimUse };
    },
    /**
     * One canned answer per critic lens. The executor sends four requests,
     * each labelled with its lens; each answer uses only that lens's categories.
     */
    finalCritic(packagingOutput: any, platforms: string[], lens: string | undefined) {
      const bound = platforms.flatMap((platform) => {
        const use = packagingOutput.claimUse.used.find((u: any) => u.platform === platform);
        return use ? [{ platform, factId: use.factId }] : [];
      });
      switch (lens) {
        case "evidence-fidelity":
          return {
            verdict: "provisional_pass",
            summary: "Fake-runner evidence lens: every caption relies on the same bound fact. Nothing here was reviewed by a person.",
            findings: [{
              severity: "advisory", category: "claim_fidelity", platform: "cross_platform", owner: "packaging-adaptation",
              issue: "The caption is identical across platforms; check each still says only what its own platform's bound claim supports.",
              suggestedAction: "Vary phrasing per platform while keeping the same permitted fact and the same claim boundary.",
            }],
            claimFindingUse: bound.map(({ platform, factId }) => ({
              findingIndex: 0, platform, factId, summary: "The same fact this platform's caption already cites.",
            })),
          };
        case "platform-and-local":
          return {
            verdict: "provisional_pass",
            summary: "Fake-runner platform lens: no platform-fit concern raised by canned output.",
            findings: [],
            claimFindingUse: [],
          };
        case "voice-and-craft":
          return {
            verdict: "provisional_pass",
            summary: "Fake-runner voice lens: no voice concern raised by canned output.",
            findings: [],
          };
        // One blocking finding owned by production-direction, so a fake run
        // exercises the opt-in revision path (--revise-once, --revise-from) end
        // to end; and one human item, which never reaches a model.
        case "production-coherence":
          return {
            verdict: "needs_revision",
            summary: "Fake-runner production lens: canned output, not a reviewed piece of content.",
            findings: [{
              severity: "blocking", category: "production_coherence", platform: "cross_platform", owner: "production-direction",
              issue: "Canned fake-runner finding: the shot list is not checked against the script, because nothing here was reviewed.",
              suggestedAction: "Re-direct the shots against the script's beats, changing nothing else.",
            }, {
              severity: "advisory", category: "human_decision", platform: "cross_platform", owner: "human_review",
              issue: "This is a canned, fake-runner demonstration output, not a reviewed piece of content.",
              suggestedAction: "A human must review the real evidence, the real script, and the real package before anything here is used.",
            }],
          };
        default:
          throw new Error(`fake runner: no canned answer for critic lens ${JSON.stringify(lens)}`);
      }
    },
  };
}

/**
 * A fake stage runner: answers each request with `buildResponse(request)`,
 * serialized as the provider's text, at no cost. It makes no network call.
 */
export function fakeStageRunner(buildResponse: (request: any) => unknown) {
  return async (request: any) => ({
    text: JSON.stringify(buildResponse(request)), totalCostUsd: 0, usage: { input_tokens: 0, output_tokens: 0 },
  });
}
