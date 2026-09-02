-- Rollback for state/migrations/007_evidence_bounds.sql.
--
-- **This directory is deliberately outside state/migrations.** The repository
-- migration runner is forward-only: it applies every `*.sql` file in
-- state/migrations in lexical order and records it in `_migrations`
-- (docs/DATA_MODEL.md — "There is no down migration"). A down migration placed
-- there would be applied as if it were a forward one, immediately undoing the
-- migration that preceded it. So the rollback is documented SQL, applied by
-- hand under its own authorization, and the runner never sees it.
--
-- **When this is the right operation.** Migration 007 only adds CHECK
-- constraints; it changes no column type, writes no row, and drops nothing.
-- Rolling it back therefore cannot lose data — it only stops the database
-- enforcing the bounds. The situation it exists for is a bound found to be too
-- tight against real evidence after 007 has been applied: dropping the
-- constraint restores writes immediately, and the bound is then widened in
-- `payloadContract.ts` and re-applied as a new forward migration.
--
-- **What it does not do.** It does not relax the TypeScript contract. With this
-- applied and `payloadContract.ts` unchanged, `assertValidEvidenceRecord` still
-- refuses an oversized record, so `evidence:sync` still will not write one. That
-- asymmetry is deliberate: the database stops being the backstop, the
-- application keeps being the gate, and the system fails closed either way.
--
-- **Also remove the `_migrations` row**, or the runner will consider 007
-- applied and never re-run it. The DELETE below is part of the rollback, not an
-- optional extra.
--
-- Not applied. No production database has run this file, and running it is a
-- separately authorized operator action.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE content_evidence
  DROP CONSTRAINT IF EXISTS content_evidence_id_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_claim_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_subject_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_attribute_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_source_ref_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_provenance_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_reviewed_by_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_superseded_by_id_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_tags_bounded,
  DROP CONSTRAINT IF EXISTS content_evidence_detail_bounded;

ALTER TABLE content_evidence_relations
  DROP CONSTRAINT IF EXISTS content_evidence_relations_note_bounded;

DELETE FROM _migrations WHERE name = '007_evidence_bounds.sql';

COMMIT;
