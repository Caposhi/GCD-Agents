-- Content Studio migration 0005 — the legal-risk review (Content Studio S8.6;
-- the owner's decision "legal lens: defaults" and the owner's authorization of
-- this migration, both 2026-10-13; design §5.5).
--
-- Applied only by src/studio/db/migrate.ts to the Studio database gcd_studio,
-- after 0001-0004, none of which changes. It makes exactly the two changes the
-- owner authorized, and no other:
--
--  1. studio_run_requests_stage gains 'legal-review': the legal review is one
--     provider request after the critic panel, and its `started` row (with its
--     own ceiling) must be committed before it is sent, like every request's.
--     The legal row has no lens, so studio_run_requests_lens and
--     studio_run_requests_lens_only_for_critic are unchanged.
--  2. studio_run_artifacts_import_bounds() gains '07-legal-review.json', the
--     review's saved file, so an import or a re-imported bundle may hold it:
--     seventeen names, so at most seventeen files, inside §8.6's twenty. The
--     function is 0004's, byte for byte, but for that one name and this
--     comment.
--
-- Both are widenings, and each by exactly one value. Nothing else in the
-- schema changes: no lens, no finding category, no verdict (the run's verdict
-- is still one of the critic's three), no table, no trigger.
--
-- DEPLOY GATE. The web and the worker refuse any schema version but the one
-- their code expects (design §5.3), so production applies this migration only
-- at the S8.6 deploy, under its own owner authorization given at deploy time,
-- with the web and the worker deployed together at that commit.
--
-- Every invariant below is proven on disposable PostgreSQL 16 and 18 by
-- src/studio/db/migrate.postgres.selftest.ts, which attempts each forbidden
-- write and requires its refusal. docs/DATA_MODEL.md ("Content Studio schema")
-- lists each with the check that proves it.

DO $$
BEGIN
  IF current_database() <> 'gcd_studio' THEN
    RAISE EXCEPTION 'studio: migration 0005 refuses database "%": the Studio database is gcd_studio',
      current_database();
  END IF;
END
$$;

-- Wider, by one value: the legal review's request. 0002's six stages are unchanged.
ALTER TABLE studio_run_requests DROP CONSTRAINT studio_run_requests_stage;
ALTER TABLE studio_run_requests ADD CONSTRAINT studio_run_requests_stage CHECK (stage IN (
    'strategy-concept', 'automotive-truth', 'hook-story-script', 'production-direction',
    'packaging-adaptation', 'final-critic', 'legal-review'));

-- §8.6: an import's files are the CLI's known names only (RUN_ARTIFACT_NAMES in
-- src/harness/contentRun/index.ts; the offline suite checks this list has not
-- drifted) — seventeen names since S8.6, so with the (run_id, name) primary key
-- at most seventeen files, inside §8.6's twenty — at most 10 MiB of stored
-- bytes, all written before its revalidation starts. 0004's function with one
-- name added, '07-legal-review.json'; its trigger is unchanged.
CREATE OR REPLACE FUNCTION studio_run_artifacts_import_bounds() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run_kind text;
  run_state text;
  bytes bigint;
BEGIN
  SELECT kind INTO run_kind FROM studio_runs WHERE id = NEW.run_id;
  IF run_kind IS DISTINCT FROM 'imported' THEN
    RETURN NEW;
  END IF;
  -- Serializes an import's file writes.
  SELECT state INTO run_state FROM studio_runs WHERE id = NEW.run_id FOR UPDATE;
  IF run_state <> 'queued' THEN
    RAISE EXCEPTION 'studio: an import''s files are written only before its revalidation starts'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.name <> ALL (ARRAY[
       'run-meta.json', 'resume-meta.json', 'replay-meta.json', 'revision-meta.json',
       '01-strategy-concept.json', '02-automotive-truth.json', '03-hook-story-script.json',
       '04-production-direction.json', '05-packaging-adaptation.json', '05b-contact-lines.json',
       '06-final-critic.json', 'round-1-06-final-critic.json', '07-legal-review.json', 'summary.md',
       'field-measurements.json', 'field-measurements.md', 'rejected-responses.json']) THEN
    RAISE EXCEPTION 'studio: an import holds only the CLI''s known file names'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum(byte_length), 0) INTO bytes FROM studio_run_artifacts WHERE run_id = NEW.run_id;
  IF bytes + NEW.byte_length > 10485760 THEN
    RAISE EXCEPTION 'studio: an import holds at most 10 MiB of files'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
