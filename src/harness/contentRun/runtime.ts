/**
 * The compiled modules the content-run pipeline drives, bundled as one
 * runtime object.
 *
 * Every pipeline function takes this object as its first argument instead of
 * importing the stages itself, exactly as `scripts/local/content-run.mjs` did
 * before Content Studio S1 moved its core here. That keeps one seam the offline
 * suite relies on: it hands a pipeline function a runtime whose executors,
 * pack builder or registry throw when touched, and so proves a path never
 * reaches them (`--list-tags`, a resume's stages 1-4).
 *
 * Importing this module loads every stage executor. It is therefore reachable
 * only from `scripts/local/content-run.mjs` and, later, `src/studio/worker/**`
 * — never from a live `gcd-social-*` entry point. The offline suite's
 * import-graph check and caller allowlist enforce both
 * (docs/CONTENT_STUDIO_DESIGN.md §5.4).
 */

import * as approved from "../evidence/approvedFacts.js";
import * as packModule from "../evidence/pack.js";
import * as registryModule from "../agents/registry.js";
import * as stageExecution from "../agents/stageExecution.js";
import * as strategy from "../agents/strategyConcept.js";
import * as truth from "../agents/automotiveTruth.js";
import * as script from "../agents/hookStoryScript.js";
import * as direction from "../agents/productionDirection.js";
import * as packaging from "../agents/packagingAdaptation.js";
import * as critic from "../agents/finalCritic.js";
import * as modelPolicy from "../agents/modelPolicy.js";
import * as payloadContract from "../agents/payloadContract.js";
import * as contact from "../agents/contactLine.js";
import * as identity from "../agents/identityFacts.js";
import * as revision from "../agents/revision.js";

export interface ContentRunRuntime {
  approved: typeof approved;
  packModule: typeof packModule;
  registryModule: typeof registryModule;
  stageExecution: typeof stageExecution;
  strategy: typeof strategy;
  truth: typeof truth;
  script: typeof script;
  direction: typeof direction;
  packaging: typeof packaging;
  critic: typeof critic;
  modelPolicy: typeof modelPolicy;
  payloadContract: typeof payloadContract;
  contact: typeof contact;
  identity: typeof identity;
  revision: typeof revision;
}

/** A fresh runtime object over the compiled modules. */
export function loadRuntime(): ContentRunRuntime {
  return {
    approved, packModule, registryModule, stageExecution, strategy, truth, script, direction,
    packaging, critic, modelPolicy, payloadContract, contact, identity, revision,
  };
}
