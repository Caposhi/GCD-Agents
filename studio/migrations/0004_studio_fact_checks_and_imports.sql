-- Content Studio migration 0004 — the fact check, the import's revalidation,
-- the owner's edits made attributable and audited, and the fake-source rule
-- (Content Studio S7.1; owner decisions of 2026-10-06, design §4.4, §4.5,
-- §8.5-§8.7).
--
-- Applied only by src/studio/db/migrate.ts to the Studio database gcd_studio,
-- after 0001, 0002 and 0003, none of which changes. S2's schema cannot carry
-- S7: no job kind tells the worker of a staged upload or an import, nothing
-- holds a fact check's refusal or warnings once the staging row is deleted, an
-- import cannot record its source, and the owner's user and fact-version edits
-- have no actor. Where an S2 CHECK or trigger function must change, it changes
-- here, by ALTER TABLE or CREATE OR REPLACE, keeping 0002's comments; each
-- comment below states what behaviour changes, and each change is narrower
-- than what it replaces except the two that say otherwise (two new job kinds,
-- and a source for an import).
--
-- THE TRANSACTION'S ACTOR (owner decision of 2026-10-06). An owner-managed
-- change — a user's email, display_name, role, status or daily_cap_usd; a fact
-- version's status; and every studio_settings update — names its actor in a
-- transaction-local setting:
--
--   SET LOCAL studio.actor = '<the acting owner''s studio_users.id>';
--
-- read here with current_setting('studio.actor', true). The change is refused
-- unless that setting is present, names an active owner, and equals the actor
-- column the change writes (studio_users.updated_by,
-- studio_fact_versions.status_changed_by, studio_settings.updated_by). SET
-- LOCAL ends with its transaction, so an edit can never inherit the previous
-- editor. A sign-in's google_sub binding is not owner-managed and needs none.
--
-- Every invariant below is proven on disposable PostgreSQL 16 and 18 by
-- src/studio/db/migrate.postgres.selftest.ts, which attempts each forbidden
-- write and requires its refusal. docs/DATA_MODEL.md ("Content Studio schema")
-- lists each with the check that proves it.

DO $$
BEGIN
  IF current_database() <> 'gcd_studio' THEN
    RAISE EXCEPTION 'studio: migration 0004 refuses database "%": the Studio database is gcd_studio',
      current_database();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The transaction's actor
-- ---------------------------------------------------------------------------

-- Refuses an owner-managed change (p_change names it) unless studio.actor is
-- set in this transaction, names an active owner, and equals p_actor, the
-- actor column the change writes.
CREATE FUNCTION studio_require_owner_actor(p_actor uuid, p_change text) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  declared text := current_setting('studio.actor', true);
BEGIN
  IF declared IS NULL OR declared !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'studio: % needs its transaction''s actor: SET LOCAL studio.actor to the acting owner''s id', p_change
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT studio_is_active_user_in_role(declared::uuid, ARRAY['owner']) THEN
    RAISE EXCEPTION 'studio: % is an owner''s change, and the transaction''s actor is not an active owner', p_change
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_actor IS DISTINCT FROM declared::uuid THEN
    RAISE EXCEPTION 'studio: % must record the transaction''s actor as its actor', p_change
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- §5.3 Jobs: two free kinds. A fact check has no run; an import job runs an
-- import, and only an import. Until S7.2 the worker claims neither: its claim
-- takes only preflight, paid and fake jobs, and its sweep expires the rest.
-- ---------------------------------------------------------------------------

