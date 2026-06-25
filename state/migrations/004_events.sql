-- Live activity feed for the console / "live game view". The worker appends an
-- event at each milestone (brief start, each agent start/finish, image, critic
-- verdict, awaiting approval, published). The web service streams these over SSE
-- (/console/stream) and summarizes them (/console/state). Read-only telemetry —
-- no secrets. Monotonic bigint id doubles as the SSE "since" cursor.
CREATE TABLE IF NOT EXISTS events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      text,
  kind        text NOT NULL,
  agent       text,
  message     text NOT NULL,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_created_idx ON events (created_at);
