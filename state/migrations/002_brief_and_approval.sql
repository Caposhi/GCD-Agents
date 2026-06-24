-- Phase 6: brief queue + tokenized approvals.

-- Per-approval secret token (guards the decision endpoint) and the formatted
-- package to publish on approval.
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS approval_token text;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS package_formatted jsonb;
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS summary text;

-- Briefs accepted by /triggers; the worker claims and runs them.
CREATE TABLE IF NOT EXISTS brief_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  brief       jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','running','done','failed')),
  claimed_at  timestamptz,
  outcome     jsonb
);
CREATE INDEX IF NOT EXISTS brief_queue_status_idx ON brief_queue (status, created_at);
