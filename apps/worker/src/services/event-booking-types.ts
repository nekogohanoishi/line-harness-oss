// Event booking shared types & constants.
// IDs are TEXT (UUID/nanoid) to follow line-harness schema.sql conventions.
// See: docs/superpowers/specs/2026-05-09-event-booking-design.md

export type EventBookingStatus =
  | 'requested'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'no_show'
  | 'attended';

export type CancelledBy = 'friend' | 'admin' | 'system';

export type EventReminderKind = 'day_before' | 'hours_before';

export type EventReminderStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'failed_permanent'
  | 'cancelled';

export type EventTargetType = 'single' | 'multi-account-dedup';

export const EVENT_TARGET_TYPES: ReadonlyArray<EventTargetType> = ['single', 'multi-account-dedup'];

// Webinar Launch (migration 041): `events.kind` 拡張。
//   - 'standard' (default): 既存のイベント予約フロー。
//   - 'webinar'           : 録画動画の擬似ライブ配信 + CTA + 視聴計測。
// 既存 events 行はすべて 'standard' で動作不変。
export type EventKind = 'standard' | 'webinar';

export const EVENT_KINDS: ReadonlyArray<EventKind> = ['standard', 'webinar'];

export interface EventRow {
  id: string;
  line_account_id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  folder_id: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // Multi-account fields (migration 040). broadcasts と同パターン:
  //   - target_type='single' のとき line_account_id 必須、account_ids/dedup_priority は NULL
  //   - target_type='multi-account-dedup' のとき account_ids 必須 (JSON 配列文字列)、
  //     line_account_id は account_ids[0] を sentinel として保持
  target_type: EventTargetType;
  account_ids: string | null;
  dedup_priority: string | null;
  failed_account_ids: string | null;
  // Webinar Launch (migration 041). kind='webinar' のときのみ意味を持つ。
  //   - video_r2_key: R2 オブジェクトキー (webinar/{accountId}/{eventId}/video.{ext})。
  //     finalize 前は NULL。
  //   - replay_window_minutes: 動画終了後にリプレイ視聴可能な分数 (NULL/0 = リプレイ不可)。
  //     migration default は 1440 (24h)。
  //   - attendance_threshold_seconds: 完視聴とみなす秒数 (NULL なら duration の 80%)。
  //   - archive_url: replay_window 経過後のリダイレクト先 (アーカイブ販売 LP 等)。
  kind: EventKind;
  video_r2_key: string | null;
  video_duration_seconds: number | null;
  video_mime_type: string | null;
  video_size_bytes: number | null;
  replay_window_minutes: number | null;
  attendance_threshold_seconds: number | null;
  archive_url: string | null;
  // Phase 7 (migration 043): ライブ感演出機能 (live-feel)
  //   - concurrent_floor          : 同接視聴者数の表示最低値 (fake floor)
  //   - concurrent_jitter_max     : 表示値に [0, N] のランダム加算 (自然な変動)
  //   - show_concurrent_viewers   : 同接表示の on/off (0/1, default 0)
  //   - show_fake_comments        : コメント演出の on/off (0/1, default 0)
  concurrent_floor: number;
  concurrent_jitter_max: number;
  show_concurrent_viewers: number;
  show_fake_comments: number;
}

export interface EventSlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventBookingRow {
  id: string;
  line_account_id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  status: EventBookingStatus;
  customer_note: string | null;
  internal_note: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by_staff_id: string | null;
  cancelled_at: string | null;
  cancelled_by: CancelledBy | null;
  created_at: string;
  updated_at: string;
  // Webinar Launch (migration 041). kind='webinar' イベントの視聴トラッキング。
  //   - webinar_first_opened_at        : LIFF 視聴ページに初めて到達した UTC ISO8601
  //   - webinar_video_started_at       : 動画 play() 発火時刻 (UTC ISO8601)
  //   - webinar_max_position_seconds   : 視聴到達秒の最大値 (heartbeat ごとに MAX で更新)
  //   - webinar_completed_at           : 完視聴判定到達時刻 (UTC ISO8601, 一度書いたら no-op)
  //   - webinar_last_heartbeat_at      : 最新 heartbeat 到達時刻 (UTC ISO8601)
  //   - webinar_abandoned_at           : heartbeat 途絶による離脱検知時刻 (UTC ISO8601)
  webinar_first_opened_at: string | null;
  webinar_video_started_at: string | null;
  webinar_max_position_seconds: number;
  webinar_completed_at: string | null;
  webinar_last_heartbeat_at: string | null;
  webinar_abandoned_at: string | null;
}

