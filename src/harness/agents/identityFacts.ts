/**
 * The shop's identity records — the makes it services and its service area —
 * supplied to stage 5 and bound on every platform by code, never chosen by a
 * model.
 *
 * ## Why this exists
 *
 * In the owner's run of 2026-09-25 (`2026-09-25T16-21-51-293Z`) eight of the
 * critic's seventeen blocking findings were about facts no stage had bound, as
 * the owner reported them: no stated rationale, and the makes, the oil
 * specification and the records, squeezed out by stage 2's twelve-claim
 * whitelist. Stage 5's only factual authority was the set of claims stage 3
 * actually used, so a hashtag or local keyword naming a make or a place was
 * supported only when stage 3 happened to have used the record that says so.
 * The owner decided on 2026-09-25 that brand names in hashtags and local
 * keywords are approved as descriptive use, with no affiliation implied, and
 * that the identity records are attached by code, the way the contact line is.
 *
 * ## What it guarantees
 *
 *  - **The evidence system's own wording.** Each record is the pack's own
 *    `approved-facts:makes` / `approved-facts:servicearea` record, rendered
 *    exactly as every other claim record is rendered (id, kind, claim,
 *    attribute). Nothing here writes, trims or rewords a claim.
 *  - **Deterministic, on every platform.** `packagingClaimUniverse` in
 *    `packagingAdaptation.ts` appends these records, in this module's order, to
 *    the records stage 3 used; `packagingClaimRecords` binds them on every
 *    requested platform after the platform's own model bindings. No model
 *    decides whether they are bound, and the critic's `PLATFORM_CLAIMS` always
 *    shows them.
 *  - **Fail closed, for free.** A record that is absent, not a verified business
 *    fact, carries the wrong attribute, does not read `"<field>: <value>"`, or is
 *    not usable in the pack (conflicted, stale, inactive) is an
 *    `IdentityFactError` before any paid call. The local run checks both records
 *    right after it builds the pack, before the cost gate.
 *
 * ## What it is not
 *
 * Not a permission to claim anything beyond what the two records say. A make
 * named in a hashtag or keyword says which vehicles the shop services; it does
 * not say the shop is affiliated with, authorized by, or a dealer for that
 * make, and the stage 5 prompt says so. The records widen stage 5's claim set
 * by exactly two records; stage 2's whitelist, the rest of the evidence pack and
 * model knowledge stay out of it.
 */

import type { EvidenceRecord } from "../evidence/contract.js";
import type { EvidencePack } from "../evidence/pack.js";

/** The identity records stage 5 binds on every platform, in this order, and nothing else. */
export const IDENTITY_FACTS = {
  makes: { id: "approved-facts:makes", field: "makes" },
  serviceArea: { id: "approved-facts:servicearea", field: "serviceArea" },
} as const;
export type IdentityFactKey = keyof typeof IDENTITY_FACTS;

/** The identity record ids, in the order they are rendered and bound. */
export const IDENTITY_FACT_IDS: readonly string[] = Object.values(IDENTITY_FACTS).map((fact) => fact.id);

/** Raised by this module. Always before any model call. */
export class IdentityFactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityFactError";
  }
}

const fail = (message: string): never => {
  throw new IdentityFactError(message);
};

/**
 * Read one identity record out of the pack.
 *
 * The record must be a usable (`allowedFacts`) verified business fact with the
 * expected id and attribute, and its claim must read `"<field>: <value>"` — the
 * form the approved-facts adapter writes — with a non-empty value.
 */
export function readIdentityRecord(pack: EvidencePack, key: IdentityFactKey): EvidenceRecord {
  const { id, field } = IDENTITY_FACTS[key];
  const record = (pack?.allowedFacts ?? []).find((r) => r.id === id);
  if (!record) {
    return fail(
      `the evidence pack has no usable "${id}" record, which stage 5 binds on every platform; `
      + "refusing before any paid call rather than letting a make- or place-naming caption, hashtag "
      + "or keyword go unsupported (the record is absent, or it is conflicted, stale or inactive)",
    );
  }
  if (record.kind !== "verified_business_fact") {
    fail(`"${id}" is a ${record.kind}, not a verified_business_fact`);
  }
  if (record.attribute !== field) {
    fail(`"${id}" carries attribute ${JSON.stringify(record.attribute)}, not "${field}"`);
  }
  const prefix = `${field}: `;
  if (!record.claim.startsWith(prefix) || !record.claim.slice(prefix.length).trim()) {
    fail(`"${id}" claim does not read "${prefix}<value>"`);
  }
  return record;
}

/** Both identity records, in `IDENTITY_FACTS` order. Fails closed on either. */
export function identityFactRecords(pack: EvidencePack): EvidenceRecord[] {
  return (Object.keys(IDENTITY_FACTS) as IdentityFactKey[]).map((key) => readIdentityRecord(pack, key));
}

/**
 * The free preflight: both identity records are present and usable. The local
 * run calls this right after it builds the evidence pack, before the cost gate.
 */
export function assertIdentityFactsAvailable(pack: EvidencePack): void {
  identityFactRecords(pack);
}