-- Wider (the one widening in this file besides an import's source): two new
-- kinds. Nothing about the S2 kinds changes.
ALTER TABLE studio_jobs DROP CONSTRAINT studio_jobs_kind;
ALTER TABLE studio_jobs ADD CONSTRAINT studio_jobs_kind
  CHECK (kind IN ('preflight', 'paid', 'fake', 'fact_check', 'import'));
-- Unchanged for the S2 kinds (only a free preflight job may have no run); a
-- fact check never has one, and an import job always does.
ALTER TABLE studio_jobs DROP CONSTRAINT studio_jobs_run_required;
ALTER TABLE studio_jobs ADD CONSTRAINT studio_jobs_run_required
  CHECK (CASE kind WHEN 'preflight' THEN true WHEN 'fact_check' THEN run_id IS NULL ELSE run_id IS NOT NULL END);

-- 0002's function with one change, in its INSERT branch: a fake job runs a
-- fake run that is not an import, and an import job runs an import (and only
-- an import job may). Before, a fake job could be written for a fake import
-- and a preflight job for a live import (the worker refused both, as
-- not_executable and preflight_with_run); now the database refuses them.
-- Nothing 0002 accepted for a paid job changes, and no other branch changes.
CREATE OR REPLACE FUNCTION studio_jobs_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run studio_runs%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'queued' OR NEW.claimed_at IS NOT NULL OR NEW.heartbeat_at IS NOT NULL
       OR NEW.cancel_requested_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a job is created queued and unclaimed'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := NEW.created_at + interval '1 hour';
    END IF;
    IF NEW.run_id IS NOT NULL THEN
      SELECT * INTO run FROM studio_runs WHERE id = NEW.run_id;
      IF FOUND AND ((NEW.kind = 'paid') <> (run.runner = 'live' AND run.kind <> 'imported')
                    OR (NEW.kind = 'fake') <> (run.runner = 'fake' AND run.kind <> 'imported')
                    OR (NEW.kind = 'import') <> (run.kind = 'imported')) THEN
        RAISE EXCEPTION 'studio: a paid job runs a live run, a fake job a fake run and an import job an import'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('finished', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'studio: a job in state % never changes', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'studio: a job''s run, kind, creation and expiry never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
     OR OLD.cancel_requested_at IS NOT NULL AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at THEN
    RAISE EXCEPTION 'studio: a job''s claim and cancellation request are set once'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'queued' AND NEW.state IN ('running', 'cancelled', 'expired'))
       OR (OLD.state = 'running' AND NEW.state IN ('finished', 'cancelled'))) THEN
    RAISE EXCEPTION 'studio: a job cannot move from % to % (a job is never retried)', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'queued' AND NEW.state = 'running' THEN
    IF now() > OLD.expires_at THEN
      RAISE EXCEPTION 'studio: a queued job past its expiry is never started'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.claimed_at := now();
  ELSIF NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
    RAISE EXCEPTION 'studio: a job is claimed only by starting it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- §8.5 The fact check: one row per fact_check job, written by the web beside
-- the staged bytes, and the worker's outcome, written once. The outcome
-- outlives the staging row, which the worker deletes in the same transaction.
-- ---------------------------------------------------------------------------

