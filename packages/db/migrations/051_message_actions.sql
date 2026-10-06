-- ボタンの動き: メッセージのボタンやクイックリプライを押したときに Harness が行う処理。
-- kind = 'postback': 押した友だちにタグ付け・シナリオ開始・友だち情報の書き込み・返信を行う。
--                    ボタン側は postback data "lh:act:<id>" でこの行を指す。
-- kind = 'link'    : 締切つきリンク。ボタン側は <Worker>/go/<id> を開き、締切前は link_url、
--                    締切後は expired_url (なければ受付終了の案内ページ) へ移す。
-- 日時は他の表と同じく日本時間の文字列で持つ (deadline_at は 'YYYY-MM-DDTHH:MM')。
CREATE TABLE IF NOT EXISTS message_actions (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'postback' CHECK (kind IN ('postback', 'link')),
  steps           TEXT NOT NULL DEFAULT '[]',
  link_url        TEXT,
  once_per_friend INTEGER NOT NULL DEFAULT 0,
  repeat_reply    TEXT,
  deadline_at     TEXT,
  expired_reply   TEXT,
  expired_url     TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_message_actions_account ON message_actions (line_account_id);

-- 押された記録。リンクは誰が開いたか分からないので friend_id は NULL になる。
-- result: done = 処理した / repeat = 1人1回の2回目以降 / expired = 締切後 / opened = リンクを開いた
CREATE TABLE IF NOT EXISTS message_action_logs (
  id         TEXT PRIMARY KEY,
  action_id  TEXT NOT NULL REFERENCES message_actions (id) ON DELETE CASCADE,
  friend_id  TEXT REFERENCES friends (id) ON DELETE CASCADE,
  result     TEXT NOT NULL CHECK (result IN ('done', 'repeat', 'expired', 'opened')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_message_action_logs_action_friend ON message_action_logs (action_id, friend_id, result);
