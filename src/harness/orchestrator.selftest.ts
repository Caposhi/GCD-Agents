/**
 * Offline self-test for the manager loop and canonical-provider boundary.
 * No SDK, image provider, network, database, approval decision, or publishing.
 * Run: npm run build && npm run test:orchestrator
 */

import { inspectImageText } from "./imageQc.js";
import { config } from "./config.js";
import {
  clearSimulatedDryRunEnvironment,
  prepareSimulatedDryRunEnvironment,
  dryRunReportPasses,
  DryRunReport,
  SIMULATED_DRYRUN_ENV_KEYS,
} from "./dryrun.js";
import {
  buildFinalPackage,
  canonicalProviderPayloadJson,
  FinalPackage,
  sanitizeSlackSummaryText,
  toPostPackages,
  validateFinalPackage,
} from "./packageMap.js";
import {
  AgentRunner,
  assertPlatformSafePublicationJpeg,
  ImageResolver,
  isTrustedGeneratedImageUrl,
  parseAgentJson,
  publicationImageDimensions,
  runBrief,
  validateGeneratedImageHeader,
} from "./orchestrator.js";

let failures = 0;
function check(name: string, cond: boolean): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

const HASHTAGS = [
  "#bmwrepair",
  "#hollywoodfl",
  "#europeancarservice",
  "#germancar",
  "#brakeservice",
  "#autocare",
  "#broward",
  "#germancardepot",
];
const CONTENT_SHA = "a".repeat(64);
const MEDIA_URL = `https://img.gcd.example/media/00000000-0000-4000-8000-000000000001-${CONTENT_SHA}.jpg`;
const PUBLICATION_TARGETS = {
  instagram: { accountId: "ig-offline", apiHost: "graph.instagram.com", apiVersion: "v25.0" },
  facebook: { accountId: "fb-offline", apiHost: "graph.facebook.com", apiVersion: "v25.0" },
  gbp: { accountId: "gbp-offline", locationId: "location-offline", apiHost: "mybusiness.googleapis.com", apiVersion: "v4" },
} as const;

const COPY = [
  { platform: "instagram", lang: "en", body: "Your BMW runs best when fluids stay fresh." },
  { platform: "instagram", lang: "es", body: "Tu BMW funciona mejor con fluidos frescos." },
  { platform: "facebook", lang: "en", body: "Simple care for your European car." },
  { platform: "facebook", lang: "es", body: "Cuidado sencillo para tu auto europeo." },
  { platform: "gbp", lang: "en", body: "European car service in Hollywood, Florida." },
  { platform: "gbp", lang: "es", body: "Servicio para autos europeos en Hollywood, Florida." },
];

const TAGS = [
  { platform: "instagram", hashtags: HASHTAGS, recommended_time: "09:00 ET" },
  { platform: "facebook", hashtags: [], recommended_time: "12:00 ET" },
  { platform: "gbp", hashtags: [], recommended_time: "08:00 ET" },
];

const FORMATTER = [
  { platform: "instagram", lang: "en", formatted_body: "Your BMW runs best when fluids stay fresh." },
  { platform: "instagram", lang: "es", formatted_body: "Tu BMW funciona mejor con fluidos frescos." },
  { platform: "facebook", lang: "en", formatted_body: "Simple care for your European car." },
  { platform: "facebook", lang: "es", formatted_body: "Cuidado sencillo para tu auto europeo." },
  {
    platform: "gbp",
    lang: "en",
    formatted_body: "European car service in Hollywood, Florida.",
    // Adversarial formatter URL: canonical construction must replace it with
    // the booking URL from checked-in approved facts.
    cta: { actionType: "BOOK", url: "https://evil.example/book" },
  },
  { platform: "gbp", lang: "es", formatted_body: "Servicio para autos europeos en Hollywood, Florida." },
];

const IMAGE_SPEC = {
  contentType: "text-graphic",
  prompt: "Premium branded brake-service graphic.",
  in_image_text: ["BRAKE SERVICE", "German Car Depot"],
  alt_text_en: "Navy brake-service graphic with the German Car Depot wordmark.",
  alt_text_es: "Gráfico azul de servicio de frenos con el logotipo de German Car Depot.",
};

const inspectedImageResolver: ImageResolver = async (specification) => ({
  ...specification,
  url: MEDIA_URL,
  contentSha256: CONTENT_SHA,
  model: "offline-fixture",
  aiGenerated: true,
  qcFailed: false,
  qc: { ok: true, issues: [], readText: specification.in_image_text, attempts: 1, errored: false },
  inspection: { status: "passed", attempts: 1, readText: specification.in_image_text },
});

