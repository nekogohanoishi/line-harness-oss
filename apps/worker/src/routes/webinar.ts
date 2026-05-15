// Webinar Launch HTTP routes.
//
// Admin endpoints:  /api/events/admin/events/:id/(video|cta|webinar/stats)
// LIFF endpoints :  /api/liff/webinar/:bookingId/...
//
// 既存 events.ts のパターンを踏襲:
//   - admin は ?account_id= で認可 (ownsEvent と同じ JSON-each による
//     multi-account-dedup チェック)
//   - LIFF は LIFF id_token を verifyCallerLineUserId で検証し、
//     friend.line_user_id を bookingId.friend_id と一致確認
//   - 時刻列は Worker から UTC ISO8601 (Z) で書く
//
// R2 ストリーミングと "presigned" PUT URL について:
//   R2 の真の SigV4 presign には R2 API キー (S3 互換アクセスキー) が必要。
//   v1 では Worker 自身が短命 HMAC 署名トークン付き URL を発行し、PUT は
//   Worker 経由で R2 にプロキシして access control を維持する。
//   トークン署名鍵は LIFF id_token 検証と共通の LINE_CHANNEL_SECRET を流用。
//   将来 R2 S3 credentials を発行できれば aws4 sign に差し替え可能。
//
// 設計書: docs/specs/2026-05-14-webinar-launch-design.md

import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import {
  WEBINAR_CTA_DISPLAY_MODES,
  WEBINAR_CTA_ACTION_TYPES,
  WEBINAR_DEFAULT_ATTENDANCE_RATIO,
  WEBINAR_UPLOAD_URL_TTL_SECONDS,
  WEBINAR_ACTIVE_VIEWER_WINDOW_SECONDS,
  type WebinarCtaDisplayMode,
  type WebinarCtaActionType,
} from '../services/event-booking-types.js';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { fireEvent } from '../services/event-bus.js';
import {
  generateSlotsForRecurrence,
  type RecurrenceRow,
} from '../services/event-slot-generator.js';

const webinar = new Hono<Env>();

// ============================================================
// Helper: fire an automation/scoring event for a webinar tracking event.
//
// Looks up the LINE account's channel access token so that send_message
// actions can succeed; missing tokens are tolerated (no-op for send_message).
// Errors are caught and logged — webinar tracking endpoints must always
// return 200 even if the downstream event bus fails.
// ============================================================
async function fireWebinarEvent(
  env: Env['Bindings'],
  eventType:
    | 'webinar_opened'
    | 'webinar_started'
    | 'webinar_completed'
    | 'webinar_cta_clicked',
  friendId: string,
  accountId: string,
  eventData: Record<string, unknown>,
): Promise<void> {
  try {
    let accessToken: string | undefined;
    try {
      const acc = await env.DB
        .prepare(`SELECT channel_access_token FROM line_accounts WHERE id = ?`)
        .bind(accountId)
        .first<{ channel_access_token: string | null }>();
      accessToken = acc?.channel_access_token ?? undefined;
    } catch (e) {
      console.error('fireWebinarEvent: line_accounts lookup failed', e);
    }
    await fireEvent(env.DB, eventType, { friendId, eventData }, accessToken, accountId);
  } catch (err) {
    console.error(`fireWebinarEvent ${eventType} failed:`, err);
  }
}

// ============================================================
// Helpers
// ============================================================

function bad(c: Context<Env>, code: string, status = 422): Response {
  return c.json({ error: code }, status as 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429);
}

function getAccountId(c: Context<Env>): string | null {
  return c.req.query('account_id') ?? null;
}

async function ownsEvent(
  db: D1Database,
  event_id: string,
  account_id: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM events
        WHERE id = ? AND deleted_at IS NULL AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(event_id, account_id, account_id)
    .first<{ id: string }>();
  return row != null;
}

interface EventWebinarRow {
  id: string;
  line_account_id: string;
  kind: string;
  video_r2_key: string | null;
  video_duration_seconds: number | null;
  video_mime_type: string | null;
  video_size_bytes: number | null;
  replay_window_minutes: number | null;
  attendance_threshold_seconds: number | null;
  archive_url: string | null;
  image_url: string | null;
  name: string;
  venue_name: string | null;
  description: string | null;
  is_published: number;
  target_type: string;
  account_ids: string | null;
}

async function fetchEvent(db: D1Database, event_id: string): Promise<EventWebinarRow | null> {
  return (await db
    .prepare(`SELECT * FROM events WHERE id = ? AND deleted_at IS NULL`)
    .bind(event_id)
    .first<EventWebinarRow>()) ?? null;
}

function r2KeyFor(account_id: string, event_id: string, mime: string): string {
  const ext = pickExtension(mime);
  return `webinar/${account_id}/${event_id}/video.${ext}`;
}

function pickExtension(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('quicktime') || m.includes('mov')) return 'mov';
  if (m.includes('ogg')) return 'ogg';
  // 不明な MIME は mp4 にしておく (HTML5 video の互換性最優先)
  return 'mp4';
}

const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

const MAX_VIDEO_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB 上限 (Cloudflare R2 single-PUT 制限と整合)

// ------------------------------------------------------------
// HMAC sign / verify for upload tokens
// ------------------------------------------------------------
// LINE_CHANNEL_SECRET を流用して HMAC-SHA256 で署名する。
// クライアントには `${base64url(payloadJson)}.${base64url(signature)}` で渡し、
// PUT 受信時に Worker が payload を復元してから R2 に書き込む。

async function hmacSign(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return base64UrlEncode(new Uint8Array(sigBuf));
}

