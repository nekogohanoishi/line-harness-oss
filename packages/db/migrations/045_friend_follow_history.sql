-- 045_friend_follow_history.sql
-- Store LINE block/unblock transitions using the original webhook timestamp.
-- Existing blocked friends intentionally keep blocked_at NULL because
-- updated_at is not a reliable substitute for the original unfollow event.

ALTER TABLE friends ADD COLUMN blocked_at TEXT;
ALTER TABLE friends ADD COLUMN last_unblocked_at TEXT;

CREATE INDEX IF NOT EXISTS idx_friends_following ON friends (is_following);

CREATE TABLE IF NOT EXISTS friend_follow_events (
  id               TEXT PRIMARY KEY,
  friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL CHECK (event_type IN ('blocked', 'unblocked')),
  event_at         TEXT NOT NULL,
  webhook_event_id TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_friend_follow_events_friend_event_at
  ON friend_follow_events (friend_id, event_at DESC);
