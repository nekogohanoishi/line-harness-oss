import { Hono } from 'hono';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  ACTION_POSTBACK_PREFIX,
  resolveLinkAction,
  sanitizeSteps,
  type MessageActionRow,
  type MessageActionStep,
} from '../services/message-actions.js';

const messageActions = new Hono<Env>();

interface ActionInput {
  name: string;
  kind: 'postback' | 'link';
  lineAccountId: string | null;
  steps: MessageActionStep[];
  linkUrl: string | null;
  oncePerFriend: boolean;
  repeatReply: string | null;
  deadlineAt: string | null;
  expiredReply: string | null;
  expiredUrl: string | null;
  isActive: boolean;
}

const isHttpUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\/\S+$/.test(v) && v.length <= 2000;
const optionalText = (v: unknown, max: number): string | null | undefined => {
  if (v === null || v === undefined || v === '') return null;
  return typeof v === 'string' && v.length <= max ? v : undefined;
};

/** 保存内容の検証。問題があればエラー文 (画面にそのまま出せる日本語) を返す。 */
export function parseActionInput(body: Record<string, unknown>): { input: ActionInput } | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 50) return { error: '名前は1〜50文字で入力してください' };
  const kind = body.kind === 'link' ? 'link' : body.kind === 'postback' || body.kind === undefined ? 'postback' : null;
  if (!kind) return { error: '種類が正しくありません' };
  const steps = kind === 'postback' ? sanitizeSteps(body.steps ?? []) : [];
  if (!steps) return { error: '動きの設定に不備があります（最大10個まで。タグやシナリオを選び直してください）' };
  if (kind === 'postback' && steps.length === 0) return { error: '押したときの動きを1つ以上設定してください' };
  const linkUrl = kind === 'link' ? body.linkUrl : null;
  if (kind === 'link' && !isHttpUrl(linkUrl)) return { error: '開くページのURLを https:// から入力してください' };
  const deadlineAt = optionalText(body.deadlineAt, 16);
  if (deadlineAt === undefined || (deadlineAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(deadlineAt))) {
    return { error: '締切の日時が正しくありません' };
  }
  const expiredUrl = optionalText(body.expiredUrl, 2000);
  if (expiredUrl === undefined || (expiredUrl && !isHttpUrl(expiredUrl))) return { error: '締切後のURLは https:// から入力してください' };
  const repeatReply = optionalText(body.repeatReply, 2000);
  const expiredReply = optionalText(body.expiredReply, 2000);
  if (repeatReply === undefined || expiredReply === undefined) return { error: '返信の文は2000文字までです' };
  const lineAccountId = optionalText(body.lineAccountId, 64);
  if (lineAccountId === undefined) return { error: 'LINEアカウントの指定が正しくありません' };
  return {
    input: {
      name,
      kind,
      lineAccountId,
      steps,
      linkUrl: kind === 'link' ? (linkUrl as string) : null,
      oncePerFriend: kind === 'postback' && body.oncePerFriend === true,
      repeatReply: kind === 'postback' ? repeatReply : null,
      deadlineAt,
      expiredReply,
      expiredUrl: kind === 'link' ? expiredUrl : null,
      isActive: body.isActive !== false,
    },
  };
}

type StatsRow = { action_id: string; done_friends: number; done_count: number; expired_count: number; opened_count: number; last_at: string | null };

