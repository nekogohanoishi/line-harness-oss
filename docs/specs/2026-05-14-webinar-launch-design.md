# Webinar Launch 設計書

**Date**: 2026-05-14
**Author**: feature/webinar-launch
**Status**: Draft
**Migration target**: 041_webinar_launch.sql

## 1. 概要

LINE Harness に「ウェビナーローンチ」機能を追加する。録画動画を **擬似ライブ配信** として、予約時刻に同期再生し、CTA を時間連動で表示。視聴ログとイベント発火を IF-THEN・scoring に連結し、教育→商品提示→決済の完全自動化フロー（オートウェビナーローンチ）を実現する。

UTAGE のオートウェビナー機能、WebinarFuel・EverWebinar 系の SaaS にあたる機能を OSS で実装する。

## 2. ゴール / 非ゴール

### ゴール
- 録画動画を R2 にアップロードし、予約時刻に擬似ライブ再生
- 予約時刻からの経過秒数に応じて `<video currentTime>` をシーク → 「いつ来ても途中から始まる」演出
- CTA タイムスタンプ機能: 動画の N 秒経過時にボタン・モーダル・LP 遷移を出す
- 視聴ログ heartbeat: 視聴開始・進捗・完了を D1 に記録
- 既存の event_booking_reminders を流用したリマインダ
- 視聴完了・CTAクリックを IF-THEN トリガに連結 → タグ付与・シナリオ起動・スコア加点
- 公開期間（replay window）終了後は archive ページに切替

### 非ゴール（v1）
- リアルタイムの双方向ライブ配信（既存の Zoom / YouTube Live で代替）
- 動画編集・トリミング機能
- 同時視聴者数の表示（フェイクライブ感は v2 で検討）
- 視聴者間チャット（コメント風固定演出は v2）
- 動画 DRM・透かし
- マルチビットレート HLS（v1 は MP4 progressive のみ）

## 3. アーキテクチャ概観

```
[ Admin UI (Cloudflare Pages) ]
   ↓ video upload (R2 signed PUT)
[ Cloudflare R2 ] ←── stream/signed GET ── [ Worker /webinar/video/:bookingId ]
                                                     ↑
                                                     │ access control
                                                     │
[ Friend (LIFF) ] ── GET /liff/webinar/:bookingId ──┤
   ↓ heartbeat / cta-click
[ Worker /api/webinar/* ]
   ↓ 視聴完了/CTAクリック
[ Event Bus → automations → tags / scenarios / scoring ]
```

主要原則:
- **アクセス制御は Worker で完結**: R2 URL を直接公開しない。Worker が bookingId と LIFF 認証から判定して動画ストリームを proxy
- **既存テーブル拡張優先**: events に webinar 用カラム追加。新規テーブルは heartbeat と CTA クリック履歴のみ
- **既存 event_booking_reminders 流用**: ウェビナー専用のリマインダ仕組みは作らない

## 4. DB スキーマ変更（Migration 041）

### 4.1 events テーブル拡張

```sql
ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'
  CHECK (kind IN ('standard', 'webinar'));
ALTER TABLE events ADD COLUMN video_r2_key TEXT;                    -- R2 オブジェクトキー
ALTER TABLE events ADD COLUMN video_duration_seconds INTEGER;       -- 動画の総秒数
ALTER TABLE events ADD COLUMN video_mime_type TEXT;                 -- video/mp4 等
ALTER TABLE events ADD COLUMN video_size_bytes INTEGER;
ALTER TABLE events ADD COLUMN replay_window_minutes INTEGER DEFAULT 1440;  -- 終了後 24h 視聴可
ALTER TABLE events ADD COLUMN attendance_threshold_seconds INTEGER;        -- 完視聴とみなす秒数（NULL = duration の 80%）
ALTER TABLE events ADD COLUMN archive_url TEXT;                     -- 公開期間切れ後のリダイレクト先
```

### 4.2 webinar_cta_items（新規）

