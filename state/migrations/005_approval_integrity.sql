-- Phase 0A: bind every approval to one immutable, canonical payload.
--
-- Existing approval links were stored in plaintext and were not bound to a
-- canonical SHA-256. They are deliberately revoked during this migration.
-- A human must review a newly-created request before any later publication.

-- The repository migration runner wraps this file in one transaction. Fail
-- visibly instead of waiting indefinitely behind an unexpected old-service
-- transaction, and bound each scan/backfill statement. Expected Phase-0A table
-- sizes are small; a timeout requires operator review rather than a retry loop.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS subject_type text;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS subject_payload jsonb;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS payload_sha256 text;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS approval_token_hash text;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS authorization_expires_at timestamptz;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS revoked_by text;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS revocation_reason text;

-- A pre-Phase-0A row has neither a canonical application-generated hash nor a
-- hashed decision token. Do not grandfather it into the stronger gate.
UPDATE approval_queue
SET revoked_at = COALESCE(revoked_at, now()),
    revoked_by = COALESCE(revoked_by, 'migration:005_approval_integrity'),
    revocation_reason = COALESCE(
      revocation_reason,
      'Legacy approval was not canonically hash-bound; submit a new approval request.'
    )
WHERE status IN ('pending', 'approved')
  AND (payload_sha256 IS NULL OR approval_token_hash IS NULL);

-- Normalize any row left by a partially-applied earlier draft before adding
-- the strict all-or-none revocation constraint below.
UPDATE approval_queue
SET revoked_by = COALESCE(NULLIF(btrim(revoked_by), ''), 'migration:005_approval_integrity'),
    revocation_reason = COALESCE(
      NULLIF(btrim(revocation_reason), ''),
      'Approval was revoked before immutable revocation metadata was enforced.'
    )
WHERE revoked_at IS NOT NULL;

-- The transitional decision secret is returned once to the caller. Only its
-- SHA-256 is retained after this migration.
UPDATE approval_queue SET approval_token = NULL WHERE approval_token IS NOT NULL;

ALTER TABLE approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_no_plaintext_token;
ALTER TABLE approval_queue
  ADD CONSTRAINT approval_queue_no_plaintext_token
  CHECK (approval_token IS NULL);

ALTER TABLE approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_payload_sha256_format;
ALTER TABLE approval_queue
  ADD CONSTRAINT approval_queue_payload_sha256_format
  CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_token_hash_format;
ALTER TABLE approval_queue
  ADD CONSTRAINT approval_queue_token_hash_format
  CHECK (approval_token_hash IS NULL OR approval_token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_revocation_shape;
ALTER TABLE approval_queue
  ADD CONSTRAINT approval_queue_revocation_shape
  CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
    OR (
      revoked_at IS NOT NULL
      AND NULLIF(btrim(revoked_by), '') IS NOT NULL
      AND NULLIF(btrim(revocation_reason), '') IS NOT NULL
    )
  );

ALTER TABLE approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_bound_live_shape;
ALTER TABLE approval_queue
  ADD CONSTRAINT approval_queue_bound_live_shape
  CHECK (
    revoked_at IS NOT NULL
    OR status NOT IN ('pending', 'approved')
    OR (
      NULLIF(subject_type, '') IS NOT NULL
      AND subject_payload IS NOT NULL
      AND payload_sha256 IS NOT NULL
      AND approval_token_hash IS NOT NULL
      AND token_expires_at IS NOT NULL
      AND authorization_expires_at IS NOT NULL
    )
  );

ALTER TABLE approval_queue
  DROP CONSTRAINT IF EXISTS approval_queue_subject_copies_match;
ALTER TABLE approval_queue
  ADD CONSTRAINT approval_queue_subject_copies_match
  CHECK (
    subject_payload IS NULL
    OR (
      package IS NOT NULL
      AND package_formatted IS NOT NULL
      AND package = subject_payload
      AND package_formatted = subject_payload
    )
  );

CREATE INDEX IF NOT EXISTS approval_queue_live_authorization_idx
  ON approval_queue (id, status, authorization_expires_at)
  WHERE revoked_at IS NULL AND status = 'approved';

-- The queue row carries current workflow state. This append-only record keeps
-- the one terminal human decision and the exact subject hash it authorized.
CREATE TABLE IF NOT EXISTS approval_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id     uuid NOT NULL UNIQUE REFERENCES approval_queue(id) ON DELETE RESTRICT,
  decision        text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  subject_type    text NOT NULL,
  payload_sha256  text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  decided_by      text NOT NULL,
  decided_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_decisions_decided_at_idx
  ON approval_decisions (decided_at);

CREATE OR REPLACE FUNCTION prevent_approval_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'approval decisions are append-only';
END;
$$;

DROP TRIGGER IF EXISTS approval_decision_no_update ON approval_decisions;
CREATE TRIGGER approval_decision_no_update
BEFORE UPDATE ON approval_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_approval_decision_mutation();

DROP TRIGGER IF EXISTS approval_decision_no_delete ON approval_decisions;
CREATE TRIGGER approval_decision_no_delete
BEFORE DELETE ON approval_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_approval_decision_mutation();

