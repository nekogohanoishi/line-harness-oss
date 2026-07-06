-- 044_webinar_abandonment.sql
-- Phase 8 Webinar Launch: 視聴離脱イベント (webinar_abandoned)
--
-- heartbeat が一定時間途絶えた confirmed booking を cron で検知し、
-- automation/scoring に webinar_abandoned を一度だけ流すための列。
-- 時刻は Worker から UTC ISO8601 (Z-suffixed) で書く。

ALTER TABLE event_bookings ADD COLUMN webinar_abandoned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_event_bookings_webinar_abandoned_scan
  ON event_bookings (status, webinar_completed_at, webinar_abandoned_at, webinar_last_heartbeat_at);