```sql
CREATE TABLE IF NOT EXISTS webinar_cta_items (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL,
  at_seconds      INTEGER NOT NULL,             -- 動画開始から N 秒
  display_mode    TEXT NOT NULL CHECK (display_mode IN ('banner','modal','sticky')),
  label           TEXT NOT NULL,                -- ボタン文言
  action_type     TEXT NOT NULL CHECK (action_type IN ('url','tag','tracked_link','close')),
  action_value    TEXT,                         -- url / tag_id / tracked_link_id
  dismiss_after_seconds INTEGER,                -- N秒後に自動で閉じる (NULL=手動のみ)
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webinar_cta_items_event ON webinar_cta_items (event_id, at_seconds);
```

### 4.3 event_bookings テーブル拡張

```sql
ALTER TABLE event_bookings ADD COLUMN webinar_first_opened_at TEXT;        -- LIFF初回open
ALTER TABLE event_bookings ADD COLUMN webinar_video_started_at TEXT;       -- play() 発火
ALTER TABLE event_bookings ADD COLUMN webinar_max_position_seconds INTEGER DEFAULT 0;  -- 最大到達位置
ALTER TABLE event_bookings ADD COLUMN webinar_completed_at TEXT;           -- 完視聴 threshold 到達時刻
ALTER TABLE event_bookings ADD COLUMN webinar_last_heartbeat_at TEXT;
```

### 4.4 webinar_heartbeats（新規・分析用）

```sql
CREATE TABLE IF NOT EXISTS webinar_heartbeats (
  id              TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL,
  position_seconds INTEGER NOT NULL,
  occurred_at     TEXT NOT NULL,
  user_agent      TEXT,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webinar_heartbeats_booking ON webinar_heartbeats (booking_id, occurred_at);
```

### 4.5 webinar_cta_clicks（新規）

```sql
CREATE TABLE IF NOT EXISTS webinar_cta_clicks (
  id              TEXT PRIMARY KEY,
  booking_id      TEXT NOT NULL,
  cta_item_id     TEXT NOT NULL,
  position_seconds INTEGER NOT NULL,   -- クリック時の動画位置
  clicked_at      TEXT NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (cta_item_id) REFERENCES webinar_cta_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webinar_cta_clicks_booking ON webinar_cta_clicks (booking_id);
CREATE INDEX IF NOT EXISTS idx_webinar_cta_clicks_cta ON webinar_cta_clicks (cta_item_id);
```

## 5. API エンドポイント

### 5.1 Admin (`/api/events/admin/...`)

| Method | Path | 役割 |
|---|---|---|
| `POST` | `/api/events/admin/:id/video/upload-url` | R2 アップロード用 presigned PUT URL を発行 |
| `POST` | `/api/events/admin/:id/video/finalize` | アップロード完了後、メタデータ (duration, size, mime) を確定 |
| `DELETE` | `/api/events/admin/:id/video` | 動画を削除 |
| `GET` | `/api/events/admin/:id/cta` | CTA一覧 |
| `POST` | `/api/events/admin/:id/cta` | CTA作成 |
| `PUT` | `/api/events/admin/:id/cta/:ctaId` | CTA更新 |
| `DELETE` | `/api/events/admin/:id/cta/:ctaId` | CTA削除 |
| `GET` | `/api/events/admin/:id/webinar/stats` | 視聴統計（参加者・完視聴率・CTA別CTR） |
| `GET` | `/api/events/admin/bookings/:id/webinar/timeline` | 個別予約者の視聴タイムライン |

### 5.2 LIFF / Friend (`/liff/webinar/...`, `/api/webinar/...`)

| Method | Path | 役割 |
|---|---|---|
| `GET` | `/liff/webinar/:bookingId` | 視聴ページHTML (account の liffId を解決して bootstrap) |
| `GET` | `/api/webinar/:bookingId/manifest` | 視聴ページ初期データ (動画info, CTA一覧, slot.starts_at, server時刻, 視聴状態) |
| `GET` | `/api/webinar/:bookingId/video/stream` | 動画ストリーミング (Worker → R2 proxy, Range request対応) |
| `POST` | `/api/webinar/:bookingId/event/opened` | LIFF初回open記録 |
| `POST` | `/api/webinar/:bookingId/event/started` | 動画再生開始記録 |
| `POST` | `/api/webinar/:bookingId/event/heartbeat` | 視聴進捗 (30秒毎) |
| `POST` | `/api/webinar/:bookingId/event/cta-click` | CTAクリック記録 |
| `POST` | `/api/webinar/:bookingId/event/completed` | 完視聴到達 |