CREATE TABLE studio_fact_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL
    CONSTRAINT studio_fact_checks_one_per_job UNIQUE
    REFERENCES studio_jobs (id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES studio_users (id) ON DELETE RESTRICT,
  -- The staged bytes this check is for, as studio_fact_uploads holds them.
  sha256 text NOT NULL CONSTRAINT studio_fact_checks_sha256_shape CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length integer NOT NULL CONSTRAINT studio_fact_checks_bounded CHECK (byte_length BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The outcome, written once by the worker. An accepted check names its
  -- version by sha256 (unique in studio_fact_versions), not by a foreign key,
  -- so a retired version stays deletable (design §4.7).
  outcome text CONSTRAINT studio_fact_checks_outcome CHECK (outcome IN ('accepted', 'refused')),
  refusal_class text CONSTRAINT studio_fact_checks_refusal_class_shape CHECK (refusal_class ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- The loader's own message (§8.5 step 4), for the owner; never logged (§9.2).
  refusal_message text
    CONSTRAINT studio_fact_checks_refusal_message_bounded CHECK (char_length(refusal_message) BETWEEN 1 AND 4000),
  -- Field names outside the loader's known set (§8.5 step 2, §9.4): names
  -- only, never values; a non-empty set of at most 200, 16 KiB in all.
  unknown_fields text[]
    CONSTRAINT studio_fact_checks_unknown_fields CHECK (
      cardinality(unknown_fields) BETWEEN 1 AND 200 AND studio_is_text_set(unknown_fields)
      AND octet_length(array_to_string(unknown_fields, '')) <= 16384),
  outcome_at timestamptz,
  CONSTRAINT studio_fact_checks_outcome_shape CHECK (
    (outcome IS NULL AND refusal_class IS NULL AND refusal_message IS NULL AND unknown_fields IS NULL AND outcome_at IS NULL)
    OR (outcome = 'accepted' AND refusal_class IS NULL AND refusal_message IS NULL AND outcome_at IS NOT NULL)
    OR (outcome = 'refused' AND refusal_class IS NOT NULL AND refusal_message IS NOT NULL AND outcome_at IS NOT NULL))
);
CREATE INDEX studio_fact_checks_created ON studio_fact_checks (created_at);

CREATE FUNCTION studio_fact_checks_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  job studio_jobs%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO job FROM studio_jobs WHERE id = NEW.job_id;
    IF NOT FOUND OR job.kind <> 'fact_check' THEN
      RAISE EXCEPTION 'studio: a fact check belongs to a fact_check job'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT studio_is_active_user_in_role(NEW.requested_by, ARRAY['owner']) THEN
      RAISE EXCEPTION 'studio: only an active owner may request a fact check'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM studio_fact_uploads s WHERE s.sha256 = NEW.sha256
                   AND s.byte_length = NEW.byte_length AND s.uploaded_by = NEW.requested_by) THEN
      RAISE EXCEPTION 'studio: a fact check is for the bytes its owner staged'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome IS NOT NULL OR NEW.refusal_class IS NOT NULL OR NEW.refusal_message IS NOT NULL
       OR NEW.unknown_fields IS NOT NULL OR NEW.outcome_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a fact check is created without an outcome'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The database sets created_at, so the 30-day retention cannot be back-dated.
    NEW.created_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.outcome IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a fact check''s outcome is written once and never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - 'outcome' - 'refusal_class' - 'refusal_message' - 'unknown_fields' - 'outcome_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'outcome' - 'refusal_class' - 'refusal_message' - 'unknown_fields' - 'outcome_at') THEN
      RAISE EXCEPTION 'studio: a fact check''s request never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome IS NULL THEN
      RAISE EXCEPTION 'studio: a fact check is updated only to write its outcome'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM studio_jobs j WHERE j.id = NEW.job_id AND j.state = 'running') THEN
      RAISE EXCEPTION 'studio: a fact check''s outcome is written by its running job'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome = 'accepted' AND NOT EXISTS (SELECT 1 FROM studio_fact_versions v WHERE v.sha256 = NEW.sha256) THEN
      RAISE EXCEPTION 'studio: an accepted fact check names a fact version of its bytes'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.outcome_at := now();
    RETURN NEW;
  END IF;
  -- DELETE: kept 30 days, as a preflight request is (§4.7, S6.1's note).
  IF OLD.created_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'studio: a fact check is kept for 30 days'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER studio_fact_checks_guard
  BEFORE INSERT OR UPDATE OR DELETE ON studio_fact_checks
  FOR EACH ROW EXECUTE FUNCTION studio_fact_checks_guard();
CREATE TRIGGER studio_fact_checks_no_truncate
  BEFORE TRUNCATE ON studio_fact_checks
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- ---------------------------------------------------------------------------
-- §4.4 Fact versions: created only by the running fact check of the staged
-- bytes; a status change (retiring, or restoring a retired version: owner
-- decision of 2026-10-06) is the transaction actor's, audited, and never
-- retires the version the settings point at; the pointer names only a version
-- that is not retired.
-- ---------------------------------------------------------------------------

ALTER TABLE studio_fact_versions
  ADD COLUMN status_changed_by uuid REFERENCES studio_users (id) ON DELETE RESTRICT,
  ADD COLUMN status_changed_at timestamptz;
ALTER TABLE studio_fact_versions ADD CONSTRAINT studio_fact_versions_status_change_pair
  CHECK ((status_changed_by IS NULL) = (status_changed_at IS NULL));

-- §8.5: a version is created only while the worker's fact check of the same
-- staged bytes is running, for the owner who staged them, with no status
-- change recorded. Added beside 0002's triggers, which still require the
-- staged bytes and an active owner and fire first (name order); it only adds
-- refusals.
CREATE FUNCTION studio_fact_versions_validated() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM studio_fact_checks c JOIN studio_jobs j ON j.id = c.job_id
                 WHERE c.sha256 = NEW.sha256 AND c.requested_by = NEW.uploaded_by
                   AND c.outcome IS NULL AND j.state = 'running') THEN
    RAISE EXCEPTION 'studio: a fact version is created only by the running fact check of its staged bytes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status_changed_by IS NOT NULL OR NEW.status_changed_at IS NOT NULL THEN
    RAISE EXCEPTION 'studio: a fact version is created with no status change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_fact_versions_validated
  BEFORE INSERT ON studio_fact_versions
  FOR EACH ROW EXECUTE FUNCTION studio_fact_versions_validated();