async function hmacVerify(secret: string, message: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlDecode(input: string): string {
  let s = input.replaceAll('-', '+').replaceAll('_', '/');
  while (s.length % 4 !== 0) s += '=';
  return atob(s);
}

interface UploadTokenPayload {
  k: string;        // r2 key
  m: string;        // mime
  s: number;        // max size bytes
  e: number;        // expiry epoch ms
  a: string;        // account_id
  i: string;        // event_id
}

async function signUploadToken(secret: string, payload: UploadTokenPayload): Promise<string> {
  const json = JSON.stringify(payload);
  const p = base64UrlEncode(json);
  const sig = await hmacSign(secret, p);
  return `${p}.${sig}`;
}

async function verifyUploadToken(
  secret: string,
  token: string,
): Promise<UploadTokenPayload | null> {
  const [p, sig] = token.split('.', 2);
  if (!p || !sig) return null;
  if (!(await hmacVerify(secret, p, sig))) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(p)) as UploadTokenPayload;
    if (typeof payload.e !== 'number' || payload.e < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ============================================================
// Admin: video upload-url / finalize / delete
// ============================================================

webinar.post('/api/events/admin/events/:id/video/upload-url', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    mime_type?: string;
    size_bytes?: number;
  };
  const mime = body.mime_type;
  const size = body.size_bytes;
  if (typeof mime !== 'string' || !ALLOWED_VIDEO_MIME.has(mime)) {
    return bad(c, 'invalid_mime_type', 422);
  }
  if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > MAX_VIDEO_SIZE_BYTES) {
    return bad(c, 'invalid_size_bytes', 422);
  }

  const key = r2KeyFor(account_id, id, mime);
  const expiresAt = Date.now() + WEBINAR_UPLOAD_URL_TTL_SECONDS * 1000;
  const token = await signUploadToken(c.env.LINE_CHANNEL_SECRET, {
    k: key,
    m: mime,
    s: size as number,
    e: expiresAt,
    a: account_id,
    i: id,
  });

  const origin = c.env.WORKER_URL || new URL(c.req.url).origin;
  const uploadUrl = `${origin}/api/events/admin/events/${encodeURIComponent(id)}/video/upload?token=${encodeURIComponent(token)}`;
  return c.json({
    upload_url: uploadUrl,
    method: 'PUT',
    r2_key: key,
    expires_at: new Date(expiresAt).toISOString(),
    // Implementation note: Worker-proxied PUT instead of R2 SigV4 presign.
    // See routes/webinar.ts top-of-file comment for rationale.
    headers: { 'Content-Type': mime },
  });
});

// Worker-proxied PUT — token authenticates the caller; we stream the body into R2.
// IMAGES バインドを流用 (videoはサイズが大きいため将来別バケットに分離可能)。
webinar.put('/api/events/admin/events/:id/video/upload', async (c) => {
  const token = c.req.query('token') ?? '';
  if (!token) return bad(c, 'token_required', 400);
  const payload = await verifyUploadToken(c.env.LINE_CHANNEL_SECRET, token);
  if (!payload) return bad(c, 'invalid_or_expired_token', 401);
  if (payload.i !== c.req.param('id')) return bad(c, 'token_event_mismatch', 403);

  const contentType = c.req.header('Content-Type') || payload.m;
  if (!ALLOWED_VIDEO_MIME.has(contentType)) return bad(c, 'invalid_mime_type', 422);

  // Stream the body to R2. body は Cloudflare Worker の ReadableStream。
  if (!c.req.raw.body) return bad(c, 'empty_body', 400);
  await c.env.IMAGES.put(payload.k, c.req.raw.body, {
    httpMetadata: { contentType },
    customMetadata: { account_id: payload.a, event_id: payload.i },
  });
  return c.json({ ok: true, r2_key: payload.k });
});

webinar.post('/api/events/admin/events/:id/video/finalize', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    r2_key?: string;
    duration_seconds?: number;
    mime_type?: string;
    size_bytes?: number;
  };
  const r2Key = body.r2_key;
  const duration = body.duration_seconds;
  const mime = body.mime_type;
  const size = body.size_bytes;
  if (typeof r2Key !== 'string' || !r2Key.startsWith(`webinar/${account_id}/${id}/`)) {
    return bad(c, 'invalid_r2_key', 422);
  }
  if (!Number.isInteger(duration) || (duration as number) <= 0) {
    return bad(c, 'invalid_duration_seconds', 422);
  }
  if (typeof mime !== 'string' || !ALLOWED_VIDEO_MIME.has(mime)) {
    return bad(c, 'invalid_mime_type', 422);
  }
  if (!Number.isInteger(size) || (size as number) <= 0) {
    return bad(c, 'invalid_size_bytes', 422);
  }

  // R2 にオブジェクトが実在するか軽く確認 (head 相当)。
  const head = await c.env.IMAGES.head(r2Key);
  if (!head) return bad(c, 'r2_object_not_found', 404);

  const now = new Date().toISOString();
  await c.env.DB
    .prepare(
      `UPDATE events
          SET video_r2_key = ?, video_duration_seconds = ?, video_mime_type = ?,
              video_size_bytes = ?, kind = 'webinar', updated_at = ?
        WHERE id = ?`,
    )
    .bind(r2Key, duration, mime, size, now, id)
    .run();

  const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
  return c.json(row);
});

