-- Phase 0B.0: durable content evidence.
--
-- Evidence is the substrate the Content Intelligence stages reason over, so the
-- database — not prose and not a model — is where epistemic class is enforced.
-- The CHECK constraints below mirror the TypeScript contract in
-- src/harness/evidence/contract.ts. Both exist on purpose: application
-- validation gives good errors, the database makes the invariant true.
--
-- History is never destroyed. Superseding a claim inserts a new row and marks
-- the old one 'superseded' with a pointer; it never UPDATEs the claim text and
-- never DELETEs. An auditor can always reconstruct what was believed and when.
--
-- No secrets, no customer PII, no raw analytics payloads. `detail` is for small
-- structured context only.

-- The repository migration runner wraps this file in one transaction. Bound it
-- so an unexpected lock waits visibly rather than indefinitely.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

CREATE TABLE IF NOT EXISTS content_evidence (
  id                text PRIMARY KEY,
  kind              text NOT NULL,
  claim             text NOT NULL,
  subject           text NOT NULL,
  attribute         text,
  tags              text[] NOT NULL DEFAULT '{}',
  source_type       text NOT NULL,
  source_ref        text,
  provenance        text,
  confidence        double precision,
  observed_at       timestamptz,
  reviewed_at       timestamptz,
  reviewed_by       text,
  review_by         timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  lifecycle         text NOT NULL DEFAULT 'active',
  superseded_by_id  text REFERENCES content_evidence(id) ON DELETE RESTRICT,
  generalizable     boolean NOT NULL DEFAULT false,
  detail            jsonb,

  CONSTRAINT content_evidence_kind_check CHECK (kind IN (
    'verified_automotive_fact',
    'verified_business_fact',
    'sourced_research',
    'gcd_direct_observation',
    'gcd_performance_evidence',
    'creative_hypothesis',
    'causal_hypothesis',
    'unsupported_assumption'
  )),

  CONSTRAINT content_evidence_lifecycle_check CHECK (lifecycle IN (
    'draft', 'active', 'superseded', 'retired', 'rejected'
  )),

  CONSTRAINT content_evidence_source_type_check CHECK (source_type IN (
    'repository_config',
    'manufacturer_documentation',
    'industry_publication',
    'regulatory_or_standards_body',
    'gcd_shop_record',
    'gcd_staff_observation',
    'platform_analytics',
    'model_inference',
    'unattributed'
  )),

  CONSTRAINT content_evidence_claim_present CHECK (length(btrim(claim)) > 0),
  CONSTRAINT content_evidence_subject_present CHECK (length(btrim(subject)) > 0),
  CONSTRAINT content_evidence_confidence_range CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),

  -- A verified claim is only verified if a human can go and check it, and a
  -- model's own output can never be the thing that verifies it.
  CONSTRAINT content_evidence_verified_requires_source CHECK (
    kind NOT IN ('verified_automotive_fact', 'verified_business_fact')
    OR (
      source_ref IS NOT NULL AND length(btrim(source_ref)) > 0
      AND provenance IS NOT NULL AND length(btrim(provenance)) > 0
      AND reviewed_at IS NOT NULL
      AND source_type NOT IN ('model_inference', 'unattributed')
    )
  ),

  -- Research keeps its external identity and an assessable freshness anchor.
  CONSTRAINT content_evidence_research_requires_source CHECK (
    kind <> 'sourced_research'
    OR (
      source_ref IS NOT NULL AND length(btrim(source_ref)) > 0
      AND source_type <> 'unattributed'
      AND (observed_at IS NOT NULL OR reviewed_at IS NOT NULL)
    )
  ),

  -- An observation is a report of one thing seen. Promoting it to a universal
  -- rule requires authoring a separate verified fact with its own source.
  CONSTRAINT content_evidence_observation_requires_observed_at CHECK (
    kind <> 'gcd_direct_observation'
    OR (observed_at IS NOT NULL AND provenance IS NOT NULL AND generalizable = false)
  ),

  -- Performance is measurement. It is never automotive truth and never a cause.
  CONSTRAINT content_evidence_performance_shape CHECK (
    kind <> 'gcd_performance_evidence'
    OR (
      observed_at IS NOT NULL
      AND source_type IN ('platform_analytics', 'gcd_shop_record')
      AND generalizable = false
    )
  ),

  -- A causal claim cannot assert certainty; an unsupported assumption cannot
  -- masquerade as probable.
  CONSTRAINT content_evidence_causal_not_certain CHECK (
    kind <> 'causal_hypothesis' OR confidence IS NULL OR confidence < 1
  ),
  CONSTRAINT content_evidence_assumption_low_confidence CHECK (
    kind <> 'unsupported_assumption' OR confidence IS NULL OR confidence <= 0.5
  ),

  -- Supersession is explicit, and only meaningful in one direction.
  CONSTRAINT content_evidence_supersession_shape CHECK (
    (lifecycle = 'superseded' AND superseded_by_id IS NOT NULL)
    OR (lifecycle <> 'superseded' AND superseded_by_id IS NULL)
  ),
  CONSTRAINT content_evidence_no_self_supersede CHECK (superseded_by_id IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS content_evidence_kind_lifecycle_idx
  ON content_evidence (kind, lifecycle);
CREATE INDEX IF NOT EXISTS content_evidence_subject_idx
  ON content_evidence (subject);
-- Conflict detection reads active fact-class rows by subject and attribute.
CREATE INDEX IF NOT EXISTS content_evidence_subject_attribute_idx
  ON content_evidence (subject, attribute) WHERE attribute IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_evidence_active_idx
  ON content_evidence (lifecycle) WHERE lifecycle = 'active';
CREATE INDEX IF NOT EXISTS content_evidence_review_by_idx
  ON content_evidence (review_by) WHERE review_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_evidence_tags_idx
  ON content_evidence USING gin (tags);

-- Relations are a separate table so a claim can support, contradict, or replace
-- more than one other claim without denormalizing arrays into the row.
CREATE TABLE IF NOT EXISTS content_evidence_relations (
  from_id     text NOT NULL REFERENCES content_evidence(id) ON DELETE RESTRICT,
  to_id       text NOT NULL REFERENCES content_evidence(id) ON DELETE RESTRICT,
  kind        text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (from_id, to_id, kind),
  CONSTRAINT content_evidence_relations_kind_check CHECK (kind IN (
    'supports', 'conflicts_with', 'supersedes'
  )),
  CONSTRAINT content_evidence_relations_no_self CHECK (from_id <> to_id)
);

CREATE INDEX IF NOT EXISTS content_evidence_relations_to_idx
  ON content_evidence_relations (to_id, kind);
CREATE INDEX IF NOT EXISTS content_evidence_relations_kind_idx
  ON content_evidence_relations (kind);

-- Keep updated_at honest without hiding that claim text is meant to be
-- immutable in practice: corrections are supersessions, not edits.
CREATE OR REPLACE FUNCTION content_evidence_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS content_evidence_touch_updated_at_trigger ON content_evidence;
CREATE TRIGGER content_evidence_touch_updated_at_trigger
  BEFORE UPDATE ON content_evidence
  FOR EACH ROW EXECUTE FUNCTION content_evidence_touch_updated_at();
