-- GCD-SOCIAL initial schema.
-- Tables: approval queue, brand scorecard, self-improvement proposal lineage,
-- and cross-run session memory. Idempotent (IF NOT EXISTS) so re-runs are safe.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Approval queue — the HITL gate. Every Phase-A post lands here as 'pending'
-- and may only be published after a recorded human 'approved' decision.
CREATE TABLE IF NOT EXISTS approval_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  platform    text NOT NULL,
  package     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected','posted','failed')),
  channel     text,                 -- where the request was routed (e.g. slack)
  decided_by  text,                 -- human approver identity
  decided_at  timestamptz,
  notes       text
);
CREATE INDEX IF NOT EXISTS approval_queue_status_idx ON approval_queue (status, created_at);

-- Brand scorecard — per-package quality record feeding the brand scorecard and
-- (when enabled) the propose-only self-improvement loop.
CREATE TABLE IF NOT EXISTS brand_scorecard (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  run_id           text,
  platform         text NOT NULL,
  voice_score      numeric,         -- rubric: voice
  compliance_pass  boolean,         -- brand-compliance-critic verdict
  critique_cycles  integer NOT NULL DEFAULT 0,
  reworked         boolean NOT NULL DEFAULT false,
  metrics          jsonb,           -- post-publish performance, filled later
  notes            text
);
CREATE INDEX IF NOT EXISTS brand_scorecard_platform_idx ON brand_scorecard (platform, created_at);

-- Self-improvement proposal lineage — mirrors the proposal format in
-- skills/self-improvement-protocol/SKILL.md. Propose-don't-apply: rows are
-- proposals only; application is a separate, human-approved step.
CREATE TABLE IF NOT EXISTS self_improvement_proposals (
  proposal_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  proposing_agent  text NOT NULL,
  parent_version   text,            -- file@sha or prompt-version this modifies
  target           text NOT NULL,   -- which file/prompt/skill
  risk_tier        text NOT NULL CHECK (risk_tier IN ('low','medium','high')),
  change_summary   text NOT NULL,
  rationale        text,
  proposed_diff    text,
  guardrail_impact text NOT NULL DEFAULT 'none'
                   CHECK (guardrail_impact IN ('none','adds-guardrail','loosens-guardrail')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','applied','rolled-back'))
);
CREATE INDEX IF NOT EXISTS sip_status_idx ON self_improvement_proposals (status, created_at);

-- Cross-run session memory (ECC memory-persistence lifecycle, our impl).
CREATE TABLE IF NOT EXISTS session_state (
  session_id  text PRIMARY KEY,
  state       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