webinar.delete('/api/events/admin/events/:id/video', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const ev = await fetchEvent(c.env.DB, id);
  if (!ev) return bad(c, 'not_found', 404);

  if (ev.video_r2_key) {
    try {
      await c.env.IMAGES.delete(ev.video_r2_key);
    } catch (e) {
      // R2 削除失敗でも DB クリアは続行 (孤児 object は容認)。
      console.error('webinar video R2 delete failed:', e);
    }
  }
  const now = new Date().toISOString();
  await c.env.DB
    .prepare(
      `UPDATE events
          SET video_r2_key = NULL, video_duration_seconds = NULL,
              video_mime_type = NULL, video_size_bytes = NULL, updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, id)
    .run();
  return new Response(null, { status: 204 });
});

// ============================================================
// Admin: CTA CRUD
// ============================================================

interface CtaInput {
  at_seconds?: number;
  display_mode?: string;
  label?: string;
  action_type?: string;
  action_value?: string | null;
  dismiss_after_seconds?: number | null;
  sort_order?: number;
  is_active?: number;
}

function validateCtaInput(
  body: Record<string, unknown>,
  isCreate: boolean,
): { ok: true } | { ok: false; code: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (isCreate || has('at_seconds')) {
    const v = body.at_seconds;
    if (!Number.isInteger(v) || (v as number) < 0) return { ok: false, code: 'invalid_at_seconds' };
  }
  if (isCreate || has('display_mode')) {
    if (!WEBINAR_CTA_DISPLAY_MODES.includes(body.display_mode as WebinarCtaDisplayMode)) {
      return { ok: false, code: 'invalid_display_mode' };
    }
  }
  if (isCreate || has('label')) {
    const v = body.label;
    if (typeof v !== 'string' || v.length === 0 || v.length > 200) {
      return { ok: false, code: 'invalid_label' };
    }
  }
  if (isCreate || has('action_type')) {
    if (!WEBINAR_CTA_ACTION_TYPES.includes(body.action_type as WebinarCtaActionType)) {
      return { ok: false, code: 'invalid_action_type' };
    }
  }
  if (has('action_value') && body.action_value != null) {
    if (typeof body.action_value !== 'string' || (body.action_value as string).length > 2000) {
      return { ok: false, code: 'invalid_action_value' };
    }
  }
  if (has('dismiss_after_seconds') && body.dismiss_after_seconds != null) {
    const v = body.dismiss_after_seconds;
    if (!Number.isInteger(v) || (v as number) <= 0) {
      return { ok: false, code: 'invalid_dismiss_after_seconds' };
    }
  }
  if (has('sort_order') && body.sort_order != null && !Number.isInteger(body.sort_order)) {
    return { ok: false, code: 'invalid_sort_order' };
  }
  if (has('is_active') && body.is_active != null && body.is_active !== 0 && body.is_active !== 1) {
    return { ok: false, code: 'invalid_is_active' };
  }
  return { ok: true };
}

webinar.get('/api/events/admin/events/:id/cta', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM webinar_cta_items
        WHERE event_id = ? AND deleted_at IS NULL
        ORDER BY at_seconds ASC, sort_order ASC, created_at ASC`,
    )
    .bind(id)
    .all();
  return c.json({ items: results ?? [] });
});

webinar.post('/api/events/admin/events/:id/cta', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateCtaInput(body, true);
  if (!v.ok) return bad(c, v.code, 422);

  const ctaId = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO webinar_cta_items (
         id, event_id, at_seconds, display_mode, label, action_type,
         action_value, dismiss_after_seconds, sort_order, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ctaId,
      id,
      body.at_seconds as number,
      body.display_mode as string,
      body.label as string,
      body.action_type as string,
      (body.action_value as string | null | undefined) ?? null,
      (body.dismiss_after_seconds as number | null | undefined) ?? null,
      (body.sort_order as number | undefined) ?? 0,
      (body.is_active as number | undefined) ?? 1,
    )
    .run();
  const row = await c.env.DB
    .prepare(`SELECT * FROM webinar_cta_items WHERE id = ?`)
    .bind(ctaId)
    .first();
  return c.json(row, 201);
});

webinar.put('/api/events/admin/events/:id/cta/:ctaId', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  const ctaId = c.req.param('ctaId');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const existing = await c.env.DB
    .prepare(
      `SELECT id FROM webinar_cta_items WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    )
    .bind(ctaId, id)
    .first<{ id: string }>();
  if (!existing) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateCtaInput(body, false);
  if (!v.ok) return bad(c, v.code, 422);

  const updatable = [
    'at_seconds',
    'display_mode',
    'label',
    'action_type',
    'action_value',
    'dismiss_after_seconds',
    'sort_order',
    'is_active',
  ] as const;
  const setClauses: string[] = [];
  const setValues: unknown[] = [];
  for (const k of updatable) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      setClauses.push(`${k} = ?`);
      setValues.push(body[k]);
    }
  }
  if (setClauses.length === 0) {
    const row = await c.env.DB
      .prepare(`SELECT * FROM webinar_cta_items WHERE id = ?`)
      .bind(ctaId)
      .first();
    return c.json(row);
  }
  setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  setValues.push(ctaId);
  await c.env.DB
    .prepare(`UPDATE webinar_cta_items SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...setValues)
    .run();
  const row = await c.env.DB
    .prepare(`SELECT * FROM webinar_cta_items WHERE id = ?`)
    .bind(ctaId)
    .first();
  return c.json(row);
});