function serialize(row: MessageActionRow, stats?: StatsRow) {
  let steps: unknown = [];
  try {
    steps = JSON.parse(row.steps);
  } catch {
    steps = [];
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    lineAccountId: row.line_account_id,
    steps,
    linkUrl: row.link_url,
    oncePerFriend: row.once_per_friend === 1,
    repeatReply: row.repeat_reply,
    deadlineAt: row.deadline_at,
    expiredReply: row.expired_reply,
    expiredUrl: row.expired_url,
    isActive: row.is_active === 1,
    // ボタンに入れる値。postback はこの data を、リンクは /go/<id> を使う
    postbackData: row.kind === 'postback' ? `${ACTION_POSTBACK_PREFIX}${row.id}` : null,
    linkPath: row.kind === 'link' ? `/go/${row.id}` : null,
    stats: {
      doneFriends: stats?.done_friends ?? 0,
      doneCount: stats?.done_count ?? 0,
      expiredCount: stats?.expired_count ?? 0,
      openedCount: stats?.opened_count ?? 0,
      lastAt: stats?.last_at ?? null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STATS_SQL = `SELECT action_id,
         COUNT(DISTINCT CASE WHEN result = 'done' THEN friend_id END) AS done_friends,
         SUM(CASE WHEN result = 'done' THEN 1 ELSE 0 END) AS done_count,
         SUM(CASE WHEN result = 'expired' THEN 1 ELSE 0 END) AS expired_count,
         SUM(CASE WHEN result = 'opened' THEN 1 ELSE 0 END) AS opened_count,
         MAX(created_at) AS last_at
    FROM message_action_logs`;

// GET /api/message-actions?lineAccountId=xxx
messageActions.get('/api/message-actions', async (c) => {
  const lineAccountId = c.req.query('lineAccountId');
  const where = lineAccountId ? 'WHERE line_account_id IS NULL OR line_account_id = ?' : '';
  const stmt = c.env.DB.prepare(`SELECT * FROM message_actions ${where} ORDER BY created_at DESC`);
  const rows = await (lineAccountId ? stmt.bind(lineAccountId) : stmt).all<MessageActionRow>();
  const stats = await c.env.DB.prepare(`${STATS_SQL} GROUP BY action_id`).all<StatsRow>();
  const statsById = new Map(stats.results.map((s) => [s.action_id, s]));
  return c.json({ success: true, data: rows.results.map((row) => serialize(row, statsById.get(row.id))) });
});

// GET /api/message-actions/:id
messageActions.get('/api/message-actions/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM message_actions WHERE id = ?').bind(id).first<MessageActionRow>();
  if (!row) return c.json({ success: false, error: 'ボタンの動きが見つかりません' }, 404);
  const stats = await c.env.DB.prepare(`${STATS_SQL} WHERE action_id = ? GROUP BY action_id`).bind(id).first<StatsRow>();
  return c.json({ success: true, data: serialize(row, stats ?? undefined) });
});

// POST /api/message-actions
messageActions.post('/api/message-actions', async (c) => {
  const parsed = parseActionInput(await c.req.json<Record<string, unknown>>());
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400);
  const v = parsed.input;
  const id = crypto.randomUUID();
  const now = jstNow();
  await c.env.DB.prepare(
    `INSERT INTO message_actions (id, line_account_id, name, kind, steps, link_url, once_per_friend, repeat_reply, deadline_at, expired_reply, expired_url, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, v.lineAccountId, v.name, v.kind, JSON.stringify(v.steps), v.linkUrl, v.oncePerFriend ? 1 : 0, v.repeatReply, v.deadlineAt, v.expiredReply, v.expiredUrl, v.isActive ? 1 : 0, now, now).run();
  const row = await c.env.DB.prepare('SELECT * FROM message_actions WHERE id = ?').bind(id).first<MessageActionRow>();
  return c.json({ success: true, data: serialize(row as MessageActionRow) }, 201);
});

// PUT /api/message-actions/:id
messageActions.put('/api/message-actions/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id FROM message_actions WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ success: false, error: 'ボタンの動きが見つかりません' }, 404);
  const parsed = parseActionInput(await c.req.json<Record<string, unknown>>());
  if ('error' in parsed) return c.json({ success: false, error: parsed.error }, 400);
  const v = parsed.input;
  await c.env.DB.prepare(
    `UPDATE message_actions SET line_account_id = ?, name = ?, kind = ?, steps = ?, link_url = ?, once_per_friend = ?, repeat_reply = ?,
       deadline_at = ?, expired_reply = ?, expired_url = ?, is_active = ?, updated_at = ? WHERE id = ?`,
  ).bind(v.lineAccountId, v.name, v.kind, JSON.stringify(v.steps), v.linkUrl, v.oncePerFriend ? 1 : 0, v.repeatReply, v.deadlineAt, v.expiredReply, v.expiredUrl, v.isActive ? 1 : 0, jstNow(), id).run();
  const row = await c.env.DB.prepare('SELECT * FROM message_actions WHERE id = ?').bind(id).first<MessageActionRow>();
  return c.json({ success: true, data: serialize(row as MessageActionRow) });
});

// DELETE /api/message-actions/:id
messageActions.delete('/api/message-actions/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM message_actions WHERE id = ?').bind(id).run();
  return c.json({ success: true, data: null });
});

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);

// GET /go/:id — 締切つきリンク。ログインなしで開ける (認証ミドルウェアは /api 以外を通す)
messageActions.get('/go/:id', async (c) => {
  const result = await resolveLinkAction(c.env.DB, c.req.param('id'));
  if (result.status === 'open') return c.redirect(result.url, 302);
  if (result.status === 'expired' && result.url) return c.redirect(result.url, 302);
  const message = result.status === 'expired' ? result.message : 'このリンクは使えません。';
  return c.html(
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>ご案内</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 20px;color:#1f2937;background:#f9fafb}` +
      `p{max-width:480px;margin:0 auto;font-size:17px;line-height:1.8;white-space:pre-wrap}</style></head>` +
      `<body><p>${escapeHtml(message)}</p></body></html>`,
    result.status === 'expired' ? 200 : 404,
  );
});

export { messageActions };