すべての LIFF API は `verifyCallerLineUserId` で LIFF id_token を検証し、bookingId.friend_id と一致確認。

### 5.3 アクセス制御マトリクス

| 状態 | 動画ストリーム | CTA表示 |
|---|---|---|
| 予約時刻前（開始30分前まで） | カウントダウンのみ | 非表示 |
| 予約時刻前（30分前〜0分） | ウェイティングルーム動画（オプション） | 非表示 |
| 予約時刻 〜 動画終了 | currentTime=elapsed で再生 | timestamp連動表示 |
| 動画終了 〜 replay_window | 先頭からシーク可能で再生 | 全CTA表示 |
| replay_window 経過後 | archive_url にリダイレクト or 終了画面 | 非表示 |

## 6. LIFF 視聴ページ設計

`apps/worker/src/client/webinar.ts` + 対応HTMLテンプレート (`/liff/webinar/:bookingId`)。

### 6.1 状態マシン

```typescript
type WebinarState =
  | { kind: 'pre_start'; secondsUntilStart: number }
  | { kind: 'live'; serverElapsed: number; videoDuration: number }
  | { kind: 'replay'; isReplayWindow: true }
  | { kind: 'expired'; archiveUrl: string | null };
```

### 6.2 擬似ライブ同期ロジック

```typescript
const slotStart = new Date(manifest.slot.starts_at).getTime();
const serverNow = manifest.server_now_ts;
const clientNow = Date.now();
const clockSkew = clientNow - serverNow;

setInterval(() => {
  const trueNow = Date.now() - clockSkew;
  const elapsed = (trueNow - slotStart) / 1000;

  if (elapsed < 0) {
    renderCountdown(-elapsed);
  } else if (elapsed < manifest.video.duration) {
    // ライブモード: シーク + 自動再生（ただしユーザー操作後）
    if (video.paused && userHasInteracted) {
      video.currentTime = elapsed;
      video.play();
    }
    // ドリフト補正: 実際の currentTime と elapsed が3秒以上ずれたら再シーク
    if (Math.abs(video.currentTime - elapsed) > 3) {
      video.currentTime = elapsed;
    }
  } else if (elapsed < manifest.video.duration + manifest.replay_window_seconds) {
    // リプレイモード: シーク自由
    renderReplayMode();
  } else {
    location.href = manifest.archive_url ?? '/liff/webinar/expired';
  }
}, 1000);
```

### 6.3 CTA表示制御

```typescript
video.ontimeupdate = () => {
  const pos = Math.floor(video.currentTime);
  for (const cta of manifest.ctas) {
    if (pos >= cta.at_seconds && !shownCtas.has(cta.id)) {
      showCta(cta);
      shownCtas.add(cta.id);
    }
  }
};
```

### 6.4 ライブモードの制約（重要）

擬似ライブ感を演出するため、ライブモード中は:
- **シークバー操作禁止** (`video.controls = false` + カスタムプログレスバー)
- **倍速変更禁止**
- **巻き戻し禁止**

リプレイモード（動画終了後〜replay_window内）は通常コントロール有効化。

## 7. Admin UI 拡張

### 7.1 ファイル

- `apps/web/src/app/events/edit/page.tsx`: 既存ページにタブ追加
  - 「基本設定」「予約枠」「ウェビナー設定」(kind='webinar'時のみ)
- 新規: `apps/web/src/components/events/webinar-settings.tsx`
  - 動画アップロード（直接 R2 PUT、進捗バー）
  - CTA タイムラインエディタ（動画プレビュー + 秒数指定 + ドラッグソート）
  - replay_window_minutes, attendance_threshold_seconds 入力
  - 視聴統計ダッシュボード

### 7.2 イベント作成時の kind 選択