webinar.delete('/api/events/admin/events/:id/cta/:ctaId', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  const ctaId = c.req.param('ctaId');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const now = new Date().toISOString();
  const result = await c.env.DB
    .prepare(
      `UPDATE webinar_cta_items
          SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, ctaId, id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) return bad(c, 'not_found', 404);
  return new Response(null, { status: 204 });
});

// ============================================================
// Admin: stats
// ============================================================

webinar.get('/api/events/admin/events/:id/webinar/stats', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const ev = await c.env.DB
    .prepare(
      `SELECT video_duration_seconds, attendance_threshold_seconds FROM events WHERE id = ?`,
    )
    .bind(id)
    .first<{ video_duration_seconds: number | null; attendance_threshold_seconds: number | null }>();

  const threshold =
    ev?.attendance_threshold_seconds ??
    (ev?.video_duration_seconds != null
      ? Math.floor(ev.video_duration_seconds * WEBINAR_DEFAULT_ATTENDANCE_RATIO)
      : null);

  const bookingAgg = await c.env.DB
    .prepare(
      `SELECT
          COUNT(*) AS total_bookings,
          SUM(CASE WHEN webinar_first_opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
          SUM(CASE WHEN webinar_video_started_at IS NOT NULL THEN 1 ELSE 0 END) AS started,
          SUM(CASE WHEN webinar_completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
          AVG(webinar_max_position_seconds) AS avg_position
         FROM event_bookings
        WHERE event_id = ?`,
    )
    .bind(id)
    .first<{
      total_bookings: number | null;
      opened: number | null;
      started: number | null;
      completed: number | null;
      avg_position: number | null;
    }>();

  const ctaStats = await c.env.DB
    .prepare(
      `SELECT
          ci.id AS cta_id,
          ci.label,
          ci.at_seconds,
          (SELECT COUNT(DISTINCT booking_id)
             FROM webinar_cta_clicks
            WHERE cta_item_id = ci.id) AS click_unique_count,
          (SELECT COUNT(*)
             FROM webinar_cta_clicks
            WHERE cta_item_id = ci.id) AS click_total_count
         FROM webinar_cta_items ci
        WHERE ci.event_id = ? AND ci.deleted_at IS NULL
        ORDER BY ci.at_seconds ASC`,
    )
    .bind(id)
    .all<{
      cta_id: string;
      label: string;
      at_seconds: number;
      click_unique_count: number;
      click_total_count: number;
    }>();

  return c.json({
    duration_seconds: ev?.video_duration_seconds ?? null,
    attendance_threshold_seconds: threshold,
    bookings: {
      total: bookingAgg?.total_bookings ?? 0,
      opened: bookingAgg?.opened ?? 0,
      started: bookingAgg?.started ?? 0,
      completed: bookingAgg?.completed ?? 0,
      avg_max_position_seconds: bookingAgg?.avg_position ?? 0,
    },
    ctas: (ctaStats.results ?? []).map((r) => ({
      cta_id: r.cta_id,
      label: r.label,
      at_seconds: r.at_seconds,
      click_unique_count: r.click_unique_count,
      click_total_count: r.click_total_count,
      ctr_unique:
        bookingAgg?.opened && bookingAgg.opened > 0
          ? r.click_unique_count / bookingAgg.opened
          : 0,
    })),
  });
});

// ============================================================
// LIFF: booking auth + manifest
// ============================================================

interface BookingForLiff {
  booking_id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  line_user_id: string;
  account_id: string;
  // event
  kind: string;
  name: string;
  video_r2_key: string | null;
  video_duration_seconds: number | null;
  video_mime_type: string | null;
  video_size_bytes: number | null;
  replay_window_minutes: number | null;
  attendance_threshold_seconds: number | null;
  archive_url: string | null;
  image_url: string | null;
  description: string | null;
  // Phase 6b: カート期間
  cart_relative_close_minutes: number | null;
  cart_expired_redirect_url: string | null;
  // Phase 7: ライブ感演出
  concurrent_floor: number;
  concurrent_jitter_max: number;
  show_concurrent_viewers: number;
  show_fake_comments: number;
  // slot
  slot_starts_at: string;
  slot_ends_at: string;
  // booking watch state
  webinar_first_opened_at: string | null;
  webinar_video_started_at: string | null;
  webinar_max_position_seconds: number;
  webinar_completed_at: string | null;
  webinar_last_heartbeat_at: string | null;
}

async function loadBookingForLiff(
  db: D1Database,
  bookingId: string,
): Promise<BookingForLiff | null> {
  const row = await db
    .prepare(
      `SELECT
         b.id AS booking_id, b.event_id, b.slot_id, b.friend_id,
         b.line_account_id AS account_id,
         b.webinar_first_opened_at, b.webinar_video_started_at,
         b.webinar_max_position_seconds, b.webinar_completed_at,
         b.webinar_last_heartbeat_at,
         f.line_user_id,
         e.kind, e.name, e.video_r2_key, e.video_duration_seconds,
         e.video_mime_type, e.video_size_bytes, e.replay_window_minutes,
         e.attendance_threshold_seconds, e.archive_url, e.image_url, e.description,
         e.cart_relative_close_minutes, e.cart_expired_redirect_url,
         e.concurrent_floor, e.concurrent_jitter_max,
         e.show_concurrent_viewers, e.show_fake_comments,
         s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
        FROM event_bookings b
        JOIN friends f ON f.id = b.friend_id
        JOIN events e ON e.id = b.event_id
        JOIN event_slots s ON s.id = b.slot_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<BookingForLiff>();
  return row ?? null;
}

async function authorizeLiffBooking(c: Context<Env>): Promise<
  | { ok: true; booking: BookingForLiff }
  | { ok: false; status: number; code: string }
> {
  // 通常は Authorization: Bearer <id_token>。ただし <video src> 経由のリクエスト
  // は header を付けられないため、?_t=<id_token> query を fallback として
  // 受け取る (stream endpoint で実需)。 query 経由は同一 origin かつ LIFF 内で
  // しか発火しない設計なので、漏洩リスクは小さい。
  let authHeader = c.req.header('Authorization');
  if (!authHeader) {
    const t = c.req.query('_t');
    if (t) authHeader = `Bearer ${t}`;
  }
  const caller = await verifyCallerLineUserId(authHeader, c.env);
  if (!caller) return { ok: false, status: 401, code: 'unauthorized' };
  const bookingId = c.req.param('bookingId');
  if (!bookingId) return { ok: false, status: 404, code: 'not_found' };
  const booking = await loadBookingForLiff(c.env.DB, bookingId);
  if (!booking) return { ok: false, status: 404, code: 'not_found' };
  if (booking.line_user_id !== caller) {
    return { ok: false, status: 403, code: 'forbidden' };
  }
  if (booking.kind !== 'webinar') {
    return { ok: false, status: 409, code: 'not_a_webinar' };
  }
  return { ok: true, booking };
}

// 状態判定。設計書 §5.3 のマトリクスに対応。
type WebinarAccessState = 'pre_start' | 'live' | 'replay' | 'expired';

function computeAccessState(
  slotStartsAtIso: string,
  durationSeconds: number | null,
  replayWindowMinutes: number | null,
  now: Date = new Date(),
): { state: WebinarAccessState; server_now_ts: number } {
  const startMs = new Date(slotStartsAtIso).getTime();
  const nowMs = now.getTime();
  const durMs = (durationSeconds ?? 0) * 1000;
  const replayMs = (replayWindowMinutes ?? 0) * 60 * 1000;
  let state: WebinarAccessState;
  if (nowMs < startMs) state = 'pre_start';
  else if (nowMs < startMs + durMs) state = 'live';
  else if (nowMs < startMs + durMs + replayMs) state = 'replay';
  else state = 'expired';
  return { state, server_now_ts: nowMs };
}

webinar.get('/api/liff/webinar/:bookingId/manifest', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;

  // CTA は active かつ未削除のみ。順序は表示時刻昇順。
  const { results: ctas } = await c.env.DB
    .prepare(
      `SELECT id, at_seconds, display_mode, label, action_type, action_value,
              dismiss_after_seconds, sort_order
         FROM webinar_cta_items
        WHERE event_id = ? AND is_active = 1 AND deleted_at IS NULL
        ORDER BY at_seconds ASC, sort_order ASC`,
    )
    .bind(b.event_id)
    .all();

  const access = computeAccessState(
    b.slot_starts_at,
    b.video_duration_seconds,
    b.replay_window_minutes,
  );
  const threshold =
    b.attendance_threshold_seconds ??
    (b.video_duration_seconds != null
      ? Math.floor(b.video_duration_seconds * WEBINAR_DEFAULT_ATTENDANCE_RATIO)
      : null);

  return c.json({
    booking: {
      id: b.booking_id,
      first_opened_at: b.webinar_first_opened_at,
      video_started_at: b.webinar_video_started_at,
      max_position_seconds: b.webinar_max_position_seconds,
      completed_at: b.webinar_completed_at,
      last_heartbeat_at: b.webinar_last_heartbeat_at,
    },
    event: {
      id: b.event_id,
      kind: b.kind,
      name: b.name,
      image_url: b.image_url,
      description: b.description,
      attendance_threshold_seconds: threshold,
      replay_window_minutes: b.replay_window_minutes,
      archive_url: b.archive_url,
    },
    video: {
      duration_seconds: b.video_duration_seconds,
      mime_type: b.video_mime_type,
      // ストリーム URL は ID トークン認証ヘッダーが必要なので相対パスのみ返す
      stream_url: `/api/liff/webinar/${encodeURIComponent(b.booking_id)}/video/stream`,
    },
    slot: { starts_at: b.slot_starts_at, ends_at: b.slot_ends_at },
    access_state: access.state,
    server_now_ts: access.server_now_ts,
    ctas: ctas ?? [],
    // Phase 7a: live-feel — 同接表示の on/off フラグ. fake comments は
    // Phase 7b で同じ live_feel オブジェクトに追加する。
    live_feel: {
      show_concurrent_viewers: b.show_concurrent_viewers === 1,
    },
  });
});

// ============================================================
// LIFF: concurrent viewer count (Phase 7a)
// ============================================================
// 直近 WEBINAR_ACTIVE_VIEWER_WINDOW_SECONDS 秒以内に heartbeat があった
// bookings 数を「視聴中」とみなす. WebSocket は使わず Polling 方式。
//
// 表示値は max(active, floor) + random(0..jitter_max).
//   - show_concurrent_viewers=0 の event は 404 (LIFF 側で polling しない)
//   - access_state が live でも replay でも同じロジックで返す (pre_start /
//     expired は LIFF 側で polling 停止する想定だが、念のため count=0 を返す)
webinar.get('/api/liff/webinar/:bookingId/concurrent', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;

  if (b.show_concurrent_viewers !== 1) {
    return bad(c, 'concurrent_disabled', 404);
  }

  const windowMs = WEBINAR_ACTIVE_VIEWER_WINDOW_SECONDS * 1000;
  const sinceIso = new Date(Date.now() - windowMs).toISOString();

  // 同 event の bookings のうち、直近 N 秒以内に heartbeat があった人数。
  // webinar_last_heartbeat_at は event_bookings に MAX で書かれるので
  // JOIN なしで取得できる。
  const row = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM event_bookings
        WHERE event_id = ?
          AND webinar_last_heartbeat_at IS NOT NULL
          AND webinar_last_heartbeat_at >= ?`,
    )
    .bind(b.event_id, sinceIso)
    .first<{ n: number }>();
  const actual = row?.n ?? 0;

  const floor = Math.max(0, b.concurrent_floor ?? 0);
  const jitterMax = Math.max(0, b.concurrent_jitter_max ?? 0);
  const jitter = jitterMax > 0 ? Math.floor(Math.random() * (jitterMax + 1)) : 0;
  const displayed = Math.max(actual, floor) + jitter;

  return c.json({
    count: displayed,
    actual,
    floor,
    jitter,
    window_seconds: WEBINAR_ACTIVE_VIEWER_WINDOW_SECONDS,
  });
});

// Phase 7b: fake_comments CRUD + bulk endpoints は次の commit で追加.

// ============================================================
// LIFF: video streaming with Range support
// ============================================================

webinar.get('/api/liff/webinar/:bookingId/video/stream', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;

  if (!b.video_r2_key) return bad(c, 'video_not_uploaded', 404);

  const access = computeAccessState(
    b.slot_starts_at,
    b.video_duration_seconds,
    b.replay_window_minutes,
  );
  // expired は streaming 拒否。pre_start も拒否 (LIFF 側でカウントダウン表示)。
  if (access.state === 'expired') return bad(c, 'replay_window_expired', 404);
  if (access.state === 'pre_start') return bad(c, 'not_started_yet', 403);

  const rangeHeader = c.req.header('Range');
  let r2Range: R2Range | undefined = undefined;
  let status = 200;
  const headers = new Headers();
  headers.set('Accept-Ranges', 'bytes');
  // CDN cache を抑制 (access control が個別に効くため)
  headers.set('Cache-Control', 'private, no-store');

  // R2 head で total size を確認 (Content-Range 算出に使う)
  const head = await c.env.IMAGES.head(b.video_r2_key);
  if (!head) return bad(c, 'video_not_found', 404);
  const totalSize = head.size;
  headers.set('Content-Type', head.httpMetadata?.contentType || b.video_mime_type || 'video/mp4');

  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m) return new Response(null, { status: 416 });
    const startStr = m[1];
    const endStr = m[2];
    let start: number;
    let end: number;
    if (startStr === '' && endStr !== '') {
      // suffix: last N bytes
      const n = parseInt(endStr, 10);
      if (!Number.isFinite(n) || n <= 0) return new Response(null, { status: 416 });
      start = Math.max(0, totalSize - n);
      end = totalSize - 1;
    } else {
      start = parseInt(startStr, 10);
      end = endStr === '' ? totalSize - 1 : parseInt(endStr, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= totalSize || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        });
      }
    }
    r2Range = { offset: start, length: end - start + 1 };
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', String(end - start + 1));
  } else {
    headers.set('Content-Length', String(totalSize));
  }

  const obj = await c.env.IMAGES.get(b.video_r2_key, r2Range ? { range: r2Range } : undefined);
  if (!obj) return bad(c, 'video_not_found', 404);

  return new Response(obj.body, { status, headers });
});

// ============================================================
// LIFF: tracking events
// ============================================================

webinar.post('/api/liff/webinar/:bookingId/event/opened', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;
  // 初回のみ書く (COALESCE) — 二度目以降は no-op
  const now = new Date().toISOString();
  // 事前に「初回かどうか」を読む: b.webinar_first_opened_at が null なら初回
  const isFirst = b.webinar_first_opened_at == null;
  await c.env.DB
    .prepare(
      `UPDATE event_bookings
          SET webinar_first_opened_at = COALESCE(webinar_first_opened_at, ?), updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, now, b.booking_id)
    .run();
  if (isFirst) {
    await fireWebinarEvent(c.env, 'webinar_opened', b.friend_id, b.account_id, {
      eventId: b.event_id,
      bookingId: b.booking_id,
    });
  }
  return c.json({ ok: true });
});

