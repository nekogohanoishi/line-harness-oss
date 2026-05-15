// webinar.ts のスモークテスト。
// 既存 events.test.ts の memDB パターンを継承するが、webinar 用に絞った最小限の
// テーブル (events / event_bookings / friends / line_accounts / event_slots /
// webinar_cta_items / webinar_heartbeats / webinar_cta_clicks) を持つ。
//
// カバレッジ:
//   - Admin CTA CRUD (create / list / update / soft-delete)
//   - LIFF heartbeat happy-path: positionSeconds 反映 + max 更新 + 行追加
//   - LIFF unauthorized / forbidden
//   - LIFF cta-click 記録
//   - LIFF completed の冪等性

import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const liffAuthMocks = {
  verifyCallerLineUserId: vi.fn(),
};
vi.mock('../services/liff-auth.js', () => liffAuthMocks);

const eventBusMocks = {
  fireEvent: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../services/event-bus.js', () => eventBusMocks);

const { default: webinar } = await import('./webinar.js');

type TestEnv = {
  Bindings: { DB: D1Database; IMAGES: R2Bucket; LINE_CHANNEL_SECRET: string; WORKER_URL: string };
};

interface EventRow {
  id: string;
  line_account_id: string;
  name: string;
  kind: string;
  video_r2_key: string | null;
  video_duration_seconds: number | null;
  video_mime_type: string | null;
  video_size_bytes: number | null;
  replay_window_minutes: number | null;
  attendance_threshold_seconds: number | null;
  archive_url: string | null;
  is_published: number;
  deleted_at: string | null;
  target_type: 'single' | 'multi-account-dedup';
  account_ids: string | null;
  image_url: string | null;
  description: string | null;
  [k: string]: unknown;
}

interface SlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
}

interface BookingRow {
  id: string;
  line_account_id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  webinar_first_opened_at: string | null;
  webinar_video_started_at: string | null;
  webinar_max_position_seconds: number;
  webinar_completed_at: string | null;
  webinar_last_heartbeat_at: string | null;
  [k: string]: unknown;
}

interface FriendRow {
  id: string;
  line_account_id: string;
  line_user_id: string;
}

