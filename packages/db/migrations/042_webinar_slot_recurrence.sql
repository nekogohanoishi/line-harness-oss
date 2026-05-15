-- 042_webinar_slot_recurrence.sql
-- Phase 6 Webinar Launch:
--   6a. event_slot_recurrence: 毎日 cron で N 日分の event_slots を自動生成
--   6b. events.cart_relative_close_minutes / cart_expired_redirect_url:
--       カート期間 (CTA URL の切替) の管理
--   6b. event_cart_status: 友だち x event の個別カート状態
-- See: docs/specs/2026-05-14-webinar-launch-design.md (Phase 6 章)
-- Conventions: TEXT (UUID) primary keys, created_at/updated_at default in JST,
-- time-of-event columns written by Worker as UTC ISO8601 (Z-suffixed) without DB default.

-- ============================================================
-- 6a. event_slot_recurrence: 予約枠の自動生成ルール
-- ============================================================
CREATE TABLE IF NOT EXISTS event_slot_recurrence (
  id                       TEXT PRIMARY KEY,
  event_id                 TEXT NOT NULL,
  -- daily: 毎日; weekly: weekdays_json で指定した曜日のみ
  pattern_type             TEXT NOT NULL CHECK (pattern_type IN ('daily','weekly')),
  -- JSON array. weekly: [0..6] (日曜=0). daily: 空配列 or NULL
  weekdays_json            TEXT,
  -- JSON array of "HH:MM" 文字列 (JST), 例: '["10:00","20:00","22:00"]'
  times_json               TEXT NOT NULL,
  duration_minutes         INTEGER NOT NULL,
  capacity                 INTEGER,
  -- 何日先まで生成するか (例: 14日先まで)
  generate_days_ahead      INTEGER NOT NULL DEFAULT 14,
  timezone                 TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  is_active                INTEGER NOT NULL DEFAULT 1,
  -- ISO 日付 (YYYY-MM-DD). これより先は次回 cron で生成する.
  last_generated_through   TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_event_slot_recurrence_event
  ON event_slot_recurrence (event_id, is_active);

-- ============================================================
-- 6b. events: カート期間管理用カラムを追加
-- ============================================================
-- 動画再生終了から N 分後にカート閉鎖 (NULL = カート期間管理なし、CTA URL は素通り)
ALTER TABLE events ADD COLUMN cart_relative_close_minutes INTEGER;
-- カート閉鎖後 CTA クリックでフォールバックさせる URL (例: 次回ウェビナー案内 LP).
-- NULL の場合は CTA の action_value をそのまま使う (=切替なし).
ALTER TABLE events ADD COLUMN cart_expired_redirect_url TEXT;

-- ============================================================
-- 6b. event_cart_status: 友だち x event の個別カート状態
-- ============================================================
-- ウェビナー視聴完了で opened_at を打つ. closes_at = opened_at + cart_relative_close_minutes.
-- 1 booking につき 1 行 (UNIQUE(booking_id)). 既存 webinar_completed_at と独立に管理し、
-- 既存の完視聴判定を壊さないために別テーブルとした.
CREATE TABLE IF NOT EXISTS event_cart_status (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL,
  booking_id   TEXT NOT NULL,
  friend_id    TEXT NOT NULL,
  -- カート開始時刻 (UTC ISO8601, Z-suffix). NULL=未開始
  opened_at    TEXT,
  -- カート閉鎖時刻 (UTC ISO8601, Z-suffix).
  closes_at    TEXT,
  -- 購入確定時刻 (UTC ISO8601, Z-suffix). Stripe webhook 連携で将来実装する想定.
  purchased_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES friends(id) ON DELETE CASCADE,
  UNIQUE (booking_id)
);
CREATE INDEX IF NOT EXISTS idx_event_cart_status_friend
  ON event_cart_status (friend_id, event_id);
CREATE INDEX IF NOT EXISTS idx_event_cart_status_closes
  ON event_cart_status (closes_at)
  WHERE purchased_at IS NULL;