-- Approval content, its digest, and its decision/authorization lifetimes are
-- immutable after insertion. Decision metadata may be written only with the
-- single pending -> approved/rejected transition. Revocation is one-way and
-- immutable once written. Publication outcome may follow only an approval.
CREATE OR REPLACE FUNCTION prevent_approval_subject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.platform IS DISTINCT FROM NEW.platform
     OR OLD.package IS DISTINCT FROM NEW.package
     OR OLD.package_formatted IS DISTINCT FROM NEW.package_formatted
     OR OLD.summary IS DISTINCT FROM NEW.summary
     OR OLD.subject_type IS DISTINCT FROM NEW.subject_type
     OR OLD.subject_payload IS DISTINCT FROM NEW.subject_payload
     OR OLD.payload_sha256 IS DISTINCT FROM NEW.payload_sha256
     OR OLD.approval_token IS DISTINCT FROM NEW.approval_token
     OR OLD.approval_token_hash IS DISTINCT FROM NEW.approval_token_hash
     OR OLD.token_expires_at IS DISTINCT FROM NEW.token_expires_at
     OR OLD.authorization_expires_at IS DISTINCT FROM NEW.authorization_expires_at
  THEN
    RAISE EXCEPTION 'approval subject and authorization material are immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
       OR (OLD.status = 'approved' AND NEW.status IN ('posted', 'failed'))
     )
  THEN
    RAISE EXCEPTION 'invalid approval status transition: % -> %', OLD.status, NEW.status;
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF NEW.revoked_at IS NOT NULL
       OR NULLIF(btrim(NEW.decided_by), '') IS NULL
       OR NEW.decided_at IS NULL
    THEN
      RAISE EXCEPTION 'approval decisions require an active row and complete decision metadata';
    END IF;
  ELSIF OLD.decided_by IS DISTINCT FROM NEW.decided_by
        OR OLD.decided_at IS DISTINCT FROM NEW.decided_at
  THEN
    RAISE EXCEPTION 'approval decision metadata may only be written with the terminal decision';
  END IF;

  IF OLD.revoked_at IS NOT NULL
     AND (
       OLD.revoked_at IS DISTINCT FROM NEW.revoked_at
       OR OLD.revoked_by IS DISTINCT FROM NEW.revoked_by
       OR OLD.revocation_reason IS DISTINCT FROM NEW.revocation_reason
     )
  THEN
    RAISE EXCEPTION 'approval revocation is immutable';
  END IF;

  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
     AND OLD.status NOT IN ('pending', 'approved')
  THEN
    RAISE EXCEPTION 'only pending or approved authorizations may be revoked';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS approval_subject_immutable ON approval_queue;
CREATE TRIGGER approval_subject_immutable
BEFORE UPDATE ON approval_queue
FOR EACH ROW EXECUTE FUNCTION prevent_approval_subject_mutation();

-- Hosted media is part of the approved artifact, not merely a mutable URL.
-- Backfill a byte digest, enforce it on every row, and prevent the URL's media
-- mapping from being updated or deleted after it can enter an approval.
ALTER TABLE media ADD COLUMN IF NOT EXISTS content_sha256 text;

UPDATE media
SET content_sha256 = encode(digest(bytes, 'sha256'), 'hex')
WHERE content_sha256 IS NULL;

ALTER TABLE media ALTER COLUMN content_sha256 SET NOT NULL;

ALTER TABLE media
  DROP CONSTRAINT IF EXISTS media_content_sha256_format;
ALTER TABLE media
  ADD CONSTRAINT media_content_sha256_format
  CHECK (content_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE media
  DROP CONSTRAINT IF EXISTS media_content_sha256_matches_bytes;
ALTER TABLE media
  ADD CONSTRAINT media_content_sha256_matches_bytes
  CHECK (content_sha256 = encode(digest(bytes, 'sha256'), 'hex'));

CREATE OR REPLACE FUNCTION prevent_media_content_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'content-addressed media rows cannot be deleted';
  END IF;
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.mime IS DISTINCT FROM NEW.mime
     OR OLD.bytes IS DISTINCT FROM NEW.bytes
     OR OLD.content_sha256 IS DISTINCT FROM NEW.content_sha256
  THEN
    RAISE EXCEPTION 'approved media content is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS media_content_immutable ON media;
CREATE TRIGGER media_content_immutable
BEFORE UPDATE OR DELETE ON media
FOR EACH ROW EXECUTE FUNCTION prevent_media_content_mutation();

COMMENT ON COLUMN approval_queue.approval_token IS
  'Deprecated plaintext token column. Phase 0A writes NULL and stores only approval_token_hash.';
COMMENT ON COLUMN approval_queue.subject_payload IS
  'Canonical JSON approval subject. Application verifies payload_sha256 before every publication.';
COMMENT ON COLUMN approval_queue.payload_sha256 IS
  'Lowercase SHA-256 of the application canonical JSON representation of subject_payload.';
COMMENT ON COLUMN media.content_sha256 IS
  'Lowercase SHA-256 of immutable media bytes; embedded in every Phase-0A publication URL and approval subject.';