webinar.post('/api/liff/webinar/:bookingId/event/started', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;
  const now = new Date().toISOString();
  const isFirst = b.webinar_video_started_at == null;
  await c.env.DB
    .prepare(
      `UPDATE event_bookings
          SET webinar_video_started_at = COALESCE(webinar_video_started_at, ?), updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, now, b.booking_id)
    .run();
  if (isFirst) {
    await fireWebinarEvent(c.env, 'webinar_started', b.friend_id, b.account_id, {
      eventId: b.event_id,
      bookingId: b.booking_id,
    });
  }
  return c.json({ ok: true });
});

webinar.post('/api/liff/webinar/:bookingId/event/heartbeat', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;
  const body = (await c.req.json().catch(() => ({}))) as { positionSeconds?: number };
  const pos = body.positionSeconds;
  if (!Number.isFinite(pos) || (pos as number) < 0) return bad(c, 'invalid_position', 422);
  const position = Math.floor(pos as number);
  const now = new Date().toISOString();
  const ua = c.req.header('User-Agent') ?? null;

  const heartbeatId = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO webinar_heartbeats (id, booking_id, position_seconds, occurred_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(heartbeatId, b.booking_id, position, now, ua)
    .run();

  // MAX で max_position を伸ばす。冪等。
  await c.env.DB
    .prepare(
      `UPDATE event_bookings
          SET webinar_max_position_seconds = MAX(webinar_max_position_seconds, ?),
              webinar_last_heartbeat_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(position, now, now, b.booking_id)
    .run();
  return c.json({ ok: true });
});

