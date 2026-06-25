-- Phase 7/8: hosted media. We transcode generated images to JPEG (Instagram
-- requires JPEG; fal's Ideogram returns PNG) and serve them from the web service.
CREATE TABLE IF NOT EXISTS media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime        text NOT NULL,
  bytes       bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
