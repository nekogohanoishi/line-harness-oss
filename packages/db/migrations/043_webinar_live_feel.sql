-- 043_webinar_live_feel.sql
-- Phase 7 Webinar Launch: ライブ感演出機能
--   7a. 同接視聴者数表示 (concurrent_floor / concurrent_jitter_max / show_concurrent_viewers)
--       実視聴者数は既存の webinar_heartbeats から直近 2 分以内の booking 数を集計するため
--       新規テーブルは不要。 events に表示制御カラムだけ追加する。
--   7b. コメント風固定表示 (webinar_fake_comments テーブル新規 + show_fake_comments)
--       本物のチャットではなく、ライブ感演出のためのスクリプト化されたコメント。
-- See: docs/specs/2026-05-14-webinar-launch-design.md (Phase 7 章)
-- Conventions: TEXT (UUID) primary keys, created_at/updated_at default in JST,
-- time-of-event columns written by Worker as UTC ISO8601 (Z-suffixed) without DB default.

-- ============================================================
-- 7a. events: 同接視聴者数表示の設定カラム
-- ============================================================
-- 表示する最低値 (fake floor). 実視聴者がこれ以下なら floor 値を表示する.
ALTER TABLE events ADD COLUMN concurrent_floor INTEGER NOT NULL DEFAULT 0;
-- 表示値に [0, jitter_max] のランダム値を足す (ライブ感の自然な変動).
ALTER TABLE events ADD COLUMN concurrent_jitter_max INTEGER NOT NULL DEFAULT 0;
-- 同接表示の on/off (default OFF).
ALTER TABLE events ADD COLUMN show_concurrent_viewers INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 7b. events: コメント演出の on/off
-- ============================================================
ALTER TABLE events ADD COLUMN show_fake_comments INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 7b. webinar_fake_comments: スクリプト化コメント
-- ============================================================
-- video timestamp (at_seconds) 連動で動画下部に流す擬似コメント.
-- 1 event 内で同時刻に複数行が存在することを許容 (同時に複数コメント表示可).
CREATE TABLE IF NOT EXISTS webinar_fake_comments (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL,
  -- 動画開始から N 秒経過時に表示開始
  at_seconds    INTEGER NOT NULL,
  -- 1〜30 文字
  author_name   TEXT NOT NULL,
  -- 1〜200 文字
  body          TEXT NOT NULL,
  -- 任意: 著者のアバター色 (CSS color). 未指定なら client 側で hash から生成.
  author_color  TEXT,
  -- 同時刻に複数表示する場合の並び制御
  sort_order    INTEGER NOT NULL DEFAULT 0,
  deleted_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webinar_fake_comments_event_at
  ON webinar_fake_comments (event_id, at_seconds);