`apps/web/src/app/events/new/page.tsx` に kind ラジオボタン追加。

## 8. 既存機能との統合

### 8.1 リマインダ (event_booking_reminders)

既存のリマインダ仕組みをそのまま使う。`event.kind='webinar'` の場合、リマインダ送信時のメッセージに **LIFF 視聴URL** を含めるよう template を拡張:

```
明日 10:00 から「{{event.name}}」が始まります。
こちらからご視聴ください:
{{webinar_url}}
```

### 8.2 IF-THEN (automations)

新しいトリガタイプ:
- `webinar_started`: 動画再生開始
- `webinar_completed`: 完視聴 threshold 到達
- `webinar_cta_clicked`: 特定CTA クリック (cta_item_id 指定可)
- `webinar_abandoned`: heartbeat が N 分以上途絶え（バッチ処理）

これらは event-bus で fireEvent → automations.ts の handler が拾う。

### 8.3 Scoring

スコアリングルールに以下を追加可能に:
- 「ウェビナー視聴開始」: +10pt
- 「ウェビナー完視聴」: +50pt
- 「ウェビナーCTAクリック」: +20pt

### 8.4 tracked-links

CTA の action_type='tracked_link' を選んだ場合、既存の tracked-links を使ってクリック数を二重計測（CTA連動とリンク単独の両軸）。

## 9. R2 ストレージ設計

### 9.1 オブジェクトキー命名

```
webinar/{accountId}/{eventId}/video.{ext}
webinar/{accountId}/{eventId}/thumbnail.jpg
```

### 9.2 アップロードフロー

```
1. Admin UI → POST /api/events/admin/:id/video/upload-url (mime_type, size)
2. Worker: aws4 sign で R2 用 presigned PUT URL を生成（15分有効）
3. Admin UI → PUT (presigned URL) で R2 へ直接アップロード
4. Admin UI → POST /api/events/admin/:id/video/finalize (実 size, duration)
5. Worker: events テーブル更新
```

R2 直接 PUT を使うことで Worker の CPU 時間（無料枠）を消費しない。

### 9.3 配信

```
GET /api/webinar/:bookingId/video/stream
  → bookingId から event_id 解決
  → R2.get(key, { range: req.range })
  → Range request 対応で動画 chunk を返す
```

将来的に R2 Custom Domain を使えば Worker proxy なしで配信可能だが、v1 では Worker proxy で access control 重視。

## 10. フェージング

| Phase | スコープ | 期間目安 |
|---|---|---|
| **Phase 1** | DB migration + R2アップロードAPI + LIFF視聴ページの最小版（擬似ライブ再生のみ） | 2日 |
| **Phase 2** | Admin UI: 動画アップロード + ウェビナー設定タブ | 1日 |
| **Phase 3** | CTA タイムライン + 表示制御 | 2日 |
| **Phase 4** | heartbeat + 完視聴判定 + 視聴統計ダッシュボード | 1日 |
| **Phase 5** | automations / scoring / tracked-links 連携 | 1日 |

合計約1週間。Phase 1終了時点でデモ可能。

## 11. リスク・未解決

- **R2 Worker proxy のCPU時間**: 大量同時視聴時のWorker CPU上限。試算: 1動画10MB/分、100人同時視聴 = 1GB/分の転送。Worker は 30秒/req 制限ありなので chunk size 注意
- **iOS Safari の autoplay 制限**: 初回ユーザー操作が必要。ライブ感を損なう。対策: 「視聴開始」ボタンを最初に必須表示
- **LIFF id_token の有効期限**: 30分。長時間視聴で再認証必要 → manifest 取得時に refresh 仕様要
- **R2 アップロード時の動画 duration 取得**: Admin UI で読み込んで送信させる（Worker側で再エンコード等はしない）

## 12. 未定事項

- v1 でフェイクライブチャット（コメント風表示）を入れるか → 仕様簡素化のため v2 に延期
- LINE LIFF 以外の閲覧（ブラウザ直アクセス）を許可するか → v1 は LIFF 必須

---

**変更履歴**

- 2026-05-14: 初版作成 (feature/webinar-launch)
