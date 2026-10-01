-- Content Studio migration 0002 — the Studio schema (design §4, with the
-- §8.5 staging row), and every database-side invariant §4 states.
--
-- Applied only by src/studio/db/migrate.ts to the Studio database gcd_studio,
-- after 0001. Money is numeric(12,6) USD, times are timestamptz, ids are
-- UUIDs. Every invariant below is proven on disposable PostgreSQL 16 and 18 by
-- src/studio/db/migrate.postgres.selftest.ts, which attempts each forbidden
-- write and requires its refusal. docs/DATA_MODEL.md ("Content Studio schema")
-- lists each invariant with the check that proves it, and names the few §4
-- rules that are application-side by nature and the PR that owns them.

DO $$
BEGIN
  IF current_database() <> 'gcd_studio' THEN
    RAISE EXCEPTION 'studio: migration 0002 refuses database "%": the Studio database is gcd_studio',
      current_database();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

CREATE FUNCTION studio_is_terminal_run_state(p_state text) RETURNS boolean
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_state IN ('succeeded', 'failed', 'refused', 'cancelled', 'interrupted')
$$;

-- The day and month a ledger entry is booked to: America/New_York (owner
-- decision of 2026-09-29, design §4.6 and §11.1a).
CREATE FUNCTION studio_local_day(p_at timestamptz) RETURNS date
LANGUAGE sql STABLE
AS $$
  SELECT (p_at AT TIME ZONE 'America/New_York')::date
$$;

CREATE FUNCTION studio_month_of(p_day date) RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT p_day - (EXTRACT(DAY FROM p_day)::integer - 1)
$$;

-- ---------------------------------------------------------------------------
-- §4.1 Identity and access
-- ---------------------------------------------------------------------------

CREATE TABLE studio_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL
    CONSTRAINT studio_users_email_unique UNIQUE
    CONSTRAINT studio_users_email_lowercase CHECK (email = lower(email))
    CONSTRAINT studio_users_email_domain CHECK (email ~ '^[^@[:space:]]+@germancardepot\.com$'),
  google_sub text
    CONSTRAINT studio_users_google_sub_unique UNIQUE
    CONSTRAINT studio_users_google_sub_shape CHECK (google_sub IS NULL OR google_sub ~ '^[[:graph:]]{1,255}$'),
  display_name text CONSTRAINT studio_users_display_name_bounded CHECK (length(display_name) <= 200),
  role text NOT NULL CONSTRAINT studio_users_role CHECK (role IN ('owner', 'runner', 'viewer')),
  status text NOT NULL DEFAULT 'active' CONSTRAINT studio_users_status CHECK (status IN ('active', 'disabled')),
  daily_cap_usd numeric(12,6) CONSTRAINT studio_users_daily_cap_nonnegative CHECK (daily_cap_usd >= 0),
  created_by uuid REFERENCES studio_users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Whether a user is active in one of the given roles.
CREATE FUNCTION studio_is_active_user_in_role(p_user uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM studio_users u
    WHERE u.id = p_user AND u.status = 'active' AND u.role = ANY (p_roles)
  )
$$;

-- Who may create a user. While no active owner exists (before the first
-- sign-in), the only row that can be created is the bootstrap owner of §7.2:
-- an active owner, created by nobody, carrying the Google subject its sign-in
-- verified. Once an owner exists, every new user is created by an active owner.
CREATE FUNCTION studio_users_before_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Serializes bootstrap attempts, so two first sign-ins cannot both see "no owner".
  PERFORM pg_advisory_xact_lock(hashtextextended('gcd-studio:studio_users:bootstrap:v1', 0));
  IF NOT EXISTS (SELECT 1 FROM studio_users WHERE role = 'owner' AND status = 'active') THEN
    IF NEW.role <> 'owner' OR NEW.status <> 'active' OR NEW.created_by IS NOT NULL OR NEW.google_sub IS NULL THEN
      RAISE EXCEPTION 'studio: while no owner exists, only the bootstrap owner may be created'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT studio_is_active_user_in_role(NEW.created_by, ARRAY['owner']) THEN
    RAISE EXCEPTION 'studio: a user can be created only by an active owner'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_users_before_insert
  BEFORE INSERT ON studio_users
  FOR EACH ROW EXECUTE FUNCTION studio_users_before_insert();

-- A google_sub never changes once set; nor do the row's identity and origin.
CREATE FUNCTION studio_users_before_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.google_sub IS NOT NULL AND NEW.google_sub IS DISTINCT FROM OLD.google_sub THEN
    RAISE EXCEPTION 'studio: a user''s google_sub never changes once set'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'studio: a user''s id, created_by and created_at never change'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_users_before_update
  BEFORE UPDATE ON studio_users
  FOR EACH ROW EXECUTE FUNCTION studio_users_before_update();

-- Once an owner exists, at least one active owner always exists. The
-- remaining active owners are locked before they are counted, so two
-- concurrent demotions cannot each see the other still active: the second
-- waits for the first, then counts again (READ COMMITTED), or fails to
-- serialize (REPEATABLE READ, SERIALIZABLE).
CREATE FUNCTION studio_users_keep_an_owner() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  remaining integer;
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active') THEN
    PERFORM 1 FROM studio_users WHERE role = 'owner' AND status = 'active' FOR UPDATE;
    SELECT count(*) INTO remaining FROM studio_users WHERE role = 'owner' AND status = 'active';
    IF remaining = 0 THEN
      RAISE EXCEPTION 'studio: the last active owner cannot be removed, demoted or disabled'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER studio_users_keep_an_owner
  AFTER UPDATE OR DELETE ON studio_users
  FOR EACH ROW EXECUTE FUNCTION studio_users_keep_an_owner();