export interface EventBookingReminderRow {
  id: string;
  booking_id: string;
  kind: EventReminderKind;
  scheduled_at: string;
  sent_at: string | null;
  status: EventReminderStatus;
  retry_count: number;
  last_error: string | null;
}

export const EVENT_NAME_MAX = 255;
export const EVENT_DESCRIPTION_MAX = 20000;
export const CUSTOMER_NOTE_MAX = 5000;
export const REQUESTED_EXPIRE_HOURS = 24;
export const REMINDER_MAX_RETRY = 3;
export const EVENT_IDEMPOTENCY_TTL_MINUTES = 60 * 24;

export const ACTIVE_BOOKING_STATUSES: ReadonlyArray<EventBookingStatus> = [
  'requested',
  'confirmed',
];

// ===========================================================
// Webinar Launch (migration 041)
// ===========================================================

export type WebinarCtaDisplayMode = 'banner' | 'modal' | 'sticky';
export const WEBINAR_CTA_DISPLAY_MODES: ReadonlyArray<WebinarCtaDisplayMode> = [
  'banner',
  'modal',
  'sticky',
];

export type WebinarCtaActionType = 'url' | 'tag' | 'tracked_link' | 'close';
export const WEBINAR_CTA_ACTION_TYPES: ReadonlyArray<WebinarCtaActionType> = [
  'url',
  'tag',
  'tracked_link',
  'close',
];

export interface WebinarCtaItemRow {
  id: string;
  event_id: string;
  at_seconds: number;
  display_mode: WebinarCtaDisplayMode;
  label: string;
  action_type: WebinarCtaActionType;
  action_value: string | null;
  dismiss_after_seconds: number | null;
  sort_order: number;
  is_active: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebinarHeartbeatRow {
  id: string;
  booking_id: string;
  position_seconds: number;
  occurred_at: string;
  user_agent: string | null;
}

export interface WebinarCtaClickRow {
  id: string;
  booking_id: string;
  cta_item_id: string;
  position_seconds: number;
  clicked_at: string;
}

// 設計書 §6.1 の WebinarState のサーバー側起点。
// /api/webinar/:bookingId/manifest が返す server 時刻 + slot.starts_at +
// video.duration_seconds から client が状態を計算する。
export const WEBINAR_HEARTBEAT_INTERVAL_SECONDS = 30;
export const WEBINAR_DEFAULT_ATTENDANCE_RATIO = 0.8;
export const WEBINAR_UPLOAD_URL_TTL_SECONDS = 15 * 60;

// ===========================================================
// Phase 7 (migration 043): ライブ感演出
// ===========================================================
// 「直近 N 秒以内に heartbeat があった bookings 数」をアクティブ視聴者と
// みなす。heartbeat は 30 秒間隔なので 2 分余裕を取れば取りこぼしが少ない。
export const WEBINAR_ACTIVE_VIEWER_WINDOW_SECONDS = 120;
// LIFF client が同接数を polling する間隔。Worker CPU を消費するので 30 秒固定。
export const WEBINAR_CONCURRENT_POLL_INTERVAL_SECONDS = 30;

export const WEBINAR_FAKE_COMMENT_AUTHOR_MAX = 30;
export const WEBINAR_FAKE_COMMENT_BODY_MAX = 200;
export const WEBINAR_FAKE_COMMENT_BULK_MAX = 200;
// heartbeat は 30 秒間隔。10 分途絶えたら「一度離脱した」と扱う。
export const WEBINAR_ABANDONED_AFTER_SECONDS = 10 * 60;

export interface WebinarFakeCommentRow {
  id: string;
  event_id: string;
  at_seconds: number;
  author_name: string;
  body: string;
  author_color: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
