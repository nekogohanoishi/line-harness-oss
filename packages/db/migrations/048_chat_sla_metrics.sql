-- Chat response deadlines and historical response-time metrics.
-- chats stores the active cycle; completed cycles are snapshotted separately.

ALTER TABLE chats ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE chats ADD COLUMN due_at TEXT;
ALTER TABLE chats ADD COLUMN opened_at TEXT;
ALTER TABLE chats ADD COLUMN first_response_at TEXT;
ALTER TABLE chats ADD COLUMN first_response_operator_id TEXT REFERENCES operators (id) ON DELETE SET NULL;
ALTER TABLE chats ADD COLUMN resolved_at TEXT;

UPDATE chats
SET opened_at = COALESCE(last_message_at, updated_at, created_at)
WHERE status != 'resolved' AND opened_at IS NULL;

-- Convert to the project's JST ISO format after adding the 24-hour default SLA.
UPDATE chats
SET due_at = strftime(
  '%Y-%m-%dT%H:%M:%f+09:00',
  datetime(opened_at, '+24 hours', '+9 hours')
)
WHERE status != 'resolved' AND opened_at IS NOT NULL AND due_at IS NULL;

UPDATE chats
SET resolved_at = COALESCE(updated_at, created_at)
WHERE status = 'resolved' AND resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_resolution_events (
  id                         TEXT PRIMARY KEY,
  chat_id                    TEXT NOT NULL,
  friend_id                  TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  operator_id                TEXT REFERENCES operators (id) ON DELETE SET NULL,
  first_response_operator_id TEXT REFERENCES operators (id) ON DELETE SET NULL,
  resolved_by_staff_id       TEXT,
  priority                   TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  opened_at                  TEXT,
  first_response_at          TEXT,
  resolved_at                TEXT NOT NULL,
  first_response_seconds     INTEGER,
  created_at                 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_priority ON chats (priority);
CREATE INDEX IF NOT EXISTS idx_chats_due_status ON chats (status, due_at);
CREATE INDEX IF NOT EXISTS idx_chats_operator_status ON chats (operator_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_resolution_events_resolved
  ON chat_resolution_events (resolved_at);
CREATE INDEX IF NOT EXISTS idx_chat_resolution_events_operator
  ON chat_resolution_events (operator_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_chat_resolution_events_responder
  ON chat_resolution_events (first_response_operator_id, resolved_at);
