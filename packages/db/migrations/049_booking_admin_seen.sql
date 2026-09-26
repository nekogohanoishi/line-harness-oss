-- Migration 049: Separate staff acknowledgement from booking status.
-- Existing rows are backfilled as seen so this migration does not create a
-- large false-positive inbox. New rows stay unseen until an admin explicitly
-- acknowledges them.

ALTER TABLE bookings ADD COLUMN admin_seen_at TEXT;
UPDATE bookings
   SET admin_seen_at = COALESCE(updated_at, requested_at)
 WHERE admin_seen_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_account_admin_seen
  ON bookings (line_account_id, admin_seen_at, requested_at DESC);

ALTER TABLE event_bookings ADD COLUMN admin_seen_at TEXT;
UPDATE event_bookings
   SET admin_seen_at = COALESCE(updated_at, requested_at)
 WHERE admin_seen_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_bookings_account_admin_seen
  ON event_bookings (line_account_id, admin_seen_at, requested_at DESC);
