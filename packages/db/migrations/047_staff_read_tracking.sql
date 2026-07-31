-- Staff-specific read tracking for chat messages and friend lifecycle activity.
-- Workflow status (unread/in_progress/resolved) remains independent from these cursors.

CREATE TABLE IF NOT EXISTS chat_read_receipts (
  friend_id    TEXT NOT NULL,
  staff_id     TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (friend_id, staff_id),
  FOREIGN KEY (friend_id) REFERENCES friends (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_read_receipts_staff
  ON chat_read_receipts (staff_id, last_read_at);

CREATE TABLE IF NOT EXISTS staff_activity_cursors (
  staff_id        TEXT NOT NULL,
  line_account_id TEXT NOT NULL,
  activity_type   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  PRIMARY KEY (staff_id, line_account_id, activity_type)
);

CREATE INDEX IF NOT EXISTS idx_staff_activity_cursors_lookup
  ON staff_activity_cursors (staff_id, activity_type, line_account_id);

-- Preserve operator expectations at rollout: existing history is the baseline,
-- so only messages and lifecycle events arriving after this migration are new.
INSERT OR IGNORE INTO chat_read_receipts (friend_id, staff_id, last_read_at)
SELECT m.friend_id, staff_ids.id, MAX(m.created_at)
FROM messages_log m
CROSS JOIN (
  SELECT 'env-owner' AS id
  UNION ALL
  SELECT id FROM staff_members WHERE is_active = 1 AND id != 'env-owner'
) staff_ids
WHERE m.direction = 'incoming'
  AND (m.delivery_type IS NULL OR m.delivery_type != 'test')
GROUP BY m.friend_id, staff_ids.id;

INSERT OR IGNORE INTO staff_activity_cursors
  (staff_id, line_account_id, activity_type, last_seen_at)
SELECT
  staff_ids.id,
  f.line_account_id,
  'friend_lifecycle',
  MAX(e.event_at)
FROM friend_follow_events e
INNER JOIN friends f ON f.id = e.friend_id
CROSS JOIN (
  SELECT 'env-owner' AS id
  UNION ALL
  SELECT id FROM staff_members WHERE is_active = 1 AND id != 'env-owner'
) staff_ids
WHERE f.line_account_id IS NOT NULL
GROUP BY staff_ids.id, f.line_account_id;
