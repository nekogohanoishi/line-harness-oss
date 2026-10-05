import { Hono } from 'hono';
import type { Env } from '../index.js';

const accountSettings = new Hono<Env>();

function jstIsoNow(): string {
  return new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');
}

// GET /api/account-settings/test-recipients?accountId=xxx
accountSettings.get('/api/account-settings/test-recipients', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`
  ).bind(accountId).first<{ value: string }>();

  const friendIds: string[] = row ? JSON.parse(row.value) : [];

  if (friendIds.length === 0) {
    return c.json({ success: true, data: [] });
  }
  const placeholders = friendIds.map(() => '?').join(',');
  const friends = await c.env.DB.prepare(
    `SELECT id, display_name, picture_url FROM friends WHERE id IN (${placeholders})`
  ).bind(...friendIds).all<{ id: string; display_name: string; picture_url: string | null }>();

  return c.json({
    success: true,
    data: friends.results.map(f => ({
      id: f.id,
      displayName: f.display_name,
      pictureUrl: f.picture_url,
    })),
  });
});

// PUT /api/account-settings/test-recipients
accountSettings.put('/api/account-settings/test-recipients', async (c) => {
  const body = await c.req.json<{ accountId: string; friendIds: string[] }>();
  if (!body.accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const id = crypto.randomUUID();
  const now = jstIsoNow();

  await c.env.DB.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, ?, 'test_recipients', ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(
    id, body.accountId, JSON.stringify(body.friendIds), now, now,
    JSON.stringify(body.friendIds), now,
  ).run();

  return c.json({ success: true });
});

// ============================================================
// 予約通知の受信者 (booking_notify_recipients)
// 予約リクエスト/確定の発生を LINE push で受け取る運営者 (bot の友だち)
// のリスト。test_recipients と同じ key-value パターン。
// ============================================================

// GET /api/account-settings/booking-notify-recipients?accountId=xxx
accountSettings.get('/api/account-settings/booking-notify-recipients', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'booking_notify_recipients'`
  ).bind(accountId).first<{ value: string }>();

  const friendIds: string[] = row ? JSON.parse(row.value) : [];

  if (friendIds.length === 0) {
    return c.json({ success: true, data: [] });
  }
  const placeholders = friendIds.map(() => '?').join(',');
  const friends = await c.env.DB.prepare(
    `SELECT id, display_name, picture_url FROM friends WHERE id IN (${placeholders})`
  ).bind(...friendIds).all<{ id: string; display_name: string; picture_url: string | null }>();

  return c.json({
    success: true,
    data: friends.results.map(f => ({
      id: f.id,
      displayName: f.display_name,
      pictureUrl: f.picture_url,
    })),
  });
});

// PUT /api/account-settings/booking-notify-recipients
accountSettings.put('/api/account-settings/booking-notify-recipients', async (c) => {
  const body = await c.req.json<{ accountId: string; friendIds: string[] }>();
  if (!body.accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  if (!Array.isArray(body.friendIds)) {
    return c.json({ success: false, error: 'friendIds must be an array' }, 400);
  }

  const id = crypto.randomUUID();
  const now = jstIsoNow();

  await c.env.DB.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, ?, 'booking_notify_recipients', ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(
    id, body.accountId, JSON.stringify(body.friendIds), now, now,
    JSON.stringify(body.friendIds), now,
  ).run();

  return c.json({ success: true });
});

// ============================================================
// 友だち一覧の保存した絞り込み (friend_saved_filters)
// 「受講生」のようによく使う条件に名前を付けて保存し、スマホでも PC でも
// 同じものを呼び出せるようにする。値は名前と絞り込み条件だけに限り、
// 想定外のキーや長すぎる値は受け付けない。
// ============================================================

export interface FriendSavedFilter {
  id: string;
  name: string;
  filters: {
    search?: string;
    tagId?: string;
    handled?: 'unhandled';
    followStatus?: 'following' | 'blocked';
    sort?: 'oldest';
  };
}

const MAX_SAVED_FILTERS = 20;

/** 保存内容を検証して正規化する。1件でも不正なら null (= 400 を返す)。 */
export function sanitizeFriendSavedFilters(input: unknown): FriendSavedFilter[] | null {
  if (!Array.isArray(input) || input.length > MAX_SAVED_FILTERS) return null;
  const result: FriendSavedFilter[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as { id?: unknown; name?: unknown; filters?: unknown };
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name || name.length > 30) return null;
    const id = typeof entry.id === 'string' && /^[\w-]{1,64}$/.test(entry.id) ? entry.id : crypto.randomUUID();
    const f = (entry.filters && typeof entry.filters === 'object' ? entry.filters : {}) as Record<string, unknown>;
    const filters: FriendSavedFilter['filters'] = {};
    if (typeof f.search === 'string' && f.search.trim()) {
      if (f.search.trim().length > 100) return null;
      filters.search = f.search.trim();
    }
    if (typeof f.tagId === 'string' && f.tagId) {
      if (f.tagId.length > 64) return null;
      filters.tagId = f.tagId;
    }
    if (f.handled === 'unhandled') filters.handled = 'unhandled';
    if (f.followStatus === 'following' || f.followStatus === 'blocked') filters.followStatus = f.followStatus;
    if (f.sort === 'oldest') filters.sort = 'oldest';
    result.push({ id, name, filters });
  }
  return result;
}

// GET /api/account-settings/friend-saved-filters?accountId=xxx
accountSettings.get('/api/account-settings/friend-saved-filters', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId required' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'friend_saved_filters'`
  ).bind(accountId).first<{ value: string }>();

  let saved: FriendSavedFilter[] = [];
  if (row) {
    try {
      saved = sanitizeFriendSavedFilters(JSON.parse(row.value)) ?? [];
    } catch {
      saved = [];
    }
  }
  return c.json({ success: true, data: saved });
});

// PUT /api/account-settings/friend-saved-filters
accountSettings.put('/api/account-settings/friend-saved-filters', async (c) => {
  const body = await c.req.json<{ accountId?: string; filters?: unknown }>();
  if (!body.accountId) return c.json({ success: false, error: 'accountId required' }, 400);
  const saved = sanitizeFriendSavedFilters(body.filters);
  if (!saved) {
    return c.json({ success: false, error: `保存できる絞り込みは${MAX_SAVED_FILTERS}件まで、名前は30文字までです` }, 400);
  }

  const id = crypto.randomUUID();
  const now = jstIsoNow();
  const value = JSON.stringify(saved);

  await c.env.DB.prepare(
    `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
     VALUES (?, ?, 'friend_saved_filters', ?, ?, ?)
     ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(id, body.accountId, value, now, now, value, now).run();

  return c.json({ success: true, data: saved });
});

export { accountSettings };