interface CtaRow {
  id: string;
  event_id: string;
  at_seconds: number;
  display_mode: string;
  label: string;
  action_type: string;
  action_value: string | null;
  dismiss_after_seconds: number | null;
  sort_order: number;
  is_active: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

interface HeartbeatRow {
  id: string;
  booking_id: string;
  position_seconds: number;
  occurred_at: string;
  user_agent: string | null;
}

interface CtaClickRow {
  id: string;
  booking_id: string;
  cta_item_id: string;
  position_seconds: number;
  clicked_at: string;
}

// Phase 6a: event_slot_recurrence
interface RecurrenceRow {
  id: string;
  event_id: string;
  pattern_type: 'daily' | 'weekly';
  weekdays_json: string | null;
  times_json: string;
  duration_minutes: number;
  capacity: number | null;
  generate_days_ahead: number;
  timezone: string;
  is_active: number;
  last_generated_through: string | null;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

// Phase 6b: event_cart_status
interface CartStatusRow {
  id: string;
  event_id: string;
  booking_id: string;
  friend_id: string;
  opened_at: string | null;
  closes_at: string | null;
  purchased_at: string | null;
  created_at: string;
  updated_at: string;
  [k: string]: unknown;
}

interface State {
  events: EventRow[];
  slots: SlotRow[];
  bookings: BookingRow[];
  friends: FriendRow[];
  ctas: CtaRow[];
  heartbeats: HeartbeatRow[];
  ctaClicks: CtaClickRow[];
  recurrences: RecurrenceRow[];
  cartStatuses: CartStatusRow[];
}

function emptyState(): State {
  return {
    events: [],
    slots: [],
    bookings: [],
    friends: [],
    ctas: [],
    heartbeats: [],
    ctaClicks: [],
    recurrences: [],
    cartStatuses: [],
  };
}

function eventMatchesAccount(e: EventRow, account: string): boolean {
  if (e.target_type === 'multi-account-dedup') {
    const ids = e.account_ids
      ? (() => {
          try {
            return JSON.parse(e.account_ids) as string[];
          } catch {
            return [];
          }
        })()
      : [];
    return ids.includes(account);
  }
  return e.line_account_id === account;
}

function makeDb(state: State): D1Database {
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          // ownsEvent
          if (sql.includes('SELECT id FROM events') && sql.includes('json_each(account_ids)')) {
            const [id, account] = bound as [string, string];
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && eventMatchesAccount(x, account),
            );
            return (e ? { id: e.id } : null) as T | null;
          }
          // SELECT * FROM events WHERE id = ? AND deleted_at IS NULL  (fetchEvent)
          if (sql.includes('SELECT * FROM events') && sql.includes('deleted_at IS NULL') && !sql.includes('is_published')) {
            const [id] = bound as [string];
            const e = state.events.find((x) => x.id === id && x.deleted_at == null);
            return (e ?? null) as T | null;
          }
          if (sql.startsWith('SELECT * FROM events')) {
            const [id] = bound as [string];
            const e = state.events.find((x) => x.id === id);
            return (e ?? null) as T | null;
          }
          // loadBookingForLiff: big JOIN
          if (sql.includes('FROM event_bookings b') && sql.includes('JOIN friends f') && sql.includes('JOIN events e') && sql.includes('JOIN event_slots s')) {
            const [bookingId] = bound as [string];
            const b = state.bookings.find((x) => x.id === bookingId);
            if (!b) return null as T | null;
            const f = state.friends.find((x) => x.id === b.friend_id);
            const e = state.events.find((x) => x.id === b.event_id);
            const s = state.slots.find((x) => x.id === b.slot_id);
            if (!f || !e || !s) return null as T | null;
            return {
              booking_id: b.id,
              event_id: b.event_id,
              slot_id: b.slot_id,
              friend_id: b.friend_id,
              account_id: b.line_account_id,
              webinar_first_opened_at: b.webinar_first_opened_at,
              webinar_video_started_at: b.webinar_video_started_at,
              webinar_max_position_seconds: b.webinar_max_position_seconds,
              webinar_completed_at: b.webinar_completed_at,
              webinar_last_heartbeat_at: b.webinar_last_heartbeat_at,
              line_user_id: f.line_user_id,
              kind: e.kind,
              name: e.name,
              video_r2_key: e.video_r2_key,
              video_duration_seconds: e.video_duration_seconds,
              video_mime_type: e.video_mime_type,
              video_size_bytes: e.video_size_bytes,
              replay_window_minutes: e.replay_window_minutes,
              attendance_threshold_seconds: e.attendance_threshold_seconds,
              archive_url: e.archive_url,
              image_url: e.image_url,
              description: e.description,
              cart_relative_close_minutes: (e as Record<string, unknown>).cart_relative_close_minutes ?? null,
              cart_expired_redirect_url: (e as Record<string, unknown>).cart_expired_redirect_url ?? null,
              slot_starts_at: s.starts_at,
              slot_ends_at: s.ends_at,
            } as T;
          }
          // Phase 6b: SELECT id, opened_at, closes_at FROM event_cart_status WHERE booking_id = ?
          // または SELECT closes_at, purchased_at FROM event_cart_status WHERE booking_id = ?
          if (sql.includes('FROM event_cart_status') && sql.includes('WHERE booking_id = ?')) {
            const [bookingId] = bound as [string];
            const cs = state.cartStatuses.find((x) => x.booking_id === bookingId);
            if (!cs) return null as T | null;
            return {
              id: cs.id,
              opened_at: cs.opened_at,
              closes_at: cs.closes_at,
              purchased_at: cs.purchased_at,
            } as T;
          }
          // Phase 6a: SELECT id FROM event_slot_recurrence WHERE id = ? AND event_id = ?
          if (sql.includes('FROM event_slot_recurrence') && sql.includes('WHERE id = ?')) {
            const [recId, eventId] = bound as [string, string?];
            const r = state.recurrences.find(
              (x) => x.id === recId && (eventId == null || x.event_id === eventId),
            );
            return (r ? { id: r.id, ...r } : null) as T | null;
          }
          // SELECT id [, action_type, action_value] FROM webinar_cta_items
          //   WHERE id = ? AND event_id = ? AND deleted_at IS NULL
          // (Phase 6b: cta-click ハンドラが action_type/action_value も SELECT する)
          if (
            sql.startsWith('SELECT id') &&
            sql.includes('FROM webinar_cta_items') &&
            sql.includes('event_id = ?') &&
            sql.includes('deleted_at IS NULL')
          ) {
            const [id, event_id] = bound as [string, string];
            const cta = state.ctas.find(
              (c) => c.id === id && c.event_id === event_id && c.deleted_at == null,
            );
            if (!cta) return null as T | null;
            return {
              id: cta.id,
              action_type: cta.action_type,
              action_value: cta.action_value,
            } as T;
          }
          // SELECT * FROM webinar_cta_items WHERE id = ?
          if (sql.includes('SELECT * FROM webinar_cta_items') && sql.includes('WHERE id = ?')) {
            const [id] = bound as [string];
            const cta = state.ctas.find((c) => c.id === id);
            return (cta ?? null) as T | null;
          }
          // stats aggregate (event_bookings)
          if (sql.includes('AVG(webinar_max_position_seconds)')) {
            const [event_id] = bound as [string];
            const items = state.bookings.filter((b) => b.event_id === event_id);
            const opened = items.filter((b) => b.webinar_first_opened_at != null).length;
            const started = items.filter((b) => b.webinar_video_started_at != null).length;
            const completed = items.filter((b) => b.webinar_completed_at != null).length;
            const avg =
              items.length === 0
                ? 0
                : items.reduce((acc, b) => acc + b.webinar_max_position_seconds, 0) / items.length;
            return {
              total_bookings: items.length,
              opened,
              started,
              completed,
              avg_position: avg,
            } as T;
          }
          // stats: events row for duration/threshold
          if (sql.includes('video_duration_seconds') && sql.includes('attendance_threshold_seconds') && sql.startsWith('SELECT')) {
            const [id] = bound as [string];
            const e = state.events.find((x) => x.id === id);
            return (e
              ? {
                  video_duration_seconds: e.video_duration_seconds,
                  attendance_threshold_seconds: e.attendance_threshold_seconds,
                }
              : null) as T | null;
          }
          return null;
        },
        async all<T>() {
          // CTA list (admin)
          if (sql.includes('FROM webinar_cta_items') && sql.includes('event_id = ?') && sql.includes('deleted_at IS NULL') && !sql.includes('is_active')) {
            const [event_id] = bound as [string];
            const items = state.ctas
              .filter((c) => c.event_id === event_id && c.deleted_at == null)
              .sort((a, b) =>
                a.at_seconds !== b.at_seconds ? a.at_seconds - b.at_seconds : a.sort_order - b.sort_order,
              );
            return { results: items as unknown as T[] };
          }
          // CTA list (LIFF manifest, is_active = 1)
          if (sql.includes('FROM webinar_cta_items') && sql.includes('is_active = 1')) {
            const [event_id] = bound as [string];
            const items = state.ctas
              .filter((c) => c.event_id === event_id && c.deleted_at == null && c.is_active === 1)
              .sort((a, b) =>
                a.at_seconds !== b.at_seconds ? a.at_seconds - b.at_seconds : a.sort_order - b.sort_order,
              );
            return { results: items as unknown as T[] };
          }
          // Phase 6a: recurrence list (admin)
          if (sql.includes('FROM event_slot_recurrence') && sql.includes('event_id = ?')) {
            const [event_id] = bound as [string];
            const items = state.recurrences
              .filter((r) => r.event_id === event_id)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            return { results: items as unknown as T[] };
          }
          // stats: cta aggregation
          if (sql.includes('FROM webinar_cta_items ci')) {
            const [event_id] = bound as [string];
            const items = state.ctas
              .filter((c) => c.event_id === event_id && c.deleted_at == null)
              .map((c) => {
                const clicks = state.ctaClicks.filter((x) => x.cta_item_id === c.id);
                const unique = new Set(clicks.map((x) => x.booking_id)).size;
                return {
                  cta_id: c.id,
                  label: c.label,
                  at_seconds: c.at_seconds,
                  click_unique_count: unique,
                  click_total_count: clicks.length,
                };
              })
              .sort((a, b) => a.at_seconds - b.at_seconds);
            return { results: items as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (sql.startsWith('INSERT INTO webinar_cta_items')) {
            const [
              id, event_id, at_seconds, display_mode, label, action_type,
              action_value, dismiss_after_seconds, sort_order, is_active,
            ] = bound as [string, string, number, string, string, string, string | null, number | null, number, number];
            const now = new Date().toISOString();
            state.ctas.push({
              id, event_id, at_seconds, display_mode, label, action_type,
              action_value, dismiss_after_seconds, sort_order, is_active,
              deleted_at: null,
              created_at: now,
              updated_at: now,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE webinar_cta_items') && sql.includes('deleted_at = ?')) {
            // soft delete
            const [deleted_at, updated_at, id, event_id] = bound as [string, string, string, string];
            const c = state.ctas.find(
              (x) => x.id === id && x.event_id === event_id && x.deleted_at == null,
            );
            if (!c) return { success: true, meta: { changes: 0 } };
            c.deleted_at = deleted_at;
            c.updated_at = updated_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE webinar_cta_items SET')) {
            // generic update — bind ends with id
            const id = bound[bound.length - 1] as string;
            const c = state.ctas.find((x) => x.id === id);
            if (!c) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE webinar_cta_items SET '.length, sql.indexOf(' WHERE'));
            const cols = setPart.split(',').map((s) => s.trim());
            let valIdx = 0;
            for (const col of cols) {
              const m = /^(\w+)\s*=\s*(\?|strftime)/.exec(col);
              if (!m) continue;
              const colName = m[1];
              if (m[2] === '?') {
                (c as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              } else {
                c.updated_at = new Date().toISOString();
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          // Phase 6b: event_cart_status INSERT/UPDATE
          if (sql.startsWith('INSERT INTO event_cart_status')) {
            const [id, event_id, booking_id, friend_id, opened_at, closes_at] = bound as [
              string, string, string, string, string, string,
            ];
            // UNIQUE(booking_id) チェック
            if (state.cartStatuses.some((x) => x.booking_id === booking_id)) {
              throw new Error('UNIQUE constraint failed: event_cart_status.booking_id');
            }
            const now = new Date().toISOString();
            state.cartStatuses.push({
              id, event_id, booking_id, friend_id, opened_at, closes_at,
              purchased_at: null,
              created_at: now,
              updated_at: now,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_cart_status')) {
            const id = bound[bound.length - 1] as string;
            const cs = state.cartStatuses.find((x) => x.id === id);
            if (!cs) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE event_cart_status'.length).match(/SET\s+([\s\S]*?)\s+WHERE/i);
            if (!setPart) return { success: true, meta: { changes: 0 } };
            const cols = setPart[1].split(',').map((s) => s.trim());
            let valIdx = 0;
            for (const col of cols) {
              const match = /^(\w+)\s*=\s*\?/.exec(col);
              if (!match) continue;
              (cs as Record<string, unknown>)[match[1]] = bound[valIdx];
              valIdx++;
            }
            return { success: true, meta: { changes: 1 } };
          }
          // Phase 6a: event_slot_recurrence INSERT/UPDATE/DELETE
          if (sql.startsWith('INSERT INTO event_slot_recurrence')) {
            const [id, event_id, pattern_type, weekdays_json, times_json,
                   duration_minutes, capacity, generate_days_ahead, timezone, is_active] = bound as [
              string, string, 'daily' | 'weekly', string | null, string,
              number, number | null, number, string, number,
            ];
            const now = new Date().toISOString();
            state.recurrences.push({
              id, event_id, pattern_type, weekdays_json, times_json,
              duration_minutes, capacity, generate_days_ahead, timezone, is_active,
              last_generated_through: null,
              created_at: now,
              updated_at: now,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_slot_recurrence')) {
            const id = bound[bound.length - 1] as string;
            const r = state.recurrences.find((x) => x.id === id);
            if (!r) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE event_slot_recurrence'.length).match(/SET\s+([\s\S]*?)\s+WHERE/i);
            if (!setPart) return { success: true, meta: { changes: 0 } };
            const cols = setPart[1].split(',').map((s) => s.trim());
            let valIdx = 0;
            for (const col of cols) {
              const match = /^(\w+)\s*=\s*\?/.exec(col);
              if (!match) continue;
              (r as Record<string, unknown>)[match[1]] = bound[valIdx];
              valIdx++;
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE FROM event_slot_recurrence')) {
            const [recId, eventId] = bound as [string, string];
            const idx = state.recurrences.findIndex(
              (x) => x.id === recId && x.event_id === eventId,
            );
            if (idx === -1) return { success: true, meta: { changes: 0 } };
            state.recurrences.splice(idx, 1);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO webinar_heartbeats')) {
            const [id, booking_id, position_seconds, occurred_at, user_agent] = bound as [
              string, string, number, string, string | null,
            ];
            state.heartbeats.push({ id, booking_id, position_seconds, occurred_at, user_agent });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO webinar_cta_clicks')) {
            const [id, booking_id, cta_item_id, position_seconds, clicked_at] = bound as [
              string, string, string, number, string,
            ];
            state.ctaClicks.push({ id, booking_id, cta_item_id, position_seconds, clicked_at });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings')) {
            // パースして webinar_* 列を更新
            const id = bound[bound.length - 1] as string;
            const b = state.bookings.find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE event_bookings'.length).match(/SET\s+([\s\S]*?)\s+WHERE/i);
            if (!setPart) return { success: true, meta: { changes: 0 } };
            const cols = setPart[1].split(',').map((s) => s.trim());
            let valIdx = 0;
            for (const col of cols) {
              const match = /^(\w+)\s*=\s*(.+)$/.exec(col);
              if (!match) continue;
              const colName = match[1];
              const expr = match[2];
              if (expr === '?') {
                (b as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              } else if (expr.startsWith('COALESCE(')) {
                // COALESCE(col, ?) — set only if currently null
                const cur = (b as Record<string, unknown>)[colName];
                if (cur == null) (b as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              } else if (expr.startsWith('MAX(')) {
                // MAX(col, ?)
                const cur = ((b as Record<string, unknown>)[colName] as number | null) ?? 0;
                const v = bound[valIdx] as number;
                (b as Record<string, unknown>)[colName] = Math.max(cur, v);
                valIdx++;
              } else if (expr.startsWith('strftime')) {
                b.webinar_last_heartbeat_at = new Date().toISOString();
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE events')) {
            const id = bound[bound.length - 1] as string;
            const e = state.events.find((x) => x.id === id);
            if (!e) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE events'.length).match(/SET\s+([\s\S]*?)\s+WHERE/i);
            if (!setPart) return { success: true, meta: { changes: 0 } };
            const cols = setPart[1].split(',').map((s) => s.trim());
            let valIdx = 0;
            for (const col of cols) {
              const match = /^(\w+)\s*=\s*(.+)$/.exec(col);
              if (!match) continue;
              const colName = match[1];
              const expr = match[2];
              if (expr === '?') {
                (e as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              } else if (expr === 'NULL') {
                (e as Record<string, unknown>)[colName] = null;
              } else if (expr === "'webinar'") {
                e.kind = 'webinar';
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

function makeR2Stub(initialObjects: Record<string, { size: number; contentType: string }> = {}): R2Bucket {
  const objects = new Map<string, { size: number; contentType: string }>(Object.entries(initialObjects));
  return {
    async head(key: string) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        key,
        size: obj.size,
        httpMetadata: { contentType: obj.contentType },
        etag: 'etag',
        uploaded: new Date(),
      } as unknown as R2Object;
    },
    async get(key: string) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        key,
        size: obj.size,
        httpMetadata: { contentType: obj.contentType },
        body: new ReadableStream(),
      } as unknown as R2ObjectBody;
    },
    async put(key: string, _body: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { size: 100, contentType: opts?.httpMetadata?.contentType ?? 'video/mp4' });
      return { key } as unknown as R2Object;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  } as unknown as R2Bucket;
}

function setupApp(state: State, r2?: R2Bucket) {
  const app = new Hono<TestEnv>();
  const db = makeDb(state);
  app.use('*', async (c, next) => {
    c.env = {
      DB: db,
      IMAGES: r2 ?? makeR2Stub(),
      LINE_CHANNEL_SECRET: 'test-secret',
      WORKER_URL: 'https://example.test',
    } as TestEnv['Bindings'];
    await next();
  });
  app.route('/', webinar);
  return app;
}

function makeWebinarEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 'ev1',
    line_account_id: 'la1',
    name: 'Test webinar',
    kind: 'webinar',
    video_r2_key: 'webinar/la1/ev1/video.mp4',
    video_duration_seconds: 600,
    video_mime_type: 'video/mp4',
    video_size_bytes: 1024,
    replay_window_minutes: 1440,
    attendance_threshold_seconds: null,
    archive_url: null,
    is_published: 1,
    deleted_at: null,
    target_type: 'single',
    account_ids: null,
    image_url: null,
    description: null,
    ...overrides,
  };
}

beforeEach(() => {
  liffAuthMocks.verifyCallerLineUserId.mockReset();
  liffAuthMocks.verifyCallerLineUserId.mockResolvedValue(null);
  eventBusMocks.fireEvent.mockClear();
  eventBusMocks.fireEvent.mockResolvedValue(undefined);
});

describe('Admin CTA CRUD', () => {
  test('create CTA returns 201 and persists row', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/cta?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        at_seconds: 120,
        display_mode: 'modal',
        label: '今すぐ申し込む',
        action_type: 'url',
        action_value: 'https://example.com/lp',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CtaRow;
    expect(body.event_id).toBe('ev1');
    expect(body.at_seconds).toBe(120);
    expect(state.ctas).toHaveLength(1);
  });

  test('create CTA rejects invalid display_mode', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/cta?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        at_seconds: 10,
        display_mode: 'popup', // invalid
        label: 'x',
        action_type: 'url',
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_display_mode');
  });

  test('list CTA returns inserted rows sorted by at_seconds', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const now = new Date().toISOString();
    state.ctas.push(
      {
        id: 'c2', event_id: 'ev1', at_seconds: 300, display_mode: 'banner',
        label: 'B', action_type: 'url', action_value: null,
        dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
        created_at: now, updated_at: now,
      },
      {
        id: 'c1', event_id: 'ev1', at_seconds: 60, display_mode: 'modal',
        label: 'A', action_type: 'url', action_value: null,
        dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
        created_at: now, updated_at: now,
      },
    );
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/cta?account_id=la1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: CtaRow[] };
    expect(body.items.map((x) => x.id)).toEqual(['c1', 'c2']);
  });

  test('update CTA changes the label', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c1', event_id: 'ev1', at_seconds: 60, display_mode: 'modal',
      label: 'A', action_type: 'url', action_value: null,
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/cta/c1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '新ラベル' }),
    });
    expect(res.status).toBe(200);
    expect(state.ctas[0].label).toBe('新ラベル');
  });

  test('delete CTA soft-deletes row', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c1', event_id: 'ev1', at_seconds: 60, display_mode: 'modal',
      label: 'A', action_type: 'url', action_value: null,
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/cta/c1?account_id=la1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect(state.ctas[0].deleted_at).not.toBeNull();
  });

  test('admin endpoints reject missing account_id', async () => {
    const app = setupApp(emptyState());
    const res = await app.request('/api/events/admin/events/ev1/cta', { method: 'GET' });
    expect(res.status).toBe(400);
  });

  test('admin endpoints reject wrong account', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/cta?account_id=otherAccount');
    expect(res.status).toBe(404);
  });
});

describe('LIFF heartbeat', () => {
  function seedBooking(state: State, overrides: Partial<BookingRow> = {}): BookingRow {
    state.friends.push({ id: 'f1', line_account_id: 'la1', line_user_id: 'U_user_1' });
    const slotStartsAt = new Date(Date.now() - 60_000).toISOString(); // ライブ中
    state.slots.push({ id: 'sl1', event_id: 'ev1', starts_at: slotStartsAt, ends_at: new Date(Date.now() + 600_000).toISOString() });
    state.events.push(makeWebinarEvent());
    const booking: BookingRow = {
      id: 'b1', line_account_id: 'la1', event_id: 'ev1', slot_id: 'sl1', friend_id: 'f1',
      webinar_first_opened_at: null, webinar_video_started_at: null,
      webinar_max_position_seconds: 0, webinar_completed_at: null,
      webinar_last_heartbeat_at: null,
      ...overrides,
    };
    state.bookings.push(booking);
    return booking;
  }

  test('returns 401 when authorization missing/invalid', async () => {
    const state = emptyState();
    seedBooking(state);
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValueOnce(null);
    const res = await app.request('/api/liff/webinar/b1/event/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ positionSeconds: 30 }),
    });
    expect(res.status).toBe(401);
  });

  test('returns 403 when caller line_user_id mismatches booking friend', async () => {
    const state = emptyState();
    seedBooking(state);
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValueOnce('U_other_user');
    const res = await app.request('/api/liff/webinar/b1/event/heartbeat', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ positionSeconds: 30 }),
    });
    expect(res.status).toBe(403);
  });

  test('happy path: inserts heartbeat row and updates max_position', async () => {
    const state = emptyState();
    seedBooking(state, { webinar_max_position_seconds: 30 });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    const res1 = await app.request('/api/liff/webinar/b1/event/heartbeat', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ positionSeconds: 90 }),
    });
    expect(res1.status).toBe(200);
    expect(state.heartbeats).toHaveLength(1);
    expect(state.heartbeats[0].position_seconds).toBe(90);
    expect(state.bookings[0].webinar_max_position_seconds).toBe(90);

    // 2回目: 古い位置でも max は伸びない
    const res2 = await app.request('/api/liff/webinar/b1/event/heartbeat', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ positionSeconds: 50 }),
    });
    expect(res2.status).toBe(200);
    expect(state.heartbeats).toHaveLength(2);
    expect(state.bookings[0].webinar_max_position_seconds).toBe(90);
  });

  test('rejects negative position', async () => {
    const state = emptyState();
    seedBooking(state);
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');
    const res = await app.request('/api/liff/webinar/b1/event/heartbeat', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ positionSeconds: -1 }),
    });
    expect(res.status).toBe(422);
  });
});