function makeStub(critiqueVerdicts: Array<"PASS" | "FAIL">, imageOutput: any = IMAGE_SPEC) {
  const calls: string[] = [];
  const inputs: Array<{ name: string; input: any }> = [];
  const queue = [...critiqueVerdicts];
  const runner = async (name: string, input: unknown): Promise<any> => {
    calls.push(name);
    inputs.push({ name, input });
    switch (name) {
      case "analytics":
        return { headline: "no data — proceed on brand judgment" };
      case "copywriter":
        return COPY;
      case "image":
        return imageOutput;
      case "hashtag-seo-timing":
        return TAGS;
      case "platform-formatter":
        return FORMATTER;
      case "brand-compliance-critic": {
        const verdict = queue.shift() ?? "PASS";
        return verdict === "PASS"
          ? { verdict: "PASS", findings: [] }
          : {
              verdict: "FAIL",
              findings: [{ section: "voice", issue: "too hypey", exact_fix: "tone down", owning_subagent: "copywriter" }],
            };
      }
      default:
        return {};
    }
  };
  return { runner, calls, inputs };
}

const brief = { goal: "Promote a brake fluid flush special" };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function run(): Promise<void> {
  // JSON extraction contract.
  check("parse top-level array", Array.isArray(parseAgentJson('[{"platform":"instagram"}]')));
  check("parse fenced array", parseAgentJson('```json\n[{"x":2}]\n```')[0]?.x === 2);
  check("parse object", parseAgentJson('{"v":3}').v === 3);
  const safeSlackPreview = sanitizeSlackSummaryText(
    "<!channel> @channel\n<https://evil.example|Fake review> https://evil.example & approve here",
  );
  check(
    "Slack summary neutralizes model-authored mentions/links/control lines",
    !safeSlackPreview.includes("<")
      && !safeSlackPreview.includes(">")
      && !safeSlackPreview.includes("\n")
      && !safeSlackPreview.includes("https://")
      && !safeSlackPreview.includes("@channel")
      && safeSlackPreview.includes("&lt;!channel&gt;"),
  );

  // T1: the first critic sees the exact, valid provider-bound package.
  {
    const { runner, calls, inputs } = makeStub(["PASS"]);
    const out = await runBrief(
      {
        ...brief,
        make: "BMW",
        service: "brake fluid flush",
        dayIndex: 2,
        approvedFacts: { bookingUrl: "https://evil.example/override", warranty: "invented" },
      } as any,
      { runner, imageResolver: inspectedImageResolver, publicationTargets: PUBLICATION_TARGETS },
    );
    check("T1 awaiting_approval", out.status === "awaiting_approval");
    check("T1 cycles = 1", out.critique.cycles === 1);
    check("T1 formatter runs before final critic", calls.indexOf("platform-formatter") < calls.indexOf("brand-compliance-critic"));
    check("T1 posting NEVER called", !calls.includes("posting"));

    const copyInput = inputs.find((call) => call.name === "copywriter")?.input;
    check("T1 caller approvedFacts override discarded", copyInput?.brief?.approvedFacts?.bookingUrl !== "https://evil.example/override");
    check("T1 caller invented fact discarded", copyInput?.brief?.approvedFacts?.warranty !== "invented");
    check("T1 scheduler brief context remains available", copyInput?.brief?.make === "BMW" && copyInput?.brief?.service === "brake fluid flush" && copyInput?.brief?.dayIndex === 2);

    const criticInput = inputs.find((call) => call.name === "brand-compliance-critic")?.input;
    const pkg = out.package as FinalPackage;
    const ig = pkg.providerPayloads.find((payload) => payload.platform === "instagram");
    const fb = pkg.providerPayloads.find((payload) => payload.platform === "facebook");
    const gbp = pkg.providerPayloads.find((payload) => payload.platform === "gbp");
    check("T1 critic received final package object", criticInput?.candidate?.schemaVersion === "gcd-final-package/v1");
    check("T1 critic sees already-applied hashtags", criticInput?.candidate?.providerPayloads?.[0]?.text?.endsWith(HASHTAGS.join(" ")) === true);
    check("T1 exact provider array is nonempty", pkg.providerPayloads.length === 3);
    check("T1 critic sees approval-bound destination", criticInput?.candidate?.providerPayloads?.[0]?.target?.accountId === "ig-offline");
    check("T1 final provider payload is immutable", Object.isFrozen(pkg) && Object.isFrozen(pkg.providerPayloads) && Object.isFrozen(pkg.providerPayloads[0]));
    check("T1 canonical validation passes", validateFinalPackage(pkg).ok);
    check("T1 IG hashtags applied exactly once", ig?.text.split(HASHTAGS.join(" ")).length === 2);
    check("T1 IG carries supported alt/disclosure fields", !!ig?.images?.[0]?.altText && ig.images[0].aiGenerated === true);
    check("T1 FB omits unsupported alt/disclosure fields", fb?.images?.[0]?.altText === undefined && fb?.images?.[0]?.aiGenerated === undefined);
    check("T1 GBP omits unsupported alt/disclosure fields", gbp?.images?.[0]?.altText === undefined && gbp?.images?.[0]?.aiGenerated === undefined);
    check("T1 unapproved formatter CTA rejected", gbp?.gbp?.callToAction?.url !== "https://evil.example/book");
    check("T1 canonical booking CTA inserted before critic", criticInput?.candidate?.providerPayloads?.find((p: any) => p.platform === "gbp")?.gbp?.callToAction?.url === gbp?.gbp?.callToAction?.url);
    check("T1 booking destination deterministically uses BOOK", gbp?.gbp?.callToAction?.actionType === "BOOK");
    check("T1 publisher handoff is byte-equivalent", JSON.stringify(toPostPackages(pkg)) === JSON.stringify(pkg.providerPayloads));
    check("T1 cost 0 (stub)", out.costUsd === 0);
  }

  // T2: FAIL then PASS reruns formatter/build/validation/critic after revision.
  {
    const { runner, calls } = makeStub(["FAIL", "PASS"]);
    const out = await runBrief(brief, { runner, imageResolver: inspectedImageResolver, publicationTargets: PUBLICATION_TARGETS });
    check("T2 awaiting_approval", out.status === "awaiting_approval");
    check("T2 cycles = 2", out.critique.cycles === 2);
    check("T2 copywriter re-run", calls.filter((call) => call === "copywriter").length >= 2);
    check("T2 formatter rebuilt every cycle", calls.filter((call) => call === "platform-formatter").length === 2);
    check("T2 final critic ran every cycle", calls.filter((call) => call === "brand-compliance-critic").length === 2);
    check("T2 posting NEVER called", !calls.includes("posting"));
  }

  // T3: FAIL x3 escalates after three complete canonical review cycles.
  {
    const { runner, calls } = makeStub(["FAIL", "FAIL", "FAIL"]);
    const out = await runBrief(brief, {
      runner,
      imageResolver: inspectedImageResolver,
      publicationTargets: PUBLICATION_TARGETS,
      maxCritiqueCycles: 3,
    });
    check("T3 escalated", out.status === "escalated");
    check("T3 cycles = 3", out.critique.cycles === 3);
    check("T3 formatter ran for all cycles", calls.filter((call) => call === "platform-formatter").length === 3);
    check("T3 posting NEVER called", !calls.includes("posting"));
    check("T3 escalation reason present", typeof out.escalation === "string");
  }

  // Untagged legacy formatter output may refine English only; Spanish comes
  // from the explicit Spanish copy and is never duplicated from English.
  {
    const resolved = await inspectedImageResolver(IMAGE_SPEC);
    const pkg = buildFinalPackage(
      COPY.filter((entry) => entry.platform === "instagram"),
      [{ platform: "instagram", formatted_body: "Formatted English only." }],
      resolved,
      [TAGS[0]],
      { activePlatforms: ["instagram"], publicationTargets: PUBLICATION_TARGETS },
    );
    const body = pkg.providerPayloads[0]?.text ?? "";
    check("language mapping keeps untagged formatter body English-only", body.startsWith("Formatted English only.\n\nTu BMW"));
    check("language mapping does not duplicate untagged body", body.split("Formatted English only.").length === 2);
    check("language mapping remains canonical", validateFinalPackage(pkg).ok);
    const blocked = buildFinalPackage(
      COPY.filter((entry) => entry.platform === "instagram"),
      [{ platform: "instagram", lang: "en", formatted_body: "Formatted English only.", blocking_issue: "claim cannot fit" }],
      resolved,
      [TAGS[0]],
      { activePlatforms: ["instagram"], publicationTargets: PUBLICATION_TARGETS },
    );
    check("formatter blocking_issue cannot become approvable", !validateFinalPackage(blocked).ok);
  }

  // No mapping-time mutation is permitted; drift is rejected, and a coherent
  // external mutation necessarily changes the canonical approval bytes.
  {
    const resolved = await inspectedImageResolver(IMAGE_SPEC);
    const original = buildFinalPackage(COPY, FORMATTER, resolved, TAGS, {
      activePlatforms: ["instagram", "facebook", "gbp"],
      publicationTargets: PUBLICATION_TARGETS,
      bookingUrl: "https://gcd.example/book",
      approvedCtaUrls: ["https://gcd.example/book"],
    });
    const originalBytes = canonicalProviderPayloadJson(original);

    const captionDrift = clone(original);
    captionDrift.providerPayloads[0]!.text += " MUTATED";
    let captionBlocked = false;
    try { toPostPackages(captionDrift); } catch { captionBlocked = true; }
    check("provider caption drift from preview is blocked", captionBlocked);

    const hashtagDrift = clone(original);
    hashtagDrift.platforms[0]!.hashtags!.push("#afterapproval");
    let hashtagsBlocked = false;
    try { toPostPackages(hashtagDrift); } catch { hashtagsBlocked = true; }
    check("post-build hashtag mutation is blocked", hashtagsBlocked);

    const mediaDrift = clone(original);
    mediaDrift.providerPayloads[0]!.images![0]!.url = "https://evil.example/substitute.jpg";
    let mediaBlocked = false;
    try { toPostPackages(mediaDrift); } catch { mediaBlocked = true; }
    check("post-build media substitution is blocked", mediaBlocked);

    const targetDrift = clone(original);
    targetDrift.providerPayloads[0]!.target.accountId = "attacker-account";
    check("post-build destination substitution is blocked", !validateFinalPackage(targetDrift).ok);

    const unknownField = clone(original) as any;
    unknownField.providerPayloads[0].unmappedProviderField = "ignored";
    check("unknown or provider-ignored payload field is blocked", !validateFinalPackage(unknownField).ok);

    const missingActivePlatform = clone(original);
    missingActivePlatform.providerPayloads.pop();
    missingActivePlatform.platforms.pop();
    check("missing active-platform payload is blocked", !validateFinalPackage(missingActivePlatform).ok);

    const hiddenInstagramHashtag = clone(original);
    hiddenInstagramHashtag.providerPayloads[0]!.text = hiddenInstagramHashtag.providerPayloads[0]!.text.replace(
      "Your BMW",
      "Your #sneaky BMW",
    );
    hiddenInstagramHashtag.platforms[0]!.body = hiddenInstagramHashtag.providerPayloads[0]!.text;
    check("inline IG hashtag outside canonical list is blocked", !validateFinalPackage(hiddenInstagramHashtag).ok);

    const gbpHashtag = clone(original);
    const gbpIndex = gbpHashtag.providerPayloads.findIndex((payload) => payload.platform === "gbp");
    gbpHashtag.providerPayloads[gbpIndex]!.text += " #promo";
    gbpHashtag.platforms[gbpIndex]!.body += " #promo";
    check("provider-visible GBP hashtag is blocked", !validateFinalPackage(gbpHashtag).ok);

    const coherentMutation = clone(original);
    coherentMutation.providerPayloads[0]!.text = coherentMutation.providerPayloads[0]!.text.replace("Your BMW", "A BMW");
    coherentMutation.platforms[0]!.body = coherentMutation.platforms[0]!.body.replace("Your BMW", "A BMW");
    check("externally visible coherent mutation changes approval bytes", canonicalProviderPayloadJson(coherentMutation) !== originalBytes);
  }

  // A model URL is never trusted as resolved media. No provider call occurs
  // because this adversarial specification supplies no generation prompt.
  {
    const { runner, calls } = makeStub(["PASS"], {
      url: "https://evil.example/model-injected.jpg",
      alt_text_en: "attacker-selected media",
      qc: { ok: true },
      inspection: { status: "passed" },
    });
    const out = await runBrief(brief, { runner, publicationTargets: PUBLICATION_TARGETS });
    check("model-returned remote image URL escalates", out.status === "escalated");
    check("model-returned remote image never reaches formatter", !calls.includes("platform-formatter"));
    check("model-returned remote image never becomes approvable", out.package === undefined);
  check("arbitrary generated-media host is not trusted", !isTrustedGeneratedImageUrl("https://evil.example/image.jpg"));
  check("lookalike fal media host is not trusted", !isTrustedGeneratedImageUrl("https://fal.media.evil.example/image.jpg"));
  check(
    "fal media policy rejects credentials and nonstandard ports",
    !isTrustedGeneratedImageUrl("https://user:pass@fal.media/image.jpg")
      && !isTrustedGeneratedImageUrl("https://fal.media:8443/image.jpg"),
  );
    check("fal media host policy is explicit", isTrustedGeneratedImageUrl("https://v3.fal.media/files/image.jpg"));
  }

  // Vision infrastructure and malformed responses fail closed.
  {
    const clean = await inspectImageText("offline-bytes", ["BRAKE SERVICE"], async () => ({
      text: JSON.stringify({ readText: ["BRAKE SERVICE"], garbled: false, unsafe: false, issues: [] }),
      totalCostUsd: 0,
      usage: undefined,
    }));
    check("QC clean contract passes", clean.ok && !clean.garbled && !clean.unsafe);
    const failed = await inspectImageText("offline-bytes", [], async () => { throw new Error("offline inspector outage"); });
    check("QC infrastructure failure fails closed", !failed.ok && failed.garbled && failed.unsafe && failed.errored === true);
    const malformed = await inspectImageText("offline-bytes", [], async () => ({ text: "{}", totalCostUsd: 0, usage: undefined }));
    check("QC malformed response fails closed", !malformed.ok && malformed.errored === true);
    const privacyBlock = await inspectImageText("offline-bytes", [], async () => ({
      text: JSON.stringify({ readText: [], garbled: false, unsafe: true, issues: ["readable license plate"] }),
      totalCostUsd: 0,
      usage: undefined,
    }));
    check("QC privacy/safety finding blocks publication", !privacyBlock.ok && privacyBlock.unsafe);

    const originalNodeEnv = config.nodeEnv;
    config.nodeEnv = "production";
    try {
      const injected = await inspectImageText("offline-bytes", [], async () => ({
        text: JSON.stringify({ readText: [], garbled: false, unsafe: false, issues: [] }),
        totalCostUsd: 0,
        usage: undefined,
      }));
      check("production QC rejects injected inspector runners", !injected.ok && injected.errored === true);
    } finally {
      config.nodeEnv = originalNodeEnv;
    }
  }

  // A critic-requested image revision is subject to the same fail-closed gate,
  // even when the active provider does not independently require media.
  {
    const originalPlatforms = [...config.activePlatforms];
    config.activePlatforms = ["facebook"];
    try {
      const base = makeStub(["PASS"]);
      let criticCalls = 0;
      const runner: AgentRunner = async (name, input) => {
        if (name === "brand-compliance-critic") {
          criticCalls += 1;
          return criticCalls === 1
            ? {
                verdict: "FAIL",
                findings: [{
                  section: "image",
                  issue: "replace unsafe image",
                  exact_fix: "regenerate image",
                  owning_subagent: "image",
                }],
              }
            : { verdict: "PASS", findings: [] };
        }
        return base.runner(name, input);
      };
      let resolverCalls = 0;
      const revisionFailingResolver: ImageResolver = async (specification) => {
        resolverCalls += 1;
        if (resolverCalls === 1) return inspectedImageResolver(specification);
        return {
          ...specification,
          aiGenerated: true,
          qcFailed: true,
          qc: { ok: false, issues: ["offline revision QC outage"], readText: [], attempts: 1, errored: true },
        };
      };
      const out = await runBrief(brief, {
        runner,
        imageResolver: revisionFailingResolver,
        publicationTargets: PUBLICATION_TARGETS,
      });
      check("FB-only image revision QC failure escalates", out.status === "escalated");
      check("failed revised image never becomes approvable", out.package === undefined);
      check("failed revised image cannot reach a later critic PASS", resolverCalls === 2 && criticCalls === 1);
    } finally {
      config.activePlatforms = originalPlatforms;
    }
  }

  // Header parsing is pure and runs before Jimp pixel decode.
  {
    const png = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png, 0);
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(1_080, 16);
    png.writeUInt32BE(1_350, 20);
    check("approved 4:5 PNG header passes before decode", validateGeneratedImageHeader(png).width === 1_080);

    const jpeg = Buffer.alloc(21);
    jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
    jpeg.writeUInt16BE(1_350, 7);
    jpeg.writeUInt16BE(1_080, 9);
    check("approved 4:5 JPEG header passes before decode", validateGeneratedImageHeader(jpeg).format === "jpeg");
    check(
      "shared hosted-media guard accepts the approved JPEG profile",
      assertPlatformSafePublicationJpeg(jpeg).width === 1_080,
    );

    let pngPublicationBlocked = false;
    try { assertPlatformSafePublicationJpeg(png); } catch { pngPublicationBlocked = true; }
    check("shared hosted-media guard rejects non-JPEG bytes", pngPublicationBlocked);

    const tooLargeJpeg = Buffer.alloc(5 * 1024 * 1024 + 1);
    jpeg.copy(tooLargeJpeg);
    let largePublicationBlocked = false;
    try { assertPlatformSafePublicationJpeg(tooLargeJpeg); } catch { largePublicationBlocked = true; }
    check("shared hosted-media guard rejects JPEGs over 5 MiB", largePublicationBlocked);

    const oversize = Buffer.from(png);
    oversize.writeUInt32BE(4_097, 16);
    let oversizeBlocked = false;
    try { validateGeneratedImageHeader(oversize); } catch { oversizeBlocked = true; }
    check("oversize compressed-image header is blocked before decode", oversizeBlocked);

    const awkward = Buffer.from(png);
    awkward.writeUInt32BE(512, 16);
    awkward.writeUInt32BE(2_048, 20);
    let awkwardBlocked = false;
    try { validateGeneratedImageHeader(awkward); } catch { awkwardBlocked = true; }
    check("non-platform-safe image ratio is blocked before decode", awkwardBlocked);
    check(
      "model-authored unsupported dimensions normalize to the safe 4:5 feed profile",
      publicationImageDimensions(512, 2_048).width === 1_080
        && publicationImageDimensions(512, 2_048).height === 1_350,
    );

    let unsupportedBlocked = false;
    try { validateGeneratedImageHeader(Buffer.from("RIFFfakeWEBP")); } catch { unsupportedBlocked = true; }
    check("unsupported generated image format is blocked before decode", unsupportedBlocked);
  }

  // Missing/invalid target configuration fails before any model or provider IO.
  {
    const { runner, calls } = makeStub(["PASS"]);
    const out = await runBrief(brief, { runner, imageResolver: inspectedImageResolver, publicationTargets: {} });
    check("missing publication target escalates fail-closed", out.status === "escalated");
    check("missing publication target fails before agent calls", calls.length === 0);
  }

  // Injectable runner/media/target seams exist only for offline validation and
  // cannot be used to fabricate QC provenance in the production runtime.
  {
    const originalNodeEnv = config.nodeEnv;
    config.nodeEnv = "production";
    let productionSeamBlocked = false;
    try {
      const { runner } = makeStub(["PASS"]);
      await runBrief(brief, {
        runner,
        imageResolver: inspectedImageResolver,
        publicationTargets: PUBLICATION_TARGETS,
      });
    } catch (err) {
      productionSeamBlocked = (err as Error).message.startsWith("BLOCKED:");
    } finally {
      config.nodeEnv = originalNodeEnv;
    }
    check("production runtime rejects offline QC/runner/target seams", productionSeamBlocked);
  }

  // The former empty-array Array#every false-positive is explicitly rejected.
  {
    const emptyReport: DryRunReport = {
      status: "escalated",
      critiqueCycles: 1,
      verdict: "FAIL",
      postCount: 0,
      builtRequests: [],
      scorecard: [],
    };
    check("empty dry-run request array does not pass", !dryRunReportPasses(emptyReport));

    const fixture: Record<string, string | undefined> = {
      NODE_ENV: "production",
      ACTIVE_PLATFORMS: "instagram,facebook,gbp",
      ANTHROPIC_API_KEY: "must-be-removed",
      DATABASE_URL: "must-be-removed",
      APPROVAL_CHANNEL_WEBHOOK: "must-be-removed",
      IG_ACCESS_TOKEN: "must-be-removed",
    };
    clearSimulatedDryRunEnvironment(fixture);
    check(
      "simulated dry run scrubs every credential/provider/database/Slack environment key",
      SIMULATED_DRYRUN_ENV_KEYS.every((key) => fixture[key] === undefined),
    );
    check("simulated dry run preserves non-secret platform selection", fixture.ACTIVE_PLATFORMS === "instagram,facebook,gbp");
    prepareSimulatedDryRunEnvironment(fixture);
    check("simulated dry run forces a non-production config before dynamic import", fixture.NODE_ENV === "test");
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
