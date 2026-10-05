-- Content Studio migration 0003 — the preflight request (Content Studio S6.1;
-- owner decisions of 2026-10-05, design §4.6 and §6.1).
--
-- Applied only by src/studio/db/migrate.ts to the Studio database gcd_studio,
-- after 0001 and 0002, neither of which changes. S2's schema cannot carry the
-- free preflight (§6.1 steps 1-2): a preflight job has no parameters,
-- studio_quotes holds only their sha256 and requires ceiling_usd > 0 (so it
-- cannot hold a refusal), and nothing stores a revise plan. This table holds
-- all three: the web writes the request beside its preflight job, and the
-- worker writes its outcome once — a quote, or a refusal with its reason, and
-- for a revise the plan from planRevision (§8.4).
--
-- Every invariant below is proven on disposable PostgreSQL 16 and 18 by
-- src/studio/db/migrate.postgres.selftest.ts, which attempts each forbidden
-- write and requires its refusal. docs/DATA_MODEL.md ("Content Studio schema")
-- lists each with the check that proves it.

DO $$
BEGIN
  IF current_database() <> 'gcd_studio' THEN
    RAISE EXCEPTION 'studio: migration 0003 refuses database "%": the Studio database is gcd_studio',
      current_database();
  END IF;
END
$$;