describe('LIFF cta-click', () => {
  test('records click with position', async () => {
    const state = emptyState();
    state.friends.push({ id: 'f1', line_account_id: 'la1', line_user_id: 'U_user_1' });
    state.slots.push({
      id: 'sl1', event_id: 'ev1',
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 600_000).toISOString(),
    });
    state.events.push(makeWebinarEvent());
    state.bookings.push({
      id: 'b1', line_account_id: 'la1', event_id: 'ev1', slot_id: 'sl1', friend_id: 'f1',
      webinar_first_opened_at: null, webinar_video_started_at: null,
      webinar_max_position_seconds: 0, webinar_completed_at: null,
      webinar_last_heartbeat_at: null,
    });
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c1', event_id: 'ev1', at_seconds: 30, display_mode: 'modal',
      label: 'A', action_type: 'url', action_value: 'https://example.com',
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');
    const res = await app.request('/api/liff/webinar/b1/event/cta-click', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ ctaItemId: 'c1', positionSeconds: 45 }),
    });
    expect(res.status).toBe(200);
    expect(state.ctaClicks).toHaveLength(1);
    expect(state.ctaClicks[0].cta_item_id).toBe('c1');
    expect(state.ctaClicks[0].position_seconds).toBe(45);
  });

  test('rejects CTA from a different event', async () => {
    const state = emptyState();
    state.friends.push({ id: 'f1', line_account_id: 'la1', line_user_id: 'U_user_1' });
    state.slots.push({
      id: 'sl1', event_id: 'ev1',
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 600_000).toISOString(),
    });
    state.events.push(makeWebinarEvent());
    state.bookings.push({
      id: 'b1', line_account_id: 'la1', event_id: 'ev1', slot_id: 'sl1', friend_id: 'f1',
      webinar_first_opened_at: null, webinar_video_started_at: null,
      webinar_max_position_seconds: 0, webinar_completed_at: null,
      webinar_last_heartbeat_at: null,
    });
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c-other', event_id: 'ev-other', at_seconds: 30, display_mode: 'modal',
      label: 'X', action_type: 'url', action_value: null,
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');
    const res = await app.request('/api/liff/webinar/b1/event/cta-click', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ ctaItemId: 'c-other', positionSeconds: 45 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('LIFF completed idempotency', () => {
  test('sets webinar_completed_at once and is no-op on second call', async () => {
    const state = emptyState();
    state.friends.push({ id: 'f1', line_account_id: 'la1', line_user_id: 'U_user_1' });
    state.slots.push({
      id: 'sl1', event_id: 'ev1',
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 600_000).toISOString(),
    });
    state.events.push(makeWebinarEvent());
    state.bookings.push({
      id: 'b1', line_account_id: 'la1', event_id: 'ev1', slot_id: 'sl1', friend_id: 'f1',
      webinar_first_opened_at: null, webinar_video_started_at: null,
      webinar_max_position_seconds: 0, webinar_completed_at: null,
      webinar_last_heartbeat_at: null,
    });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    const res1 = await app.request('/api/liff/webinar/b1/event/completed', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(res1.status).toBe(200);
    const first = state.bookings[0].webinar_completed_at;
    expect(first).not.toBeNull();

    // 2nd call should NOT overwrite (COALESCE in SQL)
    await new Promise((r) => setTimeout(r, 5));
    const res2 = await app.request('/api/liff/webinar/b1/event/completed', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(res2.status).toBe(200);
    expect(state.bookings[0].webinar_completed_at).toBe(first);
  });
});

// ------------------------------------------------------------
// Phase 5: automations 連携 — fireEvent が正しい event type / eventData
// で、かつ冪等に呼ばれることを確認する。
// ------------------------------------------------------------
describe('Phase 5: webinar_* automations event firing', () => {
  function seedLiveBooking(state: State): BookingRow {
    state.friends.push({ id: 'f1', line_account_id: 'la1', line_user_id: 'U_user_1' });
    state.slots.push({
      id: 'sl1', event_id: 'ev1',
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 600_000).toISOString(),
    });
    state.events.push(makeWebinarEvent());
    const booking: BookingRow = {
      id: 'b1', line_account_id: 'la1', event_id: 'ev1', slot_id: 'sl1', friend_id: 'f1',
      webinar_first_opened_at: null, webinar_video_started_at: null,
      webinar_max_position_seconds: 0, webinar_completed_at: null,
      webinar_last_heartbeat_at: null,
    };
    state.bookings.push(booking);
    return booking;
  }

  test('opened: fires webinar_opened on first call, no-op on second', async () => {
    const state = emptyState();
    seedLiveBooking(state);
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    const res1 = await app.request('/api/liff/webinar/b1/event/opened', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(res1.status).toBe(200);
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
    const [, eventType, payload] = eventBusMocks.fireEvent.mock.calls[0];
    expect(eventType).toBe('webinar_opened');
    expect(payload.friendId).toBe('f1');
    expect(payload.eventData).toMatchObject({ eventId: 'ev1', bookingId: 'b1' });

    // 2回目は no-op
    const res2 = await app.request('/api/liff/webinar/b1/event/opened', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(res2.status).toBe(200);
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
  });

  test('started: fires webinar_started once across multiple calls', async () => {
    const state = emptyState();
    seedLiveBooking(state);
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    await app.request('/api/liff/webinar/b1/event/started', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    await app.request('/api/liff/webinar/b1/event/started', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    await app.request('/api/liff/webinar/b1/event/started', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });

    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(eventBusMocks.fireEvent.mock.calls[0][1]).toBe('webinar_started');
  });

  test('completed: fires webinar_completed once', async () => {
    const state = emptyState();
    seedLiveBooking(state);
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    await app.request('/api/liff/webinar/b1/event/completed', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(eventBusMocks.fireEvent.mock.calls[0][1]).toBe('webinar_completed');
    expect(eventBusMocks.fireEvent.mock.calls[0][2].eventData).toMatchObject({
      eventId: 'ev1',
      bookingId: 'b1',
    });

    await app.request('/api/liff/webinar/b1/event/completed', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
  });

  test('cta-click: fires webinar_cta_clicked with ctaItemId in eventData', async () => {
    const state = emptyState();
    seedLiveBooking(state);
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c1', event_id: 'ev1', at_seconds: 30, display_mode: 'modal',
      label: 'A', action_type: 'url', action_value: 'https://example.com',
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    const res = await app.request('/api/liff/webinar/b1/event/cta-click', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ ctaItemId: 'c1', positionSeconds: 45 }),
    });
    expect(res.status).toBe(200);
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
    const [, eventType, payload] = eventBusMocks.fireEvent.mock.calls[0];
    expect(eventType).toBe('webinar_cta_clicked');
    expect(payload.friendId).toBe('f1');
    expect(payload.eventData).toMatchObject({
      eventId: 'ev1',
      bookingId: 'b1',
      ctaItemId: 'c1',
      positionSeconds: 45,
    });
  });

  test('cta-click: fires every time (not idempotent)', async () => {
    const state = emptyState();
    seedLiveBooking(state);
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c1', event_id: 'ev1', at_seconds: 30, display_mode: 'modal',
      label: 'A', action_type: 'url', action_value: 'https://example.com',
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    for (let i = 0; i < 3; i++) {
      await app.request('/api/liff/webinar/b1/event/cta-click', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ ctaItemId: 'c1', positionSeconds: 45 + i }),
      });
    }
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(3);
  });
});

// ============================================================
// Phase 6a: event_slot_recurrence CRUD HTTP routes
// ============================================================
describe('Phase 6a: recurrence CRUD', () => {
  test('POST /recurrence creates rule with normalized times_json', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/recurrence?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pattern_type: 'daily',
        times: ['10:00', '20:00'],
        duration_minutes: 60,
        capacity: 50,
        generate_days_ahead: 7,
      }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as RecurrenceRow;
    expect(row.event_id).toBe('ev1');
    expect(JSON.parse(row.times_json)).toEqual(['10:00', '20:00']);
    expect(state.recurrences).toHaveLength(1);
  });

  test('POST /recurrence rejects invalid time format', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/ev1/recurrence?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pattern_type: 'daily',
        times: ['25:99'],
        duration_minutes: 60,
      }),
    });
    expect(res.status).toBe(422);
  });

  test('GET /recurrence lists rules; DELETE removes one', async () => {
    const state = emptyState();
    state.events.push(makeWebinarEvent());
    const app = setupApp(state);
    // create 2
    await app.request('/api/events/admin/events/ev1/recurrence?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern_type: 'daily', times: ['10:00'], duration_minutes: 60 }),
    });
    await app.request('/api/events/admin/events/ev1/recurrence?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern_type: 'weekly', weekdays: [1, 3, 5], times: ['12:00'], duration_minutes: 30 }),
    });
    const listRes = await app.request('/api/events/admin/events/ev1/recurrence?account_id=la1');
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: RecurrenceRow[] };
    expect(list.items).toHaveLength(2);

    const target = list.items[0];
    const delRes = await app.request(
      `/api/events/admin/events/ev1/recurrence/${target.id}?account_id=la1`,
      { method: 'DELETE' },
    );
    expect(delRes.status).toBe(204);
    expect(state.recurrences).toHaveLength(1);
  });
});