-- content, sha256 and the counts are immutable; only status may change. The
-- sha256 is of the exact uploaded bytes, as the CLI's fileFingerprint hashes the
-- file. A version is created only from the validated staging row's bytes.
--
-- 0002's function with its UPDATE branch narrowed: status is still the only
-- content that may change, now only by the transaction's actor (an active
-- owner, recorded in status_changed_by, with the time in status_changed_at),
-- and never away from 'active' while the settings point at the version. The
-- INSERT and DELETE branches are 0002's, unchanged.
CREATE OR REPLACE FUNCTION studio_fact_versions_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM studio_fact_uploads s WHERE s.sha256 = NEW.sha256 AND s.content = NEW.content) THEN
      RAISE EXCEPTION 'studio: a fact version is created only from the staged upload''s bytes'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'status' - 'status_changed_by' - 'status_changed_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_changed_by' - 'status_changed_at') THEN
      RAISE EXCEPTION 'studio: only a fact version''s status may change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      IF NEW.status_changed_by IS DISTINCT FROM OLD.status_changed_by
         OR NEW.status_changed_at IS DISTINCT FROM OLD.status_changed_at THEN
        RAISE EXCEPTION 'studio: a fact version''s status change is recorded only with the change'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    PERFORM studio_require_owner_actor(NEW.status_changed_by, 'a fact version''s retirement or restoration');
    -- Locks the settings row, so a concurrent repointing waits for this, or this for it.
    IF NEW.status = 'retired'
       AND EXISTS (SELECT 1 FROM studio_settings WHERE singleton AND active_fact_version_id = OLD.id FOR UPDATE) THEN
      RAISE EXCEPTION 'studio: the active fact version is retired only after the settings point elsewhere'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.status_changed_at := now();
    RETURN NEW;
  END IF;
  -- DELETE: a referenced version is protected by the restrictive foreign keys;
  -- an unreferenced one may go only once it is retired.
  IF OLD.status <> 'retired' THEN
    RAISE EXCEPTION 'studio: only a retired fact version may be deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
    VALUES (NULL, 'fact_version.delete', 'studio_fact_versions', OLD.id::text,
            jsonb_build_object('sha256', OLD.sha256, 'byte_length', OLD.byte_length));
  RETURN OLD;
END
$$;

-- Every status change (a retirement or a restoration) writes its audit row, by
-- its actor, in the same transaction.
CREATE FUNCTION studio_fact_versions_audit_status() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
      VALUES (NEW.status_changed_by, 'fact_version.status', 'studio_fact_versions', NEW.id::text,
              jsonb_build_object('sha256', NEW.sha256, 'before', OLD.status, 'after', NEW.status));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER studio_fact_versions_audit_status
  AFTER UPDATE ON studio_fact_versions
  FOR EACH ROW EXECUTE FUNCTION studio_fact_versions_audit_status();

-- ---------------------------------------------------------------------------
-- §4.4 Settings: every update is the transaction actor's, and the pointer
-- names a version that is not retired.
-- ---------------------------------------------------------------------------

