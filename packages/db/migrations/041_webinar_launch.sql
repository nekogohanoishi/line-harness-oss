-- 041_webinar_launch.sql
-- Webinar Launch (擬似ライブ配信 + CTA + 視聴計測) 機能の追加。
-- See: docs/specs/2026-05-14-webinar-launch-design.md
--
-- 既存 events はすべて kind='standard' で動作不変。
-- kind='webinar' のときのみ、video_r2_key / cta / heartbeat 関連を使用する。
-- Conventions: TEXT (UUID) primary keys, created_at/updated_at default in JST,
-- time-of-event columns (occurred_at / clicked_at / etc.) written by Worker as
-- UTC ISO8601 (Z-suffixed) without DB default.

-- ============================================================
-- events: ウェビナー用カラムを追加
-- ============================================================
ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'
  CHECK (kind IN ('standard', 'webinar'));

-- R2 オブジェクトキー: webinar/{accountId}/{eventId}/video.{ext}
ALTER TABLE events ADD COLUMN video_r2_key TEXT;
ALTER TABLE events ADD COLUMN video_duration_seconds INTEGER;
ALTER TABLE events ADD COLUMN video_mime_type TEXT;
ALTER TABLE events ADD COLUMN video_size_bytes INTEGER;

-- リプレイ視聴可能期間 (動画終了後 N 分まで). NULL or 0 = リプレイ不可.
ALTER TABLE events ADD COLUMN replay_window_minutes INTEGER DEFAULT 1440;

-- 完視聴判定の閾値秒数. NULL の場合は duration の 80%.
ALTER TABLE events ADD COLUMN attendance_threshold_seconds INTEGER;

-- replay_window_minutes 経過後のリダイレクト先 (アーカイブ販売LP等).
ALTER TABLE events ADD COLUMN archive_url TEXT;

-- ============================================================
-- webinar_cta_items: 動画タイムスタンプ連動 CTA
-- ============================================================
CREATE TABLE IF NOT EXISTS webinar_cta_items (
  id                     TEXT PRIMARY KEY,
  event_id               TEXT NOT NULL,
  at_seconds             INTEGER NOT NULL,
  display_mode           TEXT NOT NULL CHECK (display_mode IN ('banner','modal','sticky')),
  label                  TEXT NOT NULL,
  action_type            TEXT NOT NULL CHECK (action_type IN ('url','tag','tracked_link','close')),
  action_value           TEXT,
  dismiss_after_seconds  INTEGER,
  sort_order             INTEGER NOT NULL DEFAULT 0,
  is_active              INTEGER NOT NULL DEFAULT 1,
  deleted_at             TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webinar_cta_items_event_at
  ON webinar_cta_items (event_id, at_seconds);
CREATE INDEX IF NOT EXISTS idx_webinar_cta_items_event_active
  ON webinar_cta_items (event_id, is_active) WHERE deleted_at IS NULL;

-- ============================================================
-- event_bookings: 視聴トラッキング列を追加
-- ============================================================
ALTER TABLE event_bookings ADD COLUMN webinar_first_opened_at TEXT;
ALTER TABLE event_bookings ADD COLUMN webinar_video_started_at TEXT;
ALTER TABLE event_bookings ADD COLUMN webinar_max_position_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_bookings ADD COLUMN webinar_completed_at TEXT;
ALTER TABLE event_bookings ADD COLUMN webinar_last_heartbeat_at TEXT;

-- ============================================================
-- webinar_heartbeats: 視聴進捗ログ (分析用)
-- ============================================================
CREATE TABLE IF NOT EXISTS webinar_heartbeats (
  id                TEXT PRIMARY KEY,
  booking_id        TEXT NOT NULL,
  position_seconds  INTEGER NOT NULL,
  occurred_at       TEXT NOT NULL,
  user_agent        TEXT,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webinar_heartbeats_booking_occurred
  ON webinar_heartbeats (booking_id, occurred_at);

-- ============================================================
-- webinar_cta_clicks: CTA クリック履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS webinar_cta_clicks (
  id                TEXT PRIMARY KEY,
  booking_id        TEXT NOT NULL,
  cta_item_id       TEXT NOT NULL,
  position_seconds  INTEGER NOT NULL,
  clicked_at        TEXT NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (cta_item_id) REFERENCES webinar_cta_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webinar_cta_clicks_booking
  ON webinar_cta_clicks (booking_id);
CREATE INDEX IF NOT EXISTS idx_webinar_cta_clicks_cta
  ON webinar_cta_clicks (cta_item_id);
