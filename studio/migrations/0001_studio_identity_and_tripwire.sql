-- Content Studio migration 0001 — the database identity, the Studio migration
-- ledger, and the tripwire against the live migration runner.
--
-- Applied only by the Studio runner, src/studio/db/migrate.ts
-- (`npm run studio:migrate`), to the Studio database `gcd_studio`. Never by the
-- live runner src/state/migrate.ts, which reads only state/migrations/ and
-- cannot see this directory. See docs/CONTENT_STUDIO_DESIGN.md §3.7 and
-- docs/DATA_MODEL.md ("Content Studio schema").
--
-- The Studio runner applies this file and records it in
-- studio_schema_migrations (created below) inside one transaction, so a
-- failure anywhere in it leaves nothing behind.

-- Defence in depth beside the runner's own identity check: this file refuses
-- to run in any database but gcd_studio, whoever runs it and however.
DO $$
BEGIN
  IF current_database() <> 'gcd_studio' THEN
    RAISE EXCEPTION 'studio: migration 0001 refuses database "%": the Studio database is gcd_studio',
      current_database();
  END IF;
END
$$;

-- Refuses the row change or TRUNCATE that fired it. Shared by every Studio
-- table whose rows are immutable or append-only.
CREATE FUNCTION studio_refuse_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'studio: % on % is refused: its rows are immutable', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END
$$;

-- THE STUDIO TRIPWIRE (design §3.7, separation 5). This table is NOT a
-- migration ledger and nothing ever writes to it. It has the name and the
-- column the live runner (src/state/migrate.ts) uses, so if that runner were
-- ever pointed at this database its `CREATE TABLE IF NOT EXISTS _migrations`
-- would do nothing, its first `INSERT INTO _migrations (name)` would violate
-- the CHECK (false) below, and its transaction would roll back: no live schema
-- can persist here. The Studio runner refuses any database whose `_migrations`
-- lacks this exact constraint (it is then a live database). Verified by
-- execution against the unchanged live runner in
-- src/studio/db/migrate.postgres.selftest.ts. The Studio's own ledger is
-- studio_schema_migrations.
CREATE TABLE _migrations (
  name text CONSTRAINT studio_tripwire_pkey PRIMARY KEY
    CONSTRAINT studio_tripwire_refuses_live_runner CHECK (false),
  applied_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE _migrations IS
  'Content Studio tripwire: never written. Its CHECK (false) makes the live runner (src/state/migrate.ts) fail and roll back if it is ever pointed at the Studio database. The Studio ledger is studio_schema_migrations.';
COMMENT ON CONSTRAINT studio_tripwire_refuses_live_runner ON _migrations IS
  'Content Studio tripwire (design §3.7): refuses every row, so the live runner''s first INSERT fails.';

-- The Studio migration ledger (design §3.7, separation 2). One row per
-- applied file, with the sha256 of its exact bytes; the runner refuses a
-- recorded file whose bytes have changed. Rows never change.
CREATE TABLE studio_schema_migrations (
  name text PRIMARY KEY
    CONSTRAINT studio_schema_migrations_name_shape CHECK (name ~ '^[0-9]{4}_[a-z0-9_]+\.sql$'),
  sha256 text NOT NULL
    CONSTRAINT studio_schema_migrations_sha256_shape CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER studio_schema_migrations_immutable
  BEFORE UPDATE OR DELETE ON studio_schema_migrations
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();
CREATE TRIGGER studio_schema_migrations_no_truncate
  BEFORE TRUNCATE ON studio_schema_migrations
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();

-- The database identity (design §3.7, separation 4): one row, written once,
-- never changed. The Studio runner, and later the Studio web and worker at
-- start-up (design §3.2), refuse a database whose row is missing or differs.
CREATE TABLE studio_database_identity (
  singleton boolean PRIMARY KEY DEFAULT true
    CONSTRAINT studio_database_identity_singleton CHECK (singleton),
  database_name text NOT NULL
    CONSTRAINT studio_database_identity_database CHECK (database_name = 'gcd_studio'),
  marker text NOT NULL
    CONSTRAINT studio_database_identity_marker CHECK (marker = 'gcd-studio:database-identity:v1'),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO studio_database_identity (database_name, marker)
  VALUES (current_database(), 'gcd-studio:database-identity:v1');
CREATE TRIGGER studio_database_identity_immutable
  BEFORE UPDATE OR DELETE ON studio_database_identity
  FOR EACH ROW EXECUTE FUNCTION studio_refuse_change();
CREATE TRIGGER studio_database_identity_no_truncate
  BEFORE TRUNCATE ON studio_database_identity
  FOR EACH STATEMENT EXECUTE FUNCTION studio_refuse_change();