-- 0002's function with one addition: after 0002's check that updated_by is an
-- active owner (unchanged, and first, so its refusals read as before), the
-- update must also be the transaction's actor's: studio.actor set, naming an
-- active owner, equal to updated_by. Strictly narrower: every update 0002
-- refused is still refused, and an update that only carried a stale or
-- borrowed updated_by is now refused too.
CREATE OR REPLACE FUNCTION studio_settings_before_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT studio_is_active_user_in_role(NEW.updated_by, ARRAY['owner']) THEN
    RAISE EXCEPTION 'studio: only an active owner may change the settings'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM studio_require_owner_actor(NEW.updated_by, 'a settings change');
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- The pointer names a version that is not retired. Added beside 0002's
-- settings triggers, after them (name order); it only adds a refusal. The
-- version row is share-locked, so a concurrent retirement is seen.
CREATE FUNCTION studio_settings_pointer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.active_fact_version_id IS NOT NULL
     AND NEW.active_fact_version_id IS DISTINCT FROM OLD.active_fact_version_id
     AND NOT EXISTS (SELECT 1 FROM studio_fact_versions v
                     WHERE v.id = NEW.active_fact_version_id AND v.status = 'active' FOR SHARE) THEN
    RAISE EXCEPTION 'studio: the settings point only at a fact version that is not retired'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_settings_pointer
  BEFORE UPDATE ON studio_settings
  FOR EACH ROW EXECUTE FUNCTION studio_settings_pointer();

-- ---------------------------------------------------------------------------
-- §4.1, §7.2, §8.7 Users: the owner's edits are the transaction actor's and
-- are audited in the same transaction, as the settings' are.
-- ---------------------------------------------------------------------------

ALTER TABLE studio_users ADD COLUMN updated_by uuid REFERENCES studio_users (id) ON DELETE RESTRICT;

-- Added beside 0002's users triggers, after them (name order). A new user's
-- updated_by is stamped with its creator (nobody, for the bootstrap owner,
-- whose creation 0002 already constrains); otherwise it only adds refusals. A
-- sign-in's google_sub binding changes no owner-managed field and needs no
-- actor.
CREATE FUNCTION studio_users_owner_edit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_by := NEW.created_by;
    RETURN NEW;
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email OR NEW.display_name IS DISTINCT FROM OLD.display_name
     OR NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.daily_cap_usd IS DISTINCT FROM OLD.daily_cap_usd THEN
    PERFORM studio_require_owner_actor(NEW.updated_by, 'a change to a user''s email, name, role, status or cap');
  ELSIF NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN
    RAISE EXCEPTION 'studio: a user''s updated_by changes only with an owner''s edit'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_users_owner_edit
  BEFORE INSERT OR UPDATE ON studio_users
  FOR EACH ROW EXECUTE FUNCTION studio_users_owner_edit();

-- Never an email address or a display name in the audit row (design §4.6,
-- §9.2): only whether they changed.
CREATE FUNCTION studio_users_audit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
      VALUES (NEW.created_by, CASE WHEN NEW.created_by IS NULL THEN 'user.bootstrap' ELSE 'user.create' END,
              'studio_users', NEW.id::text,
              jsonb_build_object('role', NEW.role, 'status', NEW.status, 'daily_cap_usd', NEW.daily_cap_usd));
  ELSIF NEW.email IS DISTINCT FROM OLD.email OR NEW.display_name IS DISTINCT FROM OLD.display_name
        OR NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW.daily_cap_usd IS DISTINCT FROM OLD.daily_cap_usd THEN
    INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
      VALUES (NEW.updated_by, 'user.update', 'studio_users', NEW.id::text, jsonb_build_object(
        'before', jsonb_build_object('role', OLD.role, 'status', OLD.status, 'daily_cap_usd', OLD.daily_cap_usd),
        'after', jsonb_build_object('role', NEW.role, 'status', NEW.status, 'daily_cap_usd', NEW.daily_cap_usd),
        'email_changed', NEW.email IS DISTINCT FROM OLD.email,
        'display_name_changed', NEW.display_name IS DISTINCT FROM OLD.display_name));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER studio_users_audit
  AFTER INSERT OR UPDATE ON studio_users
  FOR EACH ROW EXECUTE FUNCTION studio_users_audit();

-- ---------------------------------------------------------------------------
-- §4.2, §4.5, §8.6 Runs: an import's lineage, its revalidation by its import
-- job and its tier; and the fake-source rule.
-- ---------------------------------------------------------------------------