webinar.post('/api/liff/webinar/:bookingId/event/cta-click', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;
  const body = (await c.req.json().catch(() => ({}))) as {
    ctaItemId?: string;
    positionSeconds?: number;
  };
  const ctaId = body.ctaItemId;
  const pos = body.positionSeconds;
  if (typeof ctaId !== 'string' || ctaId.length === 0) return bad(c, 'invalid_cta_item_id', 422);
  if (!Number.isFinite(pos) || (pos as number) < 0) return bad(c, 'invalid_position', 422);

  // CTA が同一 event に属するか確認 (booking 跨ぎ防止). action_type / action_value も併せて
  // 取得し、Phase 6b のカート期間切替判定に使う。
  const cta = await c.env.DB
    .prepare(
      `SELECT id, action_type, action_value FROM webinar_cta_items
        WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    )
    .bind(ctaId, b.event_id)
    .first<{ id: string; action_type: string; action_value: string | null }>();
  if (!cta) return bad(c, 'cta_not_found', 404);

  const clickId = crypto.randomUUID();
  const now = new Date().toISOString();
  const position = Math.floor(pos as number);
  await c.env.DB
    .prepare(
      `INSERT INTO webinar_cta_clicks
         (id, booking_id, cta_item_id, position_seconds, clicked_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(clickId, b.booking_id, ctaId, position, now)
    .run();
  // CTA クリックは毎回発火 (冪等性は automations 側で扱う場合に備えて
  // ctaItemId / positionSeconds を eventData に含める)
  await fireWebinarEvent(c.env, 'webinar_cta_clicked', b.friend_id, b.account_id, {
    eventId: b.event_id,
    bookingId: b.booking_id,
    ctaItemId: ctaId,
    positionSeconds: position,
  });

  // Phase 6b: action_type='url' / 'tracked_link' のときカート期間切替を判定。
  //   - cart_open  (closes_at > now かつ purchased_at IS NULL): action_value
  //   - cart_closed: cart_expired_redirect_url があればそちら、なければ action_value
  //   - cart_relative_close_minutes が未設定の event: action_value そのまま (=切替なし)
  let redirectUrl: string | null = null;
  let cartState: 'no_cart' | 'open' | 'closed' = 'no_cart';
  if (
    (cta.action_type === 'url' || cta.action_type === 'tracked_link') &&
    cta.action_value
  ) {
    if (b.cart_relative_close_minutes && b.cart_relative_close_minutes > 0) {
      const status = await c.env.DB
        .prepare(
          `SELECT closes_at, purchased_at FROM event_cart_status WHERE booking_id = ?`,
        )
        .bind(b.booking_id)
        .first<{ closes_at: string | null; purchased_at: string | null }>();
      const closesMs = status?.closes_at ? new Date(status.closes_at).getTime() : null;
      const isOpen =
        status != null &&
        status.purchased_at == null &&
        closesMs != null &&
        closesMs > Date.now();
      if (isOpen) {
        cartState = 'open';
        redirectUrl = cta.action_value;
      } else {
        cartState = 'closed';
        redirectUrl = b.cart_expired_redirect_url ?? cta.action_value;
      }
    } else {
      redirectUrl = cta.action_value;
    }
  }

  return c.json({ ok: true, redirect_url: redirectUrl, cart_state: cartState });
});

webinar.post('/api/liff/webinar/:bookingId/event/completed', async (c) => {
  const auth = await authorizeLiffBooking(c);
  if (!auth.ok) return bad(c, auth.code, auth.status);
  const b = auth.booking;
  const now = new Date().toISOString();
  const isFirst = b.webinar_completed_at == null;
  // 既に completed なら no-op (COALESCE)
  await c.env.DB
    .prepare(
      `UPDATE event_bookings
          SET webinar_completed_at = COALESCE(webinar_completed_at, ?), updated_at = ?
        WHERE id = ?`,
    )
    .bind(now, now, b.booking_id)
    .run();
  if (isFirst) {
    await fireWebinarEvent(c.env, 'webinar_completed', b.friend_id, b.account_id, {
      eventId: b.event_id,
      bookingId: b.booking_id,
    });
  }

  // Phase 6b: 視聴完了時にカート期間を開く。
  //   events.cart_relative_close_minutes が NULL なら何もしない。
  //   既に event_cart_status の opened_at が打たれていれば再度開かない (冪等)。
  let cart: {
    opened_at: string;
    closes_at: string;
    already_open: boolean;
  } | null = null;
  if (b.cart_relative_close_minutes && b.cart_relative_close_minutes > 0) {
    const existing = await c.env.DB
      .prepare(
        `SELECT id, opened_at, closes_at FROM event_cart_status WHERE booking_id = ?`,
      )
      .bind(b.booking_id)
      .first<{ id: string; opened_at: string | null; closes_at: string | null }>();
    if (existing && existing.opened_at) {
      cart = {
        opened_at: existing.opened_at,
        closes_at: existing.closes_at ?? '',
        already_open: true,
      };
    } else {
      const closesAtMs = Date.now() + b.cart_relative_close_minutes * 60_000;
      const closesAtIso = new Date(closesAtMs).toISOString();
      const updatedAt = now;
      if (existing) {
        await c.env.DB
          .prepare(
            `UPDATE event_cart_status
                SET opened_at = ?, closes_at = ?, updated_at = ?
              WHERE id = ?`,
          )
          .bind(now, closesAtIso, updatedAt, existing.id)
          .run();
      } else {
        const cartId = crypto.randomUUID();
        try {
          await c.env.DB
            .prepare(
              `INSERT INTO event_cart_status
                 (id, event_id, booking_id, friend_id, opened_at, closes_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(cartId, b.event_id, b.booking_id, b.friend_id, now, closesAtIso)
            .run();
        } catch (e) {
          // 並列実行で UNIQUE(booking_id) に衝突したら opened_at が既にある側を優先
          console.error('event_cart_status insert race fallback:', e);
        }
      }
      cart = { opened_at: now, closes_at: closesAtIso, already_open: false };
    }
  }

  return c.json({ ok: true, cart });
});

// ============================================================
// Phase 6a: event_slot_recurrence CRUD (admin)
// ============================================================

interface RecurrenceInput {
  pattern_type?: string;
  weekdays?: number[] | null;
  weekdays_json?: string | null;
  times?: string[];
  times_json?: string;
  duration_minutes?: number;
  capacity?: number | null;
  generate_days_ahead?: number;
  timezone?: string;
  is_active?: number;
}

function validateRecurrenceInput(
  body: Record<string, unknown>,
  isCreate: boolean,
): { ok: true; weekdaysJson: string | null; timesJson: string } | { ok: false; code: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (isCreate || has('pattern_type')) {
    const v = body.pattern_type;
    if (v !== 'daily' && v !== 'weekly') return { ok: false, code: 'invalid_pattern_type' };
  }

  // times: array of "HH:MM"。受け取りは times (array) または times_json (string).
  let timesJson = '';
  if (isCreate || has('times') || has('times_json')) {
    let arr: unknown;
    if (has('times')) {
      arr = body.times;
    } else if (has('times_json') && typeof body.times_json === 'string') {
      try {
        arr = JSON.parse(body.times_json as string);
      } catch {
        return { ok: false, code: 'invalid_times_json' };
      }
    } else if (isCreate) {
      return { ok: false, code: 'times_required' };
    }
    if (!Array.isArray(arr) || arr.length === 0) {
      return { ok: false, code: 'invalid_times' };
    }
    for (const t of arr) {
      if (typeof t !== 'string' || !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) {
        return { ok: false, code: 'invalid_times' };
      }
    }
    timesJson = JSON.stringify(arr);
  }

  // weekdays: array of 0..6 (weekly のみ意味あり)
  let weekdaysJson: string | null = null;
  if (has('weekdays') || has('weekdays_json')) {
    let arr: unknown = null;
    if (has('weekdays')) {
      arr = body.weekdays;
    } else if (typeof body.weekdays_json === 'string') {
      try {
        arr = JSON.parse(body.weekdays_json as string);
      } catch {
        return { ok: false, code: 'invalid_weekdays_json' };
      }
    }
    if (arr != null) {
      if (!Array.isArray(arr)) return { ok: false, code: 'invalid_weekdays' };
      for (const w of arr as unknown[]) {
        if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > 6) {
          return { ok: false, code: 'invalid_weekdays' };
        }
      }
      weekdaysJson = JSON.stringify(arr);
    }
  }

  if (isCreate || has('duration_minutes')) {
    const v = body.duration_minutes;
    if (!Number.isInteger(v) || (v as number) <= 0 || (v as number) > 24 * 60) {
      return { ok: false, code: 'invalid_duration_minutes' };
    }
  }

  if (has('capacity') && body.capacity != null) {
    const v = body.capacity;
    if (!Number.isInteger(v) || (v as number) < 0) {
      return { ok: false, code: 'invalid_capacity' };
    }
  }

  if (has('generate_days_ahead')) {
    const v = body.generate_days_ahead;
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 365) {
      return { ok: false, code: 'invalid_generate_days_ahead' };
    }
  }

  if (has('timezone') && body.timezone != null) {
    if (typeof body.timezone !== 'string' || (body.timezone as string).length > 64) {
      return { ok: false, code: 'invalid_timezone' };
    }
  }

  if (has('is_active') && body.is_active !== 0 && body.is_active !== 1) {
    return { ok: false, code: 'invalid_is_active' };
  }

  return { ok: true, weekdaysJson, timesJson };
}

webinar.get('/api/events/admin/events/:id/recurrence', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM event_slot_recurrence
        WHERE event_id = ?
        ORDER BY created_at ASC`,
    )
    .bind(id)
    .all();
  return c.json({ items: results ?? [] });
});

webinar.post('/api/events/admin/events/:id/recurrence', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateRecurrenceInput(body, true);
  if (!v.ok) return bad(c, v.code, 422);

  const recId = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO event_slot_recurrence (
         id, event_id, pattern_type, weekdays_json, times_json,
         duration_minutes, capacity, generate_days_ahead, timezone, is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      recId,
      id,
      body.pattern_type as string,
      v.weekdaysJson,
      v.timesJson,
      body.duration_minutes as number,
      (body.capacity as number | null | undefined) ?? null,
      (body.generate_days_ahead as number | undefined) ?? 14,
      (body.timezone as string | undefined) ?? 'Asia/Tokyo',
      (body.is_active as number | undefined) ?? 1,
    )
    .run();
  const row = await c.env.DB
    .prepare(`SELECT * FROM event_slot_recurrence WHERE id = ?`)
    .bind(recId)
    .first();
  return c.json(row, 201);
});

webinar.put('/api/events/admin/events/:id/recurrence/:recId', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  const recId = c.req.param('recId');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const existing = await c.env.DB
    .prepare(`SELECT id FROM event_slot_recurrence WHERE id = ? AND event_id = ?`)
    .bind(recId, id)
    .first<{ id: string }>();
  if (!existing) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateRecurrenceInput(body, false);
  if (!v.ok) return bad(c, v.code, 422);

  const updates: Array<[string, unknown]> = [];
  if (Object.prototype.hasOwnProperty.call(body, 'pattern_type')) {
    updates.push(['pattern_type', body.pattern_type]);
  }
  if (
    Object.prototype.hasOwnProperty.call(body, 'weekdays') ||
    Object.prototype.hasOwnProperty.call(body, 'weekdays_json')
  ) {
    updates.push(['weekdays_json', v.weekdaysJson]);
  }
  if (
    Object.prototype.hasOwnProperty.call(body, 'times') ||
    Object.prototype.hasOwnProperty.call(body, 'times_json')
  ) {
    updates.push(['times_json', v.timesJson]);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'duration_minutes')) {
    updates.push(['duration_minutes', body.duration_minutes]);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'capacity')) {
    updates.push(['capacity', body.capacity ?? null]);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'generate_days_ahead')) {
    updates.push(['generate_days_ahead', body.generate_days_ahead]);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'timezone')) {
    updates.push(['timezone', body.timezone]);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'is_active')) {
    updates.push(['is_active', body.is_active]);
  }

  if (updates.length === 0) {
    const row = await c.env.DB
      .prepare(`SELECT * FROM event_slot_recurrence WHERE id = ?`)
      .bind(recId)
      .first();
    return c.json(row);
  }
  const now = new Date().toISOString();
  const setClauses = updates.map(([k]) => `${k} = ?`);
  setClauses.push(`updated_at = ?`);
  const values = updates.map(([, v]) => v);
  values.push(now);
  values.push(recId);
  await c.env.DB
    .prepare(
      `UPDATE event_slot_recurrence SET ${setClauses.join(', ')} WHERE id = ?`,
    )
    .bind(...values)
    .run();
  const row = await c.env.DB
    .prepare(`SELECT * FROM event_slot_recurrence WHERE id = ?`)
    .bind(recId)
    .first();
  return c.json(row);
});

