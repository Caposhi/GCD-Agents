-- Payload-contract reconciliation: bounded evidence text.
--
-- Phase 0B.0 gave every evidence field a *presence* rule and no *size* rule:
-- `claim` and `subject` had to be non-empty and nothing more. Every projection
-- built from a record inherited that, so no payload the six dormant Content
-- Intelligence stages assemble had a finite maximum, however tightly each stage
-- bounded its own fields.
--
-- These constraints use the same numeric ceilings as
-- src/harness/agents/payloadContract.ts → EVIDENCE_LIMITS. TypeScript may
-- conservatively reject a detail object whose worst-case canonical JSONB form
-- exceeds the limit even when one concrete PostgreSQL rendering would fit; it
-- never accepts a detail PostgreSQL rejects. Both layers exist for the same reason migration 006 states:
-- application validation gives good errors, the database makes the invariant
-- true. An offline regression asserts the two sets of numbers agree, so a
-- TypeScript bound cannot be raised without this file being updated with it.
--
-- Applying this to production is a SEPARATE, SEPARATELY AUTHORIZED operation.
-- It has not been applied to production. Disposable PostgreSQL 16 and 18 tests
-- apply, enforce, roll back, and reapply it. A read-only, aggregate-only
-- production audit run by the operator on 2026-09-02 found `content_evidence` and
-- `content_evidence_relations` both empty — zero rows, zero blank claims, zero
-- blank subjects, zero rows carrying detail JSON, zero relation notes — so no
-- stored row can violate any bound below and the constraints are written to
-- validate immediately rather than as NOT VALID. That audit is the reason the
-- immediate form is safe; it is not the reason for any particular number.
--
-- Rollback: state/rollback/007_evidence_bounds_rollback.sql. The runner is
-- forward-only by design (docs/DATA_MODEL.md), so the rollback lives outside
-- state/migrations and is applied by hand under its own authorization.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- PostgreSQL forbids a subquery inside a CHECK constraint, and there is no
-- per-element length operator for arrays, so bounding each tag needs a helper.
-- The versioned name and plain CREATE are deliberate: migration 007 must fail
-- on an unexpected name collision, never replace a pre-existing helper and
-- later remove code it did not own.
-- It is IMMUTABLE (its result depends only on its arguments), STRICT (a NULL
-- array yields NULL, which a CHECK accepts, matching every other optional
-- column here), and PARALLEL SAFE. `coalesce` makes the empty array pass rather
-- than yield NULL.
CREATE FUNCTION gcd_content_evidence_tags_within_v007(tags text[], max_len integer)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
AS $$
  SELECT coalesce(bool_and(
    t IS NOT NULL AND length(t) <= max_len AND octet_length(t) <= max_len
  ), true) FROM unnest(tags) AS t;
$$;

ALTER TABLE content_evidence
  -- Identity and the two required text fields.
  ADD CONSTRAINT content_evidence_id_bounded
    CHECK (length(id) <= 200 AND octet_length(id) <= 200),
  ADD CONSTRAINT content_evidence_claim_bounded
    CHECK (length(claim) <= 1000 AND octet_length(claim) <= 1000),
  ADD CONSTRAINT content_evidence_subject_bounded
    CHECK (length(subject) <= 200 AND octet_length(subject) <= 200),

  -- Optional text. NULL stays permitted; a present value is bounded.
  ADD CONSTRAINT content_evidence_attribute_bounded
    CHECK (attribute IS NULL OR (length(attribute) <= 120 AND octet_length(attribute) <= 120)),
  ADD CONSTRAINT content_evidence_source_ref_bounded
    CHECK (source_ref IS NULL OR (length(source_ref) <= 500 AND octet_length(source_ref) <= 500)),
  ADD CONSTRAINT content_evidence_provenance_bounded
    CHECK (provenance IS NULL OR (length(provenance) <= 500 AND octet_length(provenance) <= 500)),
  ADD CONSTRAINT content_evidence_reviewed_by_bounded
    CHECK (reviewed_by IS NULL OR (length(reviewed_by) <= 200 AND octet_length(reviewed_by) <= 200)),
  ADD CONSTRAINT content_evidence_superseded_by_id_bounded
    CHECK (superseded_by_id IS NULL OR (length(superseded_by_id) <= 200 AND octet_length(superseded_by_id) <= 200)),

  -- Tags: both how many, and how long each may be.
  ADD CONSTRAINT content_evidence_tags_bounded
    CHECK (
      cardinality(tags) <= 16
      AND gcd_content_evidence_tags_within_v007(tags, 60)
    ),

  -- `detail` is bounded by PostgreSQL's canonical jsonb text in UTF-8 bytes.
  -- TypeScript computes a conservative upper bound for this same form.
  ADD CONSTRAINT content_evidence_detail_bounded
    CHECK (detail IS NULL OR octet_length(detail::text) <= 4000);

ALTER TABLE content_evidence_relations
  ADD CONSTRAINT content_evidence_relations_note_bounded
    CHECK (note IS NULL OR (length(note) <= 500 AND octet_length(note) <= 500));