-- 0002's shape for every Studio kind, unchanged; wider for imports only: an
-- import may now name a source (a revised folder whose source was imported
-- first, §8.6). The source must still exist and not be deleted, and the child
-- still pins the source's fact version (studio_runs_before_insert).
ALTER TABLE studio_runs DROP CONSTRAINT studio_runs_lineage_shape;
ALTER TABLE studio_runs ADD CONSTRAINT studio_runs_lineage_shape CHECK (
  (kind = 'full' AND source_run_id IS NULL)
  OR (kind IN ('revise', 'replay_critic', 'resume_packaging') AND source_run_id IS NOT NULL)
  OR kind = 'imported');

-- The tier is the outcome of an import's revalidation, written when it ends:
-- verified only for a succeeded import carrying every fingerprint, its fact
-- version and the worker's commit, with no failure; archived_unverified always
-- with its reason; and every finished import has one.
ALTER TABLE studio_runs
  ADD CONSTRAINT studio_runs_import_tier_when_finished
    CHECK (import_tier IS NULL OR studio_is_terminal_run_state(state)),
  ADD CONSTRAINT studio_runs_finished_import_has_tier
    CHECK (kind <> 'imported' OR NOT studio_is_terminal_run_state(state) OR import_tier IS NOT NULL),
  ADD CONSTRAINT studio_runs_verified_import CHECK (import_tier IS DISTINCT FROM 'verified' OR (
    state = 'succeeded' AND failure_class IS NULL AND failure_message IS NULL AND fact_version_id IS NOT NULL
    AND automotive_facts_sha256 IS NOT NULL AND approved_facts_sha256 IS NOT NULL
    AND evidence_pack_sha256 IS NOT NULL AND code_commit IS NOT NULL)),
  ADD CONSTRAINT studio_runs_unverified_import_reason CHECK (import_tier IS DISTINCT FROM 'archived_unverified'
    OR (failure_class IS NOT NULL AND failure_message IS NOT NULL));

-- 0002's function with two changes, both in its source branch. (1) The rule
-- that an import which did not revalidate is never a paid action's source now
-- names a paid action exactly — a live run that is not itself an import —
-- because an import may now have a source; before 0004 no import could, so no
-- row 0002 accepted is refused by this and no paid action is newly permitted.
-- (2) Owner decision of 2026-10-06: a fake run (a Studio fake run, or an import
-- of a fake CLI run) is never a paid action's source. Narrower: it refuses
-- what 0002 accepted. A fake run's own fake children (a fake revise, replay or
-- resume, owner-only and free) are unchanged.
CREATE OR REPLACE FUNCTION studio_runs_before_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  source studio_runs%ROWTYPE;
  quote studio_quotes%ROWTYPE;
BEGIN
  IF NEW.state <> 'queued' OR NEW.deleted_at IS NOT NULL OR NEW.started_at IS NOT NULL OR NEW.finished_at IS NOT NULL THEN
    RAISE EXCEPTION 'studio: a run is created queued, not started, finished or deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Who may create which run (design §6.3, §8.5-§8.6): a paid run by an active
  -- owner or runner; a fake run or an import by an active owner only.
  IF NEW.kind = 'imported' OR NEW.runner = 'fake' THEN
    IF NOT studio_is_active_user_in_role(NEW.requested_by, ARRAY['owner']) THEN
      RAISE EXCEPTION 'studio: fake runs and imports are owner-only'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT studio_is_active_user_in_role(NEW.requested_by, ARRAY['owner', 'runner']) THEN
    RAISE EXCEPTION 'studio: a paid run needs an active owner or runner'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.source_run_id IS NOT NULL THEN
    -- The source must already exist before this row, so no statement can
    -- create a cycle; source_run_id never changes afterwards, so no later
    -- statement can either. A run therefore cannot be its own ancestor.
    SELECT * INTO source FROM studio_runs WHERE id = NEW.source_run_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'studio: a run''s source_run_id must name an existing run'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF source.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a deleted run cannot be a source'
        USING ERRCODE = 'check_violation';
    END IF;
    -- §4.4: a revise, replay or resume uses its source run's pinned fact version.
    IF NEW.fact_version_id IS DISTINCT FROM source.fact_version_id THEN
      RAISE EXCEPTION 'studio: a run must pin its source run''s fact version'
        USING ERRCODE = 'check_violation';
    END IF;
    -- §4.5: an import that did not revalidate can never be the source of a paid action.
    IF NEW.runner = 'live' AND NEW.kind <> 'imported'
       AND source.kind = 'imported' AND source.import_tier IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'studio: an import that is not verified can never be a paid action''s source'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Owner decision of 2026-10-06: nor can a fake run, Studio or imported.
    IF NEW.runner = 'live' AND NEW.kind <> 'imported' AND source.runner = 'fake' THEN
      RAISE EXCEPTION 'studio: a fake run can never be a paid action''s source'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.quote_id IS NOT NULL THEN
    SELECT * INTO quote FROM studio_quotes WHERE id = NEW.quote_id;
    IF NOT FOUND OR quote.user_id <> NEW.requested_by OR quote.action <> NEW.kind
       OR quote.fact_version_id IS DISTINCT FROM NEW.fact_version_id OR quote.ceiling_usd <> NEW.reserved_usd THEN
      RAISE EXCEPTION 'studio: a run must match its quote''s user, action, fact version and ceiling'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$$;