// ============================================================
// Phase 6b: cart period management — completed creates cart, cta-click returns redirect_url
// ============================================================
describe('Phase 6b: cart period', () => {
  function seedLiveBookingWithCart(
    state: State,
    opts: { cartMinutes?: number | null; expiredRedirect?: string | null } = {},
  ): BookingRow {
    state.friends.push({ id: 'f1', line_account_id: 'la1', line_user_id: 'U_user_1' });
    state.slots.push({
      id: 'sl1', event_id: 'ev1',
      starts_at: new Date(Date.now() - 60_000).toISOString(),
      ends_at: new Date(Date.now() + 600_000).toISOString(),
    });
    state.events.push(makeWebinarEvent({
      cart_relative_close_minutes: opts.cartMinutes ?? null,
      cart_expired_redirect_url: opts.expiredRedirect ?? null,
    } as Partial<EventRow>));
    const booking: BookingRow = {
      id: 'b1', line_account_id: 'la1', event_id: 'ev1', slot_id: 'sl1', friend_id: 'f1',
      webinar_first_opened_at: null, webinar_video_started_at: null,
      webinar_max_position_seconds: 0, webinar_completed_at: null,
      webinar_last_heartbeat_at: null,
    };
    state.bookings.push(booking);
    return booking;
  }

  test('completed creates event_cart_status with closes_at = now + cart_relative_close_minutes', async () => {
    const state = emptyState();
    seedLiveBookingWithCart(state, { cartMinutes: 60 });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    const before = Date.now();
    const res = await app.request('/api/liff/webinar/b1/event/completed', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cart: { opened_at: string; closes_at: string; already_open: boolean } | null };
    expect(body.cart).not.toBeNull();
    expect(body.cart!.already_open).toBe(false);
    expect(state.cartStatuses).toHaveLength(1);
    const cs = state.cartStatuses[0];
    const diffMs = new Date(cs.closes_at!).getTime() - new Date(cs.opened_at!).getTime();
    expect(diffMs).toBe(60 * 60_000);
    // closes_at is roughly 60 min after the request
    expect(new Date(cs.closes_at!).getTime() - before).toBeGreaterThan(59 * 60_000);
  });

  test('completed second call does not re-open cart (already_open=true, no new row)', async () => {
    const state = emptyState();
    seedLiveBookingWithCart(state, { cartMinutes: 30 });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    await app.request('/api/liff/webinar/b1/event/completed', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(state.cartStatuses).toHaveLength(1);
    const firstOpenedAt = state.cartStatuses[0].opened_at;

    await new Promise((r) => setTimeout(r, 5));
    const res = await app.request('/api/liff/webinar/b1/event/completed', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cart: { already_open: boolean } | null };
    expect(body.cart!.already_open).toBe(true);
    // opened_at は変化しない
    expect(state.cartStatuses[0].opened_at).toBe(firstOpenedAt);
    expect(state.cartStatuses).toHaveLength(1);
  });

  test('cta-click returns action_value when cart is open', async () => {
    const state = emptyState();
    seedLiveBookingWithCart(state, {
      cartMinutes: 60,
      expiredRedirect: 'https://example.com/expired',
    });
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c1', event_id: 'ev1', at_seconds: 30, display_mode: 'modal',
      label: 'A', action_type: 'url', action_value: 'https://example.com/buy',
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    // pre-existing open cart
    state.cartStatuses.push({
      id: 'cs1', event_id: 'ev1', booking_id: 'b1', friend_id: 'f1',
      opened_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      closes_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      purchased_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    const res = await app.request('/api/liff/webinar/b1/event/cta-click', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ ctaItemId: 'c1', positionSeconds: 45 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect_url: string; cart_state: string };
    expect(body.cart_state).toBe('open');
    expect(body.redirect_url).toBe('https://example.com/buy');
  });

  test('cta-click returns cart_expired_redirect_url when cart is closed', async () => {
    const state = emptyState();
    seedLiveBookingWithCart(state, {
      cartMinutes: 60,
      expiredRedirect: 'https://example.com/next-webinar',
    });
    const now = new Date().toISOString();
    state.ctas.push({
      id: 'c1', event_id: 'ev1', at_seconds: 30, display_mode: 'modal',
      label: 'A', action_type: 'url', action_value: 'https://example.com/buy',
      dismiss_after_seconds: null, sort_order: 0, is_active: 1, deleted_at: null,
      created_at: now, updated_at: now,
    });
    // expired cart (closes_at in the past)
    state.cartStatuses.push({
      id: 'cs1', event_id: 'ev1', booking_id: 'b1', friend_id: 'f1',
      opened_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
      closes_at: new Date(Date.now() - 3600_000).toISOString(),
      purchased_at: null,
      created_at: now, updated_at: now,
    });
    const app = setupApp(state);
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U_user_1');

    const res = await app.request('/api/liff/webinar/b1/event/cta-click', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ ctaItemId: 'c1', positionSeconds: 45 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirect_url: string; cart_state: string };
    expect(body.cart_state).toBe('closed');
    expect(body.redirect_url).toBe('https://example.com/next-webinar');
  });
});