-- A disabled user's sessions are revoked in the same transaction that disables them.
CREATE FUNCTION studio_users_revoke_sessions_on_disable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'disabled' THEN
    UPDATE studio_sessions SET revoked_at = now() WHERE user_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER studio_users_revoke_sessions_on_disable
  AFTER UPDATE OF status ON studio_users
  FOR EACH ROW EXECUTE FUNCTION studio_users_revoke_sessions_on_disable();

CREATE TRIGGER studio_users_no_truncate
  BEFORE TRUNCATE ON studio_users
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- state and nonce stored only as sha256 hashes; the PKCE verifier as issued
-- (RFC 7636: 43-128 unreserved characters); 10 minutes; single use.
CREATE TABLE studio_login_attempts (
  state_hash text PRIMARY KEY CONSTRAINT studio_login_attempts_state_hash_shape CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash text NOT NULL CONSTRAINT studio_login_attempts_nonce_hash_shape CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  pkce_verifier text NOT NULL
    CONSTRAINT studio_login_attempts_pkce_verifier_shape CHECK (pkce_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT studio_login_attempts_ten_minutes CHECK (expires_at = created_at + interval '10 minutes')
);

CREATE FUNCTION studio_login_attempts_before_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.created_at > clock_timestamp() + interval '1 minute' THEN
    RAISE EXCEPTION 'studio: a login attempt cannot be created in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NEW.created_at + interval '10 minutes';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_login_attempts_before_insert
  BEFORE INSERT ON studio_login_attempts
  FOR EACH ROW EXECUTE FUNCTION studio_login_attempts_before_insert();
-- A login attempt is never modified: it is consumed by delete, or purged.
CREATE TRIGGER studio_login_attempts_immutable
  BEFORE UPDATE ON studio_login_attempts
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();

-- The callback's consumption: deletes the attempt and returns it only if it
-- had not expired. A second call for the same state returns nothing, and an
-- expired attempt is refused and purged by the same call.
CREATE FUNCTION studio_consume_login_attempt(p_state_hash text)
RETURNS TABLE (nonce_hash text, pkce_verifier text)
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
    WITH consumed AS (
      DELETE FROM studio_login_attempts a WHERE a.state_hash = p_state_hash
      RETURNING a.nonce_hash, a.pkce_verifier, a.expires_at
    )
    SELECT c.nonce_hash, c.pkce_verifier FROM consumed c WHERE c.expires_at > now();
END
$$;

-- The cookie value is never stored: only its sha256 (id_hash) and the CSRF
-- token's. Lifetimes are §7.3's: 12 hours idle, 7 days absolute.
CREATE TABLE studio_sessions (
  id_hash text PRIMARY KEY CONSTRAINT studio_sessions_id_hash_shape CHECK (id_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES studio_users (id) ON DELETE RESTRICT,
  csrf_token_hash text NOT NULL CONSTRAINT studio_sessions_csrf_hash_shape CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT studio_sessions_absolute_lifetime CHECK (absolute_expires_at <= created_at + interval '7 days'),
  CONSTRAINT studio_sessions_idle_within_absolute CHECK (idle_expires_at <= absolute_expires_at),
  CONSTRAINT studio_sessions_idle_lifetime CHECK (idle_expires_at <= last_seen_at + interval '12 hours'),
  CONSTRAINT studio_sessions_seen_after_created CHECK (last_seen_at >= created_at)
);
CREATE INDEX studio_sessions_user ON studio_sessions (user_id);

CREATE FUNCTION studio_sessions_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT studio_is_active_user_in_role(NEW.user_id, ARRAY['owner', 'runner', 'viewer']) THEN
      RAISE EXCEPTION 'studio: a session can be created only for an active user'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a session cannot be created revoked'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'studio: a revoked session never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id_hash IS DISTINCT FROM OLD.id_hash OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.csrf_token_hash IS DISTINCT FROM OLD.csrf_token_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.absolute_expires_at IS DISTINCT FROM OLD.absolute_expires_at THEN
    RAISE EXCEPTION 'studio: a session''s identity, user, CSRF token and absolute expiry never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_sessions_guard
  BEFORE INSERT OR UPDATE ON studio_sessions
  FOR EACH ROW EXECUTE FUNCTION studio_sessions_guard();

-- ---------------------------------------------------------------------------
-- §4.4 and §8.5 Fact-file versions, the staging row, and the settings
-- ---------------------------------------------------------------------------

-- §8.5: until the worker has validated an upload, its bytes live here, in a
-- single owner-only staging row, never in studio_fact_versions. 1 MiB bound
-- (§8.5's PROPOSED 1 MB). Replaced by delete and insert, never modified.
CREATE TABLE studio_fact_uploads (
  singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT studio_fact_uploads_singleton CHECK (singleton),
  content bytea NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES studio_users (id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_fact_uploads_sha256_of_content CHECK (sha256 = encode(sha256(content), 'hex')),
  CONSTRAINT studio_fact_uploads_length_of_content CHECK (byte_length = octet_length(content)),
  CONSTRAINT studio_fact_uploads_bounded CHECK (byte_length BETWEEN 1 AND 1048576)
);

CREATE FUNCTION studio_owner_only_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT studio_is_active_user_in_role(NEW.uploaded_by, ARRAY['owner']) THEN
    RAISE EXCEPTION 'studio: only an active owner may write %', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_fact_uploads_owner_only
  BEFORE INSERT ON studio_fact_uploads
  FOR EACH ROW EXECUTE FUNCTION studio_owner_only_insert();
CREATE TRIGGER studio_fact_uploads_immutable
  BEFORE UPDATE ON studio_fact_uploads
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();

-- content, sha256 and the counts are immutable; only status may change. The
-- sha256 is of the exact uploaded bytes, as the CLI's fileFingerprint hashes the
-- file. A version is created only from the validated staging row's bytes.
CREATE TABLE studio_fact_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 text NOT NULL CONSTRAINT studio_fact_versions_sha256_unique UNIQUE,
  content bytea NOT NULL,
  byte_length integer NOT NULL,
  record_count integer NOT NULL CONSTRAINT studio_fact_versions_record_count_nonnegative CHECK (record_count >= 0),
  tag_counts jsonb NOT NULL CONSTRAINT studio_fact_versions_tag_counts_object CHECK (jsonb_typeof(tag_counts) = 'object'),
  uploaded_by uuid NOT NULL REFERENCES studio_users (id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CONSTRAINT studio_fact_versions_status CHECK (status IN ('active', 'retired')),
  CONSTRAINT studio_fact_versions_id_sha256 UNIQUE (id, sha256),
  CONSTRAINT studio_fact_versions_sha256_of_content CHECK (sha256 = encode(sha256(content), 'hex')),
  CONSTRAINT studio_fact_versions_length_of_content CHECK (byte_length = octet_length(content)),
  CONSTRAINT studio_fact_versions_bounded CHECK (byte_length BETWEEN 1 AND 1048576)
);
CREATE TRIGGER studio_fact_versions_owner_only
  BEFORE INSERT ON studio_fact_versions
  FOR EACH ROW EXECUTE FUNCTION studio_owner_only_insert();

CREATE FUNCTION studio_fact_versions_guard() RETURNS trigger
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
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION 'studio: only a fact version''s status may change'
        USING ERRCODE = 'check_violation';
    END IF;
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
CREATE TRIGGER studio_fact_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON studio_fact_versions
  FOR EACH ROW EXECUTE FUNCTION studio_fact_versions_guard();
CREATE TRIGGER studio_fact_versions_no_truncate
  BEFORE TRUNCATE ON studio_fact_versions
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- ---------------------------------------------------------------------------
-- §4.6 The audit log (created here because later triggers write to it)
-- ---------------------------------------------------------------------------

-- Append-only. detail never holds a goal, model text, fact text, an email
-- body, a token or a secret (application-side; bounded here). The only
-- exception to append-only is the two-year retention purge of §4.7, which does
-- not exist yet: it must be a separately reviewed migration or database
-- function, never an application code path.
CREATE TABLE studio_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES studio_users (id) ON DELETE RESTRICT,
  action text NOT NULL CONSTRAINT studio_audit_log_action_shape CHECK (action ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  target_type text CONSTRAINT studio_audit_log_target_type_shape CHECK (target_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  target_id text CONSTRAINT studio_audit_log_target_id_bounded CHECK (length(target_id) <= 128),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT studio_audit_log_detail_object CHECK (jsonb_typeof(detail) = 'object')
    CONSTRAINT studio_audit_log_detail_bounded CHECK (octet_length(detail::text) <= 4096)
);
CREATE INDEX studio_audit_log_at ON studio_audit_log (at);
CREATE TRIGGER studio_audit_log_append_only
  BEFORE UPDATE OR DELETE ON studio_audit_log
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();
CREATE TRIGGER studio_audit_log_no_truncate
  BEFORE TRUNCATE ON studio_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- The singleton settings row. THE SEEDED VALUES BELOW ARE OWNER-EDITABLE
-- DEFAULTS: the owner's caps of 2026-09-29 (design §11.1a, decision 4: $50 a
-- day, $200 a month) and scheduled runs off (owner decision 4; design §3.5).
-- The owner changes them on the settings screen (S5-S7); they stay bounded at
-- run time by the deployment ceilings STUDIO_MAX_DAILY_USD and
-- STUDIO_MAX_MONTHLY_USD (design §6.2), which this schema does not hold.
-- Every change is by an active owner and writes an audit row in the same
-- transaction (the trigger below writes it).
CREATE TABLE studio_settings (
  singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT studio_settings_singleton CHECK (singleton),
  active_fact_version_id uuid REFERENCES studio_fact_versions (id) ON DELETE RESTRICT,
  daily_cap_usd numeric(12,6) NOT NULL CONSTRAINT studio_settings_daily_cap_nonnegative CHECK (daily_cap_usd >= 0),
  monthly_cap_usd numeric(12,6) NOT NULL CONSTRAINT studio_settings_monthly_cap_nonnegative CHECK (monthly_cap_usd >= 0),
  scheduled_runs_enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES studio_users (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Owner-editable defaults (see above): $50 a day, $200 a month, scheduled runs off.
INSERT INTO studio_settings (daily_cap_usd, monthly_cap_usd, scheduled_runs_enabled)
  VALUES (50, 200, false);

CREATE FUNCTION studio_settings_before_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT studio_is_active_user_in_role(NEW.updated_by, ARRAY['owner']) THEN
    RAISE EXCEPTION 'studio: only an active owner may change the settings'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_settings_before_update
  BEFORE UPDATE ON studio_settings
  FOR EACH ROW EXECUTE FUNCTION studio_settings_before_update();

CREATE FUNCTION studio_settings_audit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
    VALUES (NEW.updated_by, 'settings.update', 'studio_settings', 'singleton',
            jsonb_build_object(
              'before', to_jsonb(OLD) - 'singleton' - 'updated_by' - 'updated_at',
              'after', to_jsonb(NEW) - 'singleton' - 'updated_by' - 'updated_at'));
  RETURN NULL;
END
$$;
CREATE TRIGGER studio_settings_audit
  AFTER UPDATE ON studio_settings
  FOR EACH ROW EXECUTE FUNCTION studio_settings_audit();
CREATE TRIGGER studio_settings_no_delete
  BEFORE DELETE ON studio_settings
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();
CREATE TRIGGER studio_settings_no_truncate
  BEFORE TRUNCATE ON studio_settings
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- ---------------------------------------------------------------------------
-- §4.6 Quotes
-- ---------------------------------------------------------------------------

-- Written by the worker's free preflight (§6.1), never computed by the web,
-- for an active owner or runner only (§6.3). Single use: consumed once, before expiry, in the transaction that creates
-- its run, job and reservation. Every binding is immutable.
CREATE TABLE studio_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES studio_users (id) ON DELETE RESTRICT,
  action text NOT NULL CONSTRAINT studio_quotes_action CHECK (action IN ('full', 'revise', 'replay_critic', 'resume_packaging')),
  params_sha256 text NOT NULL CONSTRAINT studio_quotes_params_sha256_shape CHECK (params_sha256 ~ '^[0-9a-f]{64}$'),
  worker_commit text NOT NULL CONSTRAINT studio_quotes_worker_commit_shape CHECK (worker_commit ~ '^[0-9a-f]{40}$'),
  approved_facts_sha256 text NOT NULL
    CONSTRAINT studio_quotes_approved_facts_sha256_shape CHECK (approved_facts_sha256 ~ '^[0-9a-f]{64}$'),
  fact_version_id uuid NOT NULL REFERENCES studio_fact_versions (id) ON DELETE RESTRICT,
  price_table_sha256 text NOT NULL
    CONSTRAINT studio_quotes_price_table_sha256_shape CHECK (price_table_sha256 ~ '^[0-9a-f]{64}$'),
  ceiling_usd numeric(12,6) NOT NULL CONSTRAINT studio_quotes_ceiling_positive CHECK (ceiling_usd > 0),
  breakdown jsonb NOT NULL
    CONSTRAINT studio_quotes_breakdown_lines CHECK (jsonb_typeof(breakdown) = 'array' AND jsonb_array_length(breakdown) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT studio_quotes_ten_minutes CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes'),
  CONSTRAINT studio_quotes_consumed_in_time CHECK (consumed_at >= created_at AND consumed_at <= expires_at)
);

CREATE FUNCTION studio_quotes_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- §6.3: only an active owner or runner can request a quote.
    IF NOT studio_is_active_user_in_role(NEW.user_id, ARRAY['owner', 'runner']) THEN
      RAISE EXCEPTION 'studio: a quote is requested only by an active owner or runner'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a quote cannot be created consumed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_at > clock_timestamp() + interval '1 minute' THEN
      RAISE EXCEPTION 'studio: a quote cannot be created in the future'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := NEW.created_at + interval '10 minutes';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'consumed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'consumed_at') THEN
      RAISE EXCEPTION 'studio: a quote''s bindings never change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a quote is single use and is already consumed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.consumed_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF now() > OLD.expires_at THEN
      RAISE EXCEPTION 'studio: an expired quote cannot be consumed'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.consumed_at := now();
    RETURN NEW;
  END IF;
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'studio: a consumed quote is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER studio_quotes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON studio_quotes
  FOR EACH ROW EXECUTE FUNCTION studio_quotes_guard();
CREATE TRIGGER studio_quotes_no_truncate
  BEFORE TRUNCATE ON studio_quotes
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- ---------------------------------------------------------------------------
-- §4.2 and §4.3 Runs and their lineage
-- ---------------------------------------------------------------------------

CREATE TABLE studio_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL
    CONSTRAINT studio_runs_kind CHECK (kind IN ('full', 'revise', 'replay_critic', 'resume_packaging', 'imported')),
  source_run_id uuid REFERENCES studio_runs (id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'queued'
    CONSTRAINT studio_runs_state CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'refused', 'cancelled', 'interrupted')),
  requested_by uuid NOT NULL REFERENCES studio_users (id) ON DELETE RESTRICT,
  goal text,
  platforms text[],
  scope_tags text[],
  runner text NOT NULL CONSTRAINT studio_runs_runner CHECK (runner IN ('live', 'fake')),
  fact_version_id uuid REFERENCES studio_fact_versions (id) ON DELETE RESTRICT,
  approved_facts_sha256 text
    CONSTRAINT studio_runs_approved_facts_sha256_shape CHECK (approved_facts_sha256 ~ '^[0-9a-f]{64}$'),
  automotive_facts_sha256 text
    CONSTRAINT studio_runs_automotive_facts_sha256_shape CHECK (automotive_facts_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_pack_sha256 text
    CONSTRAINT studio_runs_evidence_pack_sha256_shape CHECK (evidence_pack_sha256 ~ '^[0-9a-f]{64}$'),
  code_commit text CONSTRAINT studio_runs_code_commit_shape CHECK (code_commit ~ '^[0-9a-f]{40}$'),
  quote_id uuid CONSTRAINT studio_runs_quote_single_use UNIQUE REFERENCES studio_quotes (id) ON DELETE RESTRICT,
  reserved_usd numeric(12,6) CONSTRAINT studio_runs_reserved_positive CHECK (reserved_usd > 0),
  actual_usd numeric(12,6) CONSTRAINT studio_runs_actual_nonnegative CHECK (actual_usd >= 0),
  verdict text CONSTRAINT studio_runs_verdict CHECK (verdict IN ('provisional_pass', 'needs_revision', 'needs_human_review')),
  blocking_findings integer CONSTRAINT studio_runs_blocking_findings_nonnegative CHECK (blocking_findings >= 0),
  advisory_findings integer CONSTRAINT studio_runs_advisory_findings_nonnegative CHECK (advisory_findings >= 0),
  owner_item_findings integer CONSTRAINT studio_runs_owner_item_findings_nonnegative CHECK (owner_item_findings >= 0),
  failure_class text CONSTRAINT studio_runs_failure_class_shape CHECK (failure_class ~ '^[a-z][a-z0-9_]{0,63}$'),
  failure_message text,
  import_tier text CONSTRAINT studio_runs_import_tier CHECK (import_tier IN ('verified', 'archived_unverified')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES studio_users (id) ON DELETE RESTRICT,
  -- A run's recorded automotive-facts sha256 names the version it pinned.
  CONSTRAINT studio_runs_fact_version_fingerprint FOREIGN KEY (fact_version_id, automotive_facts_sha256)
    REFERENCES studio_fact_versions (id, sha256) ON DELETE RESTRICT,
  CONSTRAINT studio_runs_not_own_parent CHECK (source_run_id <> id),
  -- A revise, replay or resume points at the run it read; a full run and an import have no parent.
  CONSTRAINT studio_runs_lineage_shape CHECK ((kind IN ('full', 'imported')) = (source_run_id IS NULL)),
  CONSTRAINT studio_runs_import_tier_only_on_imports CHECK (kind = 'imported' OR import_tier IS NULL),
  -- A live run always has a quote and a reservation (its reserve entry is checked at commit).
  CONSTRAINT studio_runs_live_has_quote CHECK (kind = 'imported' OR runner <> 'live' OR (quote_id IS NOT NULL AND reserved_usd IS NOT NULL)),
  CONSTRAINT studio_runs_fake_is_free CHECK (runner <> 'fake' OR (quote_id IS NULL AND reserved_usd IS NULL)),
  CONSTRAINT studio_runs_import_is_free CHECK (kind <> 'imported' OR (quote_id IS NULL AND reserved_usd IS NULL)),
  CONSTRAINT studio_runs_tombstone_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE INDEX studio_runs_source ON studio_runs (source_run_id);
CREATE INDEX studio_runs_created ON studio_runs (created_at);

CREATE FUNCTION studio_runs_before_insert() RETURNS trigger
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
    IF NEW.runner = 'live' AND source.kind = 'imported' AND source.import_tier IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'studio: an import that is not verified can never be a paid action''s source'
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
CREATE TRIGGER studio_runs_before_insert
  BEFORE INSERT ON studio_runs
  FOR EACH ROW EXECUTE FUNCTION studio_runs_before_insert();

-- A terminal state never changes; nor does anything else about a finished
-- run, except that the owner may tombstone it (§4.7). A run never returns to
-- queued, and its lineage, requester, runner, quote and reservation are fixed
-- at creation. Its fact version is pinned once set.
CREATE FUNCTION studio_runs_before_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF studio_is_terminal_run_state(OLD.state) THEN
    IF (to_jsonb(NEW) - 'deleted_at' - 'deleted_by') IS DISTINCT FROM (to_jsonb(OLD) - 'deleted_at' - 'deleted_by') THEN
      RAISE EXCEPTION 'studio: a run in terminal state % never changes', OLD.state
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'studio: a deleted run''s tombstone never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.deleted_at IS NOT NULL THEN
      IF NOT studio_is_active_user_in_role(NEW.deleted_by, ARRAY['owner']) THEN
        RAISE EXCEPTION 'studio: only an active owner may delete a run'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.deleted_at := now();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'studio: only a finished run may be deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'queued' AND OLD.state <> 'queued' THEN
    RAISE EXCEPTION 'studio: a run never returns to queued'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.runner IS DISTINCT FROM OLD.runner OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.reserved_usd IS DISTINCT FROM OLD.reserved_usd OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'studio: a run''s kind, lineage, requester, runner, quote and reservation never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.fact_version_id IS NOT NULL AND NEW.fact_version_id IS DISTINCT FROM OLD.fact_version_id THEN
    RAISE EXCEPTION 'studio: a run''s pinned fact version never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.import_tier IS NOT NULL AND NEW.import_tier IS DISTINCT FROM OLD.import_tier THEN
    RAISE EXCEPTION 'studio: an import''s tier never changes once set'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_runs_before_update
  BEFORE UPDATE ON studio_runs
  FOR EACH ROW EXECUTE FUNCTION studio_runs_before_update();

CREATE FUNCTION studio_runs_audit_tombstone() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO studio_audit_log (actor_user_id, action, target_type, target_id, detail)
      VALUES (NEW.deleted_by, 'run.delete', 'studio_runs', NEW.id::text, jsonb_build_object('kind', NEW.kind));
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER studio_runs_audit_tombstone
  AFTER UPDATE OF deleted_at ON studio_runs
  FOR EACH ROW EXECUTE FUNCTION studio_runs_audit_tombstone();
-- A run is never deleted: the owner's deletion keeps a tombstone row (§4.7).
CREATE TRIGGER studio_runs_no_delete
  BEFORE DELETE ON studio_runs
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();
CREATE TRIGGER studio_runs_no_truncate
  BEFORE TRUNCATE ON studio_runs
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- ---------------------------------------------------------------------------
-- §4.2 Artifacts, requests and findings
-- ---------------------------------------------------------------------------

-- The authoritative record of a run, byte for byte the files the CLI writes
-- (S1 derives the names from the library). Immutable once written; removed
-- only by the owner's deletion of a finished run, which keeps its tombstone.
CREATE TABLE studio_run_artifacts (
  run_id uuid NOT NULL REFERENCES studio_runs (id) ON DELETE RESTRICT,
  name text NOT NULL CONSTRAINT studio_run_artifacts_name_shape CHECK (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  content bytea NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, name),
  CONSTRAINT studio_run_artifacts_sha256_of_content CHECK (sha256 = encode(sha256(content), 'hex')),
  CONSTRAINT studio_run_artifacts_length_of_content CHECK (byte_length = octet_length(content))
);

CREATE FUNCTION studio_run_artifacts_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run studio_runs%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'studio: a run artifact is immutable once written'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO run FROM studio_runs WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.run_id ELSE OLD.run_id END;
  IF TG_OP = 'INSERT' THEN
    IF FOUND AND (run.deleted_at IS NOT NULL OR studio_is_terminal_run_state(run.state)) THEN
      RAISE EXCEPTION 'studio: a finished or deleted run takes no new artifact'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF run.deleted_at IS NULL THEN
    RAISE EXCEPTION 'studio: a run artifact is removed only by the owner''s deletion of its run'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$$;
CREATE TRIGGER studio_run_artifacts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON studio_run_artifacts
  FOR EACH ROW EXECUTE FUNCTION studio_run_artifacts_guard();
CREATE TRIGGER studio_run_artifacts_no_truncate
  BEFORE TRUNCATE ON studio_run_artifacts
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- One row per provider request. A `started` row carrying that request's own
-- ceiling is committed before the request is sent, and completed once when it
-- returns. `charged_usd` is what the run is charged for it: its measured cost
-- once completed with a known cost, otherwise its full ceiling, so a crash or
-- an unknown cost never frees money that was probably spent.
CREATE TABLE studio_run_requests (
  run_id uuid NOT NULL REFERENCES studio_runs (id) ON DELETE RESTRICT,
  seq integer NOT NULL CONSTRAINT studio_run_requests_seq_positive CHECK (seq >= 1),
  stage text NOT NULL CONSTRAINT studio_run_requests_stage CHECK (stage IN (
    'strategy-concept', 'automotive-truth', 'hook-story-script', 'production-direction',
    'packaging-adaptation', 'final-critic')),
  lens text CONSTRAINT studio_run_requests_lens CHECK (lens IN (
    'evidence-fidelity', 'platform-and-local', 'voice-and-craft', 'production-coherence')),
  model text NOT NULL CONSTRAINT studio_run_requests_model_shape CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  ceiling_usd numeric(12,6) NOT NULL CONSTRAINT studio_run_requests_ceiling_positive CHECK (ceiling_usd > 0),
  input_tokens integer CONSTRAINT studio_run_requests_input_nonnegative CHECK (input_tokens >= 0),
  output_tokens integer CONSTRAINT studio_run_requests_output_nonnegative CHECK (output_tokens >= 0),
  cost_usd numeric(12,6) CONSTRAINT studio_run_requests_cost_nonnegative CHECK (cost_usd >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text NOT NULL DEFAULT 'started' CONSTRAINT studio_run_requests_outcome CHECK (outcome IN ('started', 'succeeded', 'failed')),
  charged_usd numeric(12,6) GENERATED ALWAYS AS (
    CASE WHEN outcome <> 'started' AND cost_usd IS NOT NULL THEN cost_usd ELSE ceiling_usd END) STORED,
  PRIMARY KEY (run_id, seq),
  CONSTRAINT studio_run_requests_lens_only_for_critic CHECK ((lens IS NOT NULL) = (stage = 'final-critic')),
  CONSTRAINT studio_run_requests_finished_when_completed CHECK ((outcome = 'started') = (finished_at IS NULL)),
  CONSTRAINT studio_run_requests_started_has_no_result CHECK (
    outcome <> 'started' OR (cost_usd IS NULL AND input_tokens IS NULL AND output_tokens IS NULL))
);

CREATE FUNCTION studio_run_requests_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'studio: a run request is never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT state INTO run_state FROM studio_runs WHERE id = NEW.run_id;
  IF TG_OP = 'INSERT' THEN
    IF run_state IS DISTINCT FROM 'running' THEN
      RAISE EXCEPTION 'studio: a request row is written only for a running run'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.outcome <> 'started' THEN
      RAISE EXCEPTION 'studio: a request row is written started, before the request is sent'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.started_at := now();
    RETURN NEW;
  END IF;
  IF OLD.outcome <> 'started' THEN
    RAISE EXCEPTION 'studio: a completed request row never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF studio_is_terminal_run_state(run_state) THEN
    RAISE EXCEPTION 'studio: a finished run''s request rows never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.seq IS DISTINCT FROM OLD.seq OR NEW.stage IS DISTINCT FROM OLD.stage
     OR NEW.lens IS DISTINCT FROM OLD.lens OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.ceiling_usd IS DISTINCT FROM OLD.ceiling_usd OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'studio: a request''s stage, lens, model, ceiling and start never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_run_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON studio_run_requests
  FOR EACH ROW EXECUTE FUNCTION studio_run_requests_guard();
CREATE TRIGGER studio_run_requests_no_truncate
  BEFORE TRUNCATE ON studio_run_requests
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- Derived from 06-final-critic.json by the library's own accessors, and
-- rebuildable from that artifact (delete and insert, never update). The value
-- sets are finalCritic.ts's closed sets (the offline suite checks they have not
-- drifted). owner_item is true exactly where planRevision holds a finding back:
-- a human_review owner or a human_decision category.
CREATE TABLE studio_findings (
  run_id uuid NOT NULL REFERENCES studio_runs (id) ON DELETE RESTRICT,
  idx integer NOT NULL CONSTRAINT studio_findings_idx_nonnegative CHECK (idx >= 0),
  lens text NOT NULL CONSTRAINT studio_findings_lens CHECK (lens IN (
    'evidence-fidelity', 'platform-and-local', 'voice-and-craft', 'production-coherence')),
  severity text NOT NULL CONSTRAINT studio_findings_severity CHECK (severity IN ('blocking', 'advisory')),
  category text NOT NULL CONSTRAINT studio_findings_category CHECK (category IN (
    'claim_fidelity', 'uncited_implication', 'platform_semantics', 'voice_clarity',
    'hashtag_keyword_relevance', 'timing', 'production_coherence', 'human_decision')),
  owner text NOT NULL CONSTRAINT studio_findings_owner CHECK (owner IN (
    'hook-story-script', 'production-direction', 'packaging-adaptation', 'human_review')),
  issue text NOT NULL,
  owner_item boolean NOT NULL,
  PRIMARY KEY (run_id, idx),
  CONSTRAINT studio_findings_lens_category CHECK (
    (lens = 'evidence-fidelity' AND category IN ('claim_fidelity', 'uncited_implication', 'human_decision'))
    OR (lens = 'platform-and-local' AND category IN ('platform_semantics', 'hashtag_keyword_relevance', 'timing', 'human_decision'))
    OR (lens = 'voice-and-craft' AND category IN ('voice_clarity', 'human_decision'))
    OR (lens = 'production-coherence' AND category IN ('production_coherence', 'human_decision'))),
  CONSTRAINT studio_findings_owner_item_rule CHECK (owner_item = (owner = 'human_review' OR category = 'human_decision'))
);

CREATE FUNCTION studio_findings_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'studio: a finding is rebuilt from its artifact, never updated'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM studio_runs WHERE id = NEW.run_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'studio: a deleted run takes no finding'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_findings_guard
  BEFORE INSERT OR UPDATE ON studio_findings
  FOR EACH ROW EXECUTE FUNCTION studio_findings_guard();

-- ---------------------------------------------------------------------------
-- §4.6 The spend ledger
-- ---------------------------------------------------------------------------

-- Append-only (the two-year purge of §4.7 aside, which does not exist yet).
-- Only a live Studio run has entries: exactly one reserve, equal to its
-- reservation, and at most one settlement (a release or an overrun). A release
-- never exceeds the reservation. Every entry is booked to the day and month of
-- its run's reserve entry, in America/New_York, even when written after
-- midnight; the database sets created_at, so a reservation cannot be
-- back-dated onto an earlier day. Spend: studio_spend_for_day / _for_month.
CREATE TABLE studio_spend_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry text NOT NULL CONSTRAINT studio_spend_ledger_entry CHECK (entry IN ('reserve', 'release', 'overrun')),
  run_id uuid NOT NULL REFERENCES studio_runs (id) ON DELETE RESTRICT,
  amount_usd numeric(12,6) NOT NULL CONSTRAINT studio_spend_ledger_amount_positive CHECK (amount_usd > 0),
  day_local date NOT NULL,
  month_local date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_spend_ledger_month_of_day CHECK (month_local = studio_month_of(day_local))
);
CREATE UNIQUE INDEX studio_spend_ledger_one_reserve ON studio_spend_ledger (run_id) WHERE entry = 'reserve';
CREATE UNIQUE INDEX studio_spend_ledger_one_settlement ON studio_spend_ledger (run_id) WHERE entry IN ('release', 'overrun');
CREATE INDEX studio_spend_ledger_day ON studio_spend_ledger (day_local);
CREATE INDEX studio_spend_ledger_month ON studio_spend_ledger (month_local);

CREATE FUNCTION studio_spend_ledger_before_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run studio_runs%ROWTYPE;
  reserve studio_spend_ledger%ROWTYPE;
  booked_day date;
BEGIN
  -- Serializes a run's ledger writes.
  SELECT * INTO run FROM studio_runs WHERE id = NEW.run_id FOR UPDATE;
  IF NOT FOUND OR run.runner <> 'live' OR run.kind = 'imported' THEN
    RAISE EXCEPTION 'studio: only a live Studio run has spend-ledger entries'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  IF NEW.entry = 'reserve' THEN
    IF NEW.amount_usd <> run.reserved_usd THEN
      RAISE EXCEPTION 'studio: a reserve entry equals its run''s reservation'
        USING ERRCODE = 'check_violation';
    END IF;
    booked_day := studio_local_day(NEW.created_at);
  ELSE
    SELECT * INTO reserve FROM studio_spend_ledger WHERE run_id = NEW.run_id AND entry = 'reserve';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'studio: a % entry needs its run''s reserve entry first', NEW.entry
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.entry = 'release' AND NEW.amount_usd > reserve.amount_usd THEN
      RAISE EXCEPTION 'studio: a release cannot exceed its run''s reservation'
        USING ERRCODE = 'check_violation';
    END IF;
    booked_day := reserve.day_local;
  END IF;
  IF NEW.day_local IS NOT NULL AND NEW.day_local <> booked_day
     OR NEW.month_local IS NOT NULL AND NEW.month_local <> studio_month_of(booked_day) THEN
    RAISE EXCEPTION 'studio: a ledger entry is booked to its run''s reserve day and month (America/New_York)'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.day_local := booked_day;
  NEW.month_local := studio_month_of(booked_day);
  RETURN NEW;
END
$$;
CREATE TRIGGER studio_spend_ledger_before_insert
  BEFORE INSERT ON studio_spend_ledger
  FOR EACH ROW EXECUTE FUNCTION studio_spend_ledger_before_insert();
CREATE TRIGGER studio_spend_ledger_append_only
  BEFORE UPDATE OR DELETE ON studio_spend_ledger
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();
CREATE TRIGGER studio_spend_ledger_no_truncate
  BEFORE TRUNCATE ON studio_spend_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- Spend for a day (or month) is Σreserve − Σrelease + Σoverrun over its entries (§4.6).
CREATE FUNCTION studio_spend_for_day(p_day date) RETURNS numeric
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(SUM(CASE entry WHEN 'release' THEN -amount_usd ELSE amount_usd END), 0)::numeric(12,6)
  FROM studio_spend_ledger WHERE day_local = p_day
$$;
CREATE FUNCTION studio_spend_for_month(p_month date) RETURNS numeric
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(SUM(CASE entry WHEN 'release' THEN -amount_usd ELSE amount_usd END), 0)::numeric(12,6)
  FROM studio_spend_ledger WHERE month_local = studio_month_of(p_month)
$$;

-- ---------------------------------------------------------------------------
-- §4.6 Jobs and the worker heartbeat
-- ---------------------------------------------------------------------------

-- One job per run, never retried (no attempts column; a job never returns to
-- queued). A queued job past expires_at is never started. A free preflight job
-- runs before any run exists (§6.1), so only it may have no run.
CREATE TABLE studio_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid CONSTRAINT studio_jobs_one_per_run UNIQUE REFERENCES studio_runs (id) ON DELETE RESTRICT,
  kind text NOT NULL CONSTRAINT studio_jobs_kind CHECK (kind IN ('preflight', 'paid', 'fake')),
  state text NOT NULL DEFAULT 'queued'
    CONSTRAINT studio_jobs_state CHECK (state IN ('queued', 'running', 'finished', 'cancelled', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  worker_commit text CONSTRAINT studio_jobs_worker_commit_shape CHECK (worker_commit ~ '^[0-9a-f]{40}$'),
  CONSTRAINT studio_jobs_run_required CHECK (kind = 'preflight' OR run_id IS NOT NULL),
  CONSTRAINT studio_jobs_expiry_within_an_hour CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour'),
  CONSTRAINT studio_jobs_claimed_when_started CHECK (state NOT IN ('running', 'finished') OR claimed_at IS NOT NULL)
);
CREATE INDEX studio_jobs_queued ON studio_jobs (kind, created_at) WHERE state = 'queued';

CREATE FUNCTION studio_jobs_guard() RETURNS trigger
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
                    OR (NEW.kind = 'fake') <> (run.runner = 'fake')) THEN
        RAISE EXCEPTION 'studio: a paid job runs a live run and a fake job a fake run'
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
CREATE TRIGGER studio_jobs_guard
  BEFORE INSERT OR UPDATE ON studio_jobs
  FOR EACH ROW EXECUTE FUNCTION studio_jobs_guard();
CREATE TRIGGER studio_jobs_no_truncate
  BEFORE TRUNCATE ON studio_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- The singleton heartbeat. Written by the worker (§4.6); the web reads the
-- fingerprints and tag counts from here, never loading the fact files or the
-- pricing code itself.
CREATE TABLE studio_worker_heartbeat (
  singleton boolean PRIMARY KEY DEFAULT true CONSTRAINT studio_worker_heartbeat_singleton CHECK (singleton),
  commit text NOT NULL CONSTRAINT studio_worker_heartbeat_commit_shape CHECK (commit ~ '^[0-9a-f]{40}$'),
  schema_version text NOT NULL
    CONSTRAINT studio_worker_heartbeat_schema_version_shape CHECK (schema_version ~ '^[0-9]{4}_[a-z0-9_]+\.sql$'),
  approved_facts_sha256 text NOT NULL
    CONSTRAINT studio_worker_heartbeat_approved_facts_shape CHECK (approved_facts_sha256 ~ '^[0-9a-f]{64}$'),
  approved_facts_tag_counts jsonb NOT NULL
    CONSTRAINT studio_worker_heartbeat_tag_counts_object CHECK (jsonb_typeof(approved_facts_tag_counts) = 'object'),
  price_table_sha256 text NOT NULL
    CONSTRAINT studio_worker_heartbeat_price_table_shape CHECK (price_table_sha256 ~ '^[0-9a-f]{64}$'),
  beat_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Checked at commit: a live run is created with its consumed quote, its
-- reserve entry and its paid job, in one transaction (§6.1 step 4), and a quote
-- is consumed only by that transaction.
-- ---------------------------------------------------------------------------

CREATE FUNCTION studio_check_paid_confirmation(p_run uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run studio_runs%ROWTYPE;
BEGIN
  SELECT * INTO run FROM studio_runs WHERE id = p_run;
  IF NOT EXISTS (SELECT 1 FROM studio_quotes q WHERE q.id = run.quote_id AND q.consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'studio: a live run''s quote is consumed in the transaction that creates it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM studio_spend_ledger l WHERE l.run_id = run.id AND l.entry = 'reserve'
                 AND l.amount_usd = run.reserved_usd) THEN
    RAISE EXCEPTION 'studio: a live run''s reserve entry is created in the transaction that creates it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM studio_jobs j WHERE j.run_id = run.id AND j.kind = 'paid') THEN
    RAISE EXCEPTION 'studio: a live run''s paid job is created in the transaction that creates it'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

CREATE FUNCTION studio_runs_check_confirmation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.runner = 'live' AND NEW.kind <> 'imported' THEN
    PERFORM studio_check_paid_confirmation(NEW.id);
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER studio_runs_check_confirmation
  AFTER INSERT ON studio_runs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION studio_runs_check_confirmation();

CREATE FUNCTION studio_quotes_check_consumption() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  run_id uuid;
BEGIN
  IF OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL THEN
    SELECT r.id INTO run_id FROM studio_runs r WHERE r.quote_id = NEW.id;
    IF run_id IS NULL THEN
      RAISE EXCEPTION 'studio: a quote is consumed only by the transaction that creates its run'
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM studio_check_paid_confirmation(run_id);
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER studio_quotes_check_consumption
  AFTER UPDATE ON studio_quotes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION studio_quotes_check_consumption();