-- When an import ends: verified only while its own import job is running (the
-- worker's revalidation, S7.2); ending any other way — expired, cancelled,
-- interrupted, or a worker that wrote no tier — is archived_unverified, fail
-- closed, with a reason. Runs after studio_runs_before_update (name order),
-- and only on an import's way to its end.
CREATE FUNCTION studio_runs_import_outcome() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind <> 'imported' OR studio_is_terminal_run_state(OLD.state) OR OLD.import_tier IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.import_tier = 'verified'
     AND NOT EXISTS (SELECT 1 FROM studio_jobs j WHERE j.run_id = NEW.id AND j.kind = 'import' AND j.state = 'running') THEN
    RAISE EXCEPTION 'studio: an import is verified only by its running import job'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.import_tier IS NULL AND studio_is_terminal_run_state(NEW.state) THEN
    NEW.import_tier := 'archived_unverified';
    NEW.failure_class := COALESCE(NEW.failure_class, 'not_revalidated');
    NEW.failure_message := COALESCE(NEW.failure_message, 'this import ended without being revalidated');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_runs_import_outcome
  BEFORE UPDATE ON studio_runs
  FOR EACH ROW EXECUTE FUNCTION studio_runs_import_outcome();

-- §8.6: an import's files are the CLI's known names only (RUN_ARTIFACT_NAMES in
-- src/harness/contentRun/index.ts; the offline suite checks this list has not
-- drifted) — sixteen names, so with the (run_id, name) primary key at most
-- sixteen files, inside §8.6's twenty — at most 10 MiB of stored bytes, all
-- written before its revalidation starts. Added beside 0002's artifact
-- trigger, after it (name order); it only adds refusals, and only for imports.
CREATE FUNCTION studio_run_artifacts_import_bounds() RETURNS trigger
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
       '06-final-critic.json', 'round-1-06-final-critic.json', 'summary.md', 'field-measurements.json',
       'field-measurements.md', 'rejected-responses.json']) THEN
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
CREATE TRIGGER studio_run_artifacts_import_bounds
  BEFORE INSERT ON studio_run_artifacts
  FOR EACH ROW EXECUTE FUNCTION studio_run_artifacts_import_bounds();

-- Checked at commit: an import is created with its import job and at least
-- one file, in one transaction, so no import is left queued with nothing to
-- revalidate it (a queued run can be neither cancelled without a job nor
-- deleted).
CREATE FUNCTION studio_runs_check_import() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.kind = 'imported' THEN
    IF NOT EXISTS (SELECT 1 FROM studio_jobs j WHERE j.run_id = NEW.id AND j.kind = 'import') THEN
      RAISE EXCEPTION 'studio: an import''s job is created in the transaction that creates it'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM studio_run_artifacts a WHERE a.run_id = NEW.id) THEN
      RAISE EXCEPTION 'studio: an import''s files are written in the transaction that creates it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER studio_runs_check_import
  AFTER INSERT ON studio_runs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION studio_runs_check_import();