webinar.delete('/api/events/admin/events/:id/recurrence/:recId', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  const recId = c.req.param('recId');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const result = await c.env.DB
    .prepare(`DELETE FROM event_slot_recurrence WHERE id = ? AND event_id = ?`)
    .bind(recId, id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) return bad(c, 'not_found', 404);
  return new Response(null, { status: 204 });
});

// 手動実行 (テスト・運用補助用). cron を待たずに即座に生成する。
webinar.post('/api/events/admin/events/:id/recurrence/:recId/run-now', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  const recId = c.req.param('recId');
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);

  const rec = await c.env.DB
    .prepare(`SELECT * FROM event_slot_recurrence WHERE id = ? AND event_id = ?`)
    .bind(recId, id)
    .first<RecurrenceRow>();
  if (!rec) return bad(c, 'not_found', 404);

  const result = await generateSlotsForRecurrence(c.env.DB, rec);
  return c.json(result);
});

// ============================================================
// Phase 6b: cart period status helpers
// ============================================================
// 視聴完了 (POST /event/completed) のハンドラから event_cart_status を作成する
// ヘルパは routes/webinar.ts 内 completed ハンドラ側に inline で実装する
// (`events.cart_relative_close_minutes` をその場で確認するだけのため).
//
// CTA クリック時に redirect_url を判定するのも cta-click ハンドラ側に inline。
//
// このセクションには Phase 6b 用の追加 endpoint は持たない (events 設定の更新は
// 既存 events.ts の updateEvent endpoint が cart_relative_close_minutes /
// cart_expired_redirect_url カラムを通すように events.ts 側で対応する).

export default webinar;