-- Whether a one-dimensional text array is a set: no NULL element and no
-- element twice. (A CHECK cannot hold a subquery; it may call this.)
CREATE FUNCTION studio_is_text_set(p_values text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT array_ndims(p_values) = 1
     AND array_position(p_values, NULL) IS NULL
     AND cardinality(p_values) = (SELECT count(DISTINCT v) FROM unnest(p_values) AS v)
$$;

-- One row per preflight job: the parameters the web asked the worker to check
-- and price, and the worker's outcome.
--
-- THE CANONICAL PARAMETER FORM. params_sha256 is the lower-case hex SHA-256 of
-- the UTF-8 bytes of the JSON text that JavaScript's JSON.stringify produces
-- (no spaces) for an object with exactly these seven keys, in this order:
--
--   {"schema":"gcd-studio-preflight-params/1","action":<action>,"goal":<goal>,
--    "platforms":<platforms>,"scopeTags":<scope_tags>,"sourceRunId":<source_run_id>,
--    "factVersionId":<fact_version_id>}
--
-- where <action> is the row's action; <goal> its goal exactly as stored (no
-- trimming, case folding or Unicode normalization), or null; <platforms> its
-- platforms, and <scope_tags> its scope tags or null, each sorted by
-- JavaScript's default Array.prototype.sort (UTF-16 code-unit order, which is
-- normalizeScopeTags's order); and the two ids as PostgreSQL prints a uuid
-- (lower case, hyphenated), <source_run_id> null when absent. Content Studio
-- S6.2's web and worker both compute it from this form; this table checks only
-- its shape, and a quoted outcome must name a quote carrying the same value.
--
-- RETENTION (design §4.7, dated note of 2026-10-05): a request is kept at
-- least 30 days. After that it may be deleted only when no consumed quote
-- depends on it (it was refused, never answered, or quoted but its quote never
-- consumed). A request whose quote was consumed is the record of how its run
-- was priced, and is kept with the run. The purge itself is S6.2's.
CREATE TABLE studio_preflight_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL
    CONSTRAINT studio_preflight_requests_one_per_job UNIQUE
    REFERENCES studio_jobs (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES studio_users (id) ON DELETE RESTRICT,
  action text NOT NULL
    CONSTRAINT studio_preflight_requests_action CHECK (action IN ('full', 'revise', 'replay_critic', 'resume_packaging')),
  -- 1-2,000 characters, as the live trigger bounds a goal (§8.3); a full run's
  -- only. A revise, replay or resume uses its source run's goal.
  goal text CONSTRAINT studio_preflight_requests_goal_bounded CHECK (char_length(goal) BETWEEN 1 AND 2000),
  -- A non-empty set drawn from PACKAGING_PLATFORMS (the offline suite checks
  -- the list has not drifted).
  platforms text[] NOT NULL
    CONSTRAINT studio_preflight_requests_platforms CHECK (
      cardinality(platforms) >= 1 AND studio_is_text_set(platforms)
      AND platforms <@ ARRAY['instagram', 'facebook', 'google_business_profile']::text[]),
  -- NULL is an unscoped run; an empty scope is refused, as the CLI refuses it.
  scope_tags text[]
    CONSTRAINT studio_preflight_requests_scope_tags CHECK (cardinality(scope_tags) >= 1 AND studio_is_text_set(scope_tags)),
  source_run_id uuid REFERENCES studio_runs (id) ON DELETE RESTRICT,
  fact_version_id uuid NOT NULL REFERENCES studio_fact_versions (id) ON DELETE RESTRICT,
  params_sha256 text NOT NULL
    CONSTRAINT studio_preflight_requests_params_sha256_shape CHECK (params_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The outcome, written once by the worker.
  outcome text CONSTRAINT studio_preflight_requests_outcome CHECK (outcome IN ('quoted', 'refused')),
  quote_id uuid
    CONSTRAINT studio_preflight_requests_one_per_quote UNIQUE
    REFERENCES studio_quotes (id) ON DELETE RESTRICT,
  refusal_class text
    CONSTRAINT studio_preflight_requests_refusal_class_shape CHECK (refusal_class ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- Shown to the users allowed to see the request, as studio_runs.failure_message
  -- is; never logged (design §9.2).
  refusal_message text
    CONSTRAINT studio_preflight_requests_refusal_message_bounded CHECK (char_length(refusal_message) BETWEEN 1 AND 4000),
  -- planRevision's plan (§8.4), for the web to show: on a quoted revise, or on a
  -- revise refused because no blocking finding is revisable. At most 1 MiB: a
  -- full panel is 4 lenses of at most 20 findings, each issue at most 600 and
  -- each suggested action at most 300 characters (CRITIC_FIELD_LIMITS).
  revise_plan jsonb
    CONSTRAINT studio_preflight_requests_revise_plan_object CHECK (jsonb_typeof(revise_plan) = 'object')
    CONSTRAINT studio_preflight_requests_revise_plan_bounded CHECK (octet_length(revise_plan::text) <= 1048576),
  outcome_at timestamptz,
  -- A full run has a goal and no source; a revise, replay or resume has a source and no goal.
  CONSTRAINT studio_preflight_requests_goal_for_full CHECK ((action = 'full') = (goal IS NOT NULL)),
  CONSTRAINT studio_preflight_requests_lineage CHECK ((action = 'full') = (source_run_id IS NULL)),
  CONSTRAINT studio_preflight_requests_outcome_shape CHECK (
    (outcome IS NULL AND quote_id IS NULL AND refusal_class IS NULL AND refusal_message IS NULL AND outcome_at IS NULL)
    OR (outcome = 'quoted' AND quote_id IS NOT NULL AND refusal_class IS NULL AND refusal_message IS NULL
        AND outcome_at IS NOT NULL)
    OR (outcome = 'refused' AND quote_id IS NULL AND refusal_class IS NOT NULL AND refusal_message IS NOT NULL
        AND outcome_at IS NOT NULL)),
  CONSTRAINT studio_preflight_requests_revise_plan_when CHECK (revise_plan IS NULL OR (action = 'revise' AND (
    outcome IS NOT DISTINCT FROM 'quoted'
    OR (outcome IS NOT DISTINCT FROM 'refused' AND refusal_class IS NOT DISTINCT FROM 'no_revisable_blocking_finding'))))
);
CREATE INDEX studio_preflight_requests_created ON studio_preflight_requests (created_at);

CREATE FUNCTION studio_preflight_requests_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  job_kind text;
  source_deleted timestamptz;
  quote studio_quotes%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT kind INTO job_kind FROM studio_jobs WHERE id = NEW.job_id;
    IF FOUND AND job_kind <> 'preflight' THEN
      RAISE EXCEPTION 'studio: a preflight request belongs to a preflight job, not a % job', job_kind
        USING ERRCODE = 'check_violation';
    END IF;
    -- §6.3: only an active owner or runner can request a quote.
    IF NOT studio_is_active_user_in_role(NEW.user_id, ARRAY['owner', 'runner']) THEN
      RAISE EXCEPTION 'studio: a preflight is requested only by an active owner or runner'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source_run_id IS NOT NULL THEN
      SELECT deleted_at INTO source_deleted FROM studio_runs WHERE id = NEW.source_run_id;
      IF source_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'studio: a deleted run cannot be a preflight''s source'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.outcome IS NOT NULL OR NEW.quote_id IS NOT NULL OR NEW.refusal_class IS NOT NULL
       OR NEW.refusal_message IS NOT NULL OR NEW.revise_plan IS NOT NULL OR NEW.outcome_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a preflight request is created without an outcome'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The database sets created_at, so the 30-day retention cannot be back-dated.
    NEW.created_at := now();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.outcome IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a preflight request''s outcome is written once and never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - 'outcome' - 'quote_id' - 'refusal_class' - 'refusal_message' - 'revise_plan' - 'outcome_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'outcome' - 'quote_id' - 'refusal_class' - 'refusal_message' - 'revise_plan' - 'outcome_at') THEN
      RAISE EXCEPTION 'studio: a preflight request''s parameters never change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome IS NULL THEN
      RAISE EXCEPTION 'studio: a preflight request is updated only to write its outcome'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome = 'quoted' THEN
      SELECT * INTO quote FROM studio_quotes WHERE id = NEW.quote_id;
      IF FOUND AND (quote.user_id <> NEW.user_id OR quote.action <> NEW.action
                    OR quote.params_sha256 <> NEW.params_sha256 OR quote.fact_version_id <> NEW.fact_version_id) THEN
        RAISE EXCEPTION 'studio: a preflight request''s quote must match its user, action, parameters and fact version'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    NEW.outcome_at := now();
    RETURN NEW;
  END IF;
  -- DELETE: the retention rule above.
  IF OLD.outcome = 'quoted'
     AND EXISTS (SELECT 1 FROM studio_quotes q WHERE q.id = OLD.quote_id AND q.consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'studio: a preflight request whose quote was consumed is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.created_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'studio: a preflight request is kept for 30 days'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER studio_preflight_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON studio_preflight_requests
  FOR EACH ROW EXECUTE FUNCTION studio_preflight_requests_guard();
CREATE TRIGGER studio_preflight_requests_no_truncate
  BEFORE TRUNCATE ON studio_preflight_requests
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();
