-- 046_friend_lifecycle_events.sql
-- Expand follow history into a complete friend lifecycle timeline.

CREATE TABLE friend_follow_events_next (
  id               TEXT PRIMARY KEY,
  friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL CHECK (event_type IN ('added', 'blocked', 'unblocked')),
  event_at         TEXT NOT NULL,
  webhook_event_id TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO friend_follow_events_next
  (id, friend_id, event_type, event_at, webhook_event_id, created_at)
SELECT id, friend_id, event_type, event_at, webhook_event_id, created_at
FROM friend_follow_events;

DROP TABLE friend_follow_events;
ALTER TABLE friend_follow_events_next RENAME TO friend_follow_events;

CREATE INDEX IF NOT EXISTS idx_friend_follow_events_friend_event_at
  ON friend_follow_events (friend_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_friend_follow_events_event_at
  ON friend_follow_events (event_at DESC);

-- Existing installations did not store the initial follow event. Use the
-- friend registration time so the global timeline is immediately useful.
INSERT OR IGNORE INTO friend_follow_events
  (id, friend_id, event_type, event_at, webhook_event_id, created_at)
SELECT
  'backfill-added-' || id,
  id,
  'added',
  created_at,
  'backfill-added:' || id,
  created_at
FROM friends;
