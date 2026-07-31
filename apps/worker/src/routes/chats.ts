import { Hono } from 'hono';
import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getOperators,
  getOperatorById,
  createOperator,
  updateOperator,
  deleteOperator,
  getChats,
  getChatById,
  createChat,
  getFriendById,
  getLineAccountById,
  updateChat,
  jstNow,
  toJstString,
  chatResponseDeadline,
  recordManualChatMessage,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { expandVariables, resolveMetadata } from '../services/step-delivery.js';

const chats = new Hono<Env>();

function clampLoadingSeconds(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : 5;
  return Math.min(60, Math.max(5, n));
}

async function startLoadingAnimation(
  accessToken: string,
  chatId: string,
  loadingSeconds: number,
): Promise<void> {
  const response = await fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chatId, loadingSeconds }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      detail
        ? `LINE API error: ${response.status} - ${detail}`
        : `LINE API error: ${response.status}`,
    );
  }
}

type ChatLike = {
  id: string;
  friend_id: string;
  operator_id: string | null;
  status: string;
  priority: string;
  notes: string | null;
  last_message_at: string | null;
  due_at: string | null;
  opened_at: string | null;
  first_response_at: string | null;
  first_response_operator_id: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const CHAT_STATUSES = new Set(['unread', 'in_progress', 'resolved']);
const CHAT_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

function firstResponseSeconds(openedAt: string | null, firstResponseAt: string | null): number | null {
  if (!openedAt || !firstResponseAt) return null;
  const elapsed = Math.round((new Date(firstResponseAt).getTime() - new Date(openedAt).getTime()) / 1000);
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : null;
}

// id は chats.id もしくは friend.id のどちらか。friend.id のときは chats 行を遅延作成する。
// push / broadcast / scenario 配信だけを受けた友だちもチャット画面に現れるため、ここで lazy create が必要。
// 新規作成する場合は status='resolved' にし、last_message_at は messages_log の実際の最終時刻を使う
// （jstNow を入れると一覧並び順が壊れるため）。
async function resolveOrCreateChat(db: D1Database, id: string): Promise<ChatLike | null> {
  const existing = await getChatById(db, id);
  if (existing) return existing as ChatLike;
  const friend = await getFriendById(db, id);
  if (!friend) return null;
  const byFriend = await db
    .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at ASC LIMIT 1`)
    .bind(friend.id)
    .first<ChatLike>();
  if (byFriend) return byFriend;

  const lastMsg = await db
    .prepare(
      `SELECT MAX(created_at) AS last FROM messages_log WHERE friend_id = ? AND (delivery_type IS NULL OR delivery_type != 'test')`,
    )
    .bind(friend.id)
    .first<{ last: string | null }>();
  const newId = crypto.randomUUID();
  const now = jstNow();
  const lastMessageAt = lastMsg?.last ?? null;
  // 同時実行で二重挿入されないように WHERE NOT EXISTS で原子挿入。挿入結果に関わらず最古行を返して収束。
  await db
    .prepare(
      `INSERT INTO chats (id, friend_id, status, last_message_at, created_at, updated_at)
       SELECT ?, ?, 'resolved', ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM chats WHERE friend_id = ?)`,
    )
    .bind(newId, friend.id, lastMessageAt, now, now, friend.id)
    .run();
  return (await db
    .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at ASC LIMIT 1`)
    .bind(friend.id)
    .first<ChatLike>())!;
}

async function resolveFriendAndAccessToken(
  db: D1Database,
  friendId: string,
  defaultAccessToken: string,
) {
  const friend = await getFriendById(db, friendId);
  if (!friend) {
    return { friend: null, accessToken: defaultAccessToken };
  }

  if (!friend.line_account_id) {
    return { friend, accessToken: defaultAccessToken };
  }

  const account = await getLineAccountById(db, friend.line_account_id);
  if (!account) {
    return { friend, accessToken: defaultAccessToken };
  }

  return { friend, accessToken: account.channel_access_token };
}

// ========== オペレーターCRUD ==========

chats.get('/api/operators', async (c) => {
  try {
    const items = await getOperators(c.env.DB);
    return c.json({
      success: true,
      data: items.map((o) => ({
        id: o.id,
        name: o.name,
        email: o.email,
        role: o.role,
        isActive: Boolean(o.is_active),
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/operators', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; role?: string }>();
    if (!body.name || !body.email) return c.json({ success: false, error: 'name and email are required' }, 400);
    const item = await createOperator(c.env.DB, body);
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        email: item.email,
        role: item.role,
        isActive: Boolean(item.is_active),
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.put('/api/operators/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateOperator(c.env.DB, id, body);
    const updated = await getOperatorById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.delete('/api/operators/:id', async (c) => {
  try {
    await deleteOperator(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== チャットCRUD ==========

function normalizeFriendIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const friendIds = [...new Set(
    value.filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter(Boolean),
  )];
  if (friendIds.length === 0 || friendIds.length > 100 || friendIds.length !== value.length) {
    return null;
  }
  return friendIds;
}

chats.get('/api/chats/unread-count', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const lineAccountId = c.req.query('lineAccountId');
    const accountCondition = lineAccountId ? 'AND f.line_account_id = ?' : '';
    const bindings: unknown[] = [staffId];
    if (lineAccountId) bindings.push(lineAccountId);

    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT m.friend_id
         FROM messages_log m
         INNER JOIN friends f ON f.id = m.friend_id
         LEFT JOIN chat_read_receipts rr
           ON rr.friend_id = m.friend_id AND rr.staff_id = ?
         WHERE m.direction = 'incoming'
           AND (m.delivery_type IS NULL OR m.delivery_type != 'test')
           ${accountCondition}
         GROUP BY m.friend_id, rr.last_read_at
         HAVING MAX(m.created_at) > COALESCE(rr.last_read_at, '')
       ) unread_friends`,
    ).bind(...bindings).first<{ count: number }>();

    return c.json({ success: true, data: { count: row?.count ?? 0 } });
  } catch (err) {
    console.error('GET /api/chats/unread-count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats/counts', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const tagId = c.req.query('tagId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const priority = c.req.query('priority') ?? undefined;
    const conditions: string[] = [];
    const bindings: unknown[] = [jstNow(), staffId];

    if (priority && !CHAT_PRIORITIES.has(priority)) {
      return c.json({ success: false, error: 'Invalid priority' }, 400);
    }

    if (operatorId === 'unassigned') {
      conditions.push('c.operator_id IS NULL');
    } else if (operatorId) {
      conditions.push('c.operator_id = ?');
      bindings.push(operatorId);
    }
    if (tagId) {
      conditions.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
      bindings.push(tagId);
    }
    if (lineAccountId) {
      conditions.push('f.line_account_id = ?');
      bindings.push(lineAccountId);
    }
    if (priority) {
      conditions.push(`COALESCE(c.priority, 'normal') = ?`);
      bindings.push(priority);
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = await c.env.DB.prepare(
      `WITH activity AS (
         SELECT friend_id, MAX(created_at) AS last_message_at
         FROM messages_log
         WHERE delivery_type IS NULL OR delivery_type != 'test'
         GROUP BY friend_id
         UNION ALL
         SELECT friend_id, last_message_at FROM chats
       ),
       deduped AS (
         SELECT friend_id, MAX(last_message_at) AS last_message_at
         FROM activity
         GROUP BY friend_id
       ),
       latest_incoming AS (
         SELECT friend_id, MAX(created_at) AS latest_incoming_at
         FROM messages_log
         WHERE direction = 'incoming'
           AND (delivery_type IS NULL OR delivery_type != 'test')
         GROUP BY friend_id
       )
       SELECT
         COUNT(*) AS all_count,
         COALESCE(SUM(CASE
           WHEN li.latest_incoming_at IS NOT NULL
             AND (rr.last_read_at IS NULL OR li.latest_incoming_at > rr.last_read_at)
           THEN 1 ELSE 0 END), 0) AS unread_message_count,
         COALESCE(SUM(CASE WHEN COALESCE(c.status, 'resolved') = 'unread' THEN 1 ELSE 0 END), 0) AS unhandled_count,
         COALESCE(SUM(CASE WHEN COALESCE(c.status, 'resolved') = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
         COALESCE(SUM(CASE
           WHEN COALESCE(c.status, 'resolved') != 'resolved'
             AND c.due_at IS NOT NULL AND c.due_at < ?
           THEN 1 ELSE 0 END), 0) AS overdue_count,
         COALESCE(SUM(CASE WHEN COALESCE(c.status, 'resolved') = 'resolved' THEN 1 ELSE 0 END), 0) AS resolved_count
       FROM deduped d
       INNER JOIN friends f ON f.id = d.friend_id
       LEFT JOIN chats c ON c.id = (
         SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
       )
       LEFT JOIN latest_incoming li ON li.friend_id = f.id
       LEFT JOIN chat_read_receipts rr
         ON rr.friend_id = f.id AND rr.staff_id = ?
       ${whereSql}`,
    ).bind(...bindings).first<Record<string, number | string | null>>();

    return c.json({
      success: true,
      data: {
        all: Number(row?.all_count ?? 0),
        unreadMessages: Number(row?.unread_message_count ?? 0),
        unhandled: Number(row?.unhandled_count ?? 0),
        inProgress: Number(row?.in_progress_count ?? 0),
        overdue: Number(row?.overdue_count ?? 0),
        resolved: Number(row?.resolved_count ?? 0),
      },
    });
  } catch (err) {
    console.error('GET /api/chats/counts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats/operator-metrics', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const now = jstNow();
    const periodDays = 30;
    const periodStart = toJstString(new Date(Date.now() - periodDays * 24 * 60 * 60_000));
    const accountCondition = lineAccountId ? 'AND f.line_account_id = ?' : '';

    const currentBindings: unknown[] = [now];
    if (lineAccountId) currentBindings.push(lineAccountId);
    const historyBindings: unknown[] = [periodStart];
    if (lineAccountId) historyBindings.push(lineAccountId);

    const [operatorRows, currentRows, resolvedRows, responseRows] = await Promise.all([
      getOperators(c.env.DB),
      c.env.DB.prepare(
        `SELECT c.operator_id,
                COUNT(*) AS active_count,
                SUM(CASE WHEN c.due_at IS NOT NULL AND c.due_at < ? THEN 1 ELSE 0 END) AS overdue_count
         FROM chats c
         INNER JOIN friends f ON f.id = c.friend_id
         WHERE c.status != 'resolved' ${accountCondition}
         GROUP BY c.operator_id`,
      ).bind(...currentBindings).all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT e.operator_id, COUNT(*) AS resolved_count
         FROM chat_resolution_events e
         INNER JOIN friends f ON f.id = e.friend_id
         WHERE e.resolved_at >= ? ${accountCondition}
         GROUP BY e.operator_id`,
      ).bind(...historyBindings).all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT e.first_response_operator_id AS operator_id,
                COUNT(*) AS response_sample_count,
                AVG(e.first_response_seconds) AS avg_first_response_seconds
         FROM chat_resolution_events e
         INNER JOIN friends f ON f.id = e.friend_id
         WHERE e.resolved_at >= ?
           AND e.first_response_seconds IS NOT NULL
           ${accountCondition}
         GROUP BY e.first_response_operator_id`,
      ).bind(...historyBindings).all<Record<string, unknown>>(),
    ]);

    const currentByOperator = new Map<string | null, Record<string, unknown>>();
    for (const row of currentRows.results) {
      currentByOperator.set((row.operator_id as string | null) ?? null, row);
    }
    const resolvedByOperator = new Map<string | null, Record<string, unknown>>();
    for (const row of resolvedRows.results) {
      resolvedByOperator.set((row.operator_id as string | null) ?? null, row);
    }
    const responseByOperator = new Map<string | null, Record<string, unknown>>();
    for (const row of responseRows.results) {
      responseByOperator.set((row.operator_id as string | null) ?? null, row);
    }

    const knownIds = new Set(operatorRows.map((operator) => operator.id));
    const extraIds = new Set<string>();
    for (const id of [
      ...currentByOperator.keys(),
      ...resolvedByOperator.keys(),
      ...responseByOperator.keys(),
    ]) {
      if (id && !knownIds.has(id)) extraIds.add(id);
    }
    const metricOperators = [
      ...operatorRows.map((operator) => ({
        id: operator.id as string | null,
        name: operator.name,
        isActive: Boolean(operator.is_active),
      })),
      ...[...extraIds].map((id) => ({ id: id as string | null, name: '削除済み担当者', isActive: false })),
      { id: null, name: '未割当', isActive: true },
    ];

    return c.json({
      success: true,
      data: {
        periodDays,
        items: metricOperators.map((operator) => {
          const current = currentByOperator.get(operator.id) ?? {};
          const resolved = resolvedByOperator.get(operator.id) ?? {};
          const response = responseByOperator.get(operator.id) ?? {};
          const average = response.avg_first_response_seconds;
          return {
            operatorId: operator.id,
            operatorName: operator.name,
            isActive: operator.isActive,
            active: Number(current.active_count ?? 0),
            overdue: Number(current.overdue_count ?? 0),
            resolved: Number(resolved.resolved_count ?? 0),
            responseSamples: Number(response.response_sample_count ?? 0),
            averageFirstResponseSeconds: average == null ? null : Math.round(Number(average)),
          };
        }),
      },
    });
  } catch (err) {
    console.error('GET /api/chats/operator-metrics error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/chats/read', async (c) => {
  try {
    const body = await c.req.json<{ friendIds?: unknown }>();
    const friendIds = normalizeFriendIds(body.friendIds);
    if (!friendIds) {
      return c.json({ success: false, error: 'friendIds must contain 1 to 100 unique IDs' }, 400);
    }

    const staffId = c.get('staff').id;
    const placeholders = friendIds.map(() => '?').join(', ');
    const readAt = jstNow();
    const result = await c.env.DB.prepare(
      `INSERT INTO chat_read_receipts (friend_id, staff_id, last_read_at)
       SELECT f.id, ?, COALESCE(MAX(m.created_at), ?)
       FROM friends f
       LEFT JOIN messages_log m
         ON m.friend_id = f.id
        AND m.direction = 'incoming'
        AND (m.delivery_type IS NULL OR m.delivery_type != 'test')
       WHERE f.id IN (${placeholders})
       GROUP BY f.id
       ON CONFLICT(friend_id, staff_id)
       DO UPDATE SET last_read_at = CASE
         WHEN excluded.last_read_at > chat_read_receipts.last_read_at
           THEN excluded.last_read_at
         ELSE chat_read_receipts.last_read_at
       END`,
    ).bind(staffId, readAt, ...friendIds).run();

    return c.json({
      success: true,
      data: { updated: Number(result.meta?.changes ?? 0) },
    });
  } catch (err) {
    console.error('POST /api/chats/read error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/chats/bulk-assign', async (c) => {
  try {
    const body = await c.req.json<{ friendIds?: unknown; operatorId?: unknown }>();
    const friendIds = normalizeFriendIds(body.friendIds);
    if (!friendIds) {
      return c.json({ success: false, error: 'friendIds must contain 1 to 100 unique IDs' }, 400);
    }
    if (body.operatorId !== null && typeof body.operatorId !== 'string') {
      return c.json({ success: false, error: 'operatorId must be a string or null' }, 400);
    }

    const operatorId = body.operatorId as string | null;
    if (operatorId) {
      const operator = await getOperatorById(c.env.DB, operatorId);
      if (!operator || !operator.is_active) {
        return c.json({ success: false, error: 'Active operator not found' }, 404);
      }
    }

    let updated = 0;
    for (const friendId of friendIds) {
      const chat = await resolveOrCreateChat(c.env.DB, friendId);
      if (!chat) continue;
      await updateChat(c.env.DB, chat.id, { operatorId });
      updated += 1;
    }

    return c.json({ success: true, data: { updated } });
  } catch (err) {
    console.error('POST /api/chats/bulk-assign error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/chats/:id/read', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const resolved = await resolveOrCreateChat(c.env.DB, c.req.param('id'));
    if (!resolved) return c.json({ success: false, error: 'Chat not found' }, 404);

    const latest = await c.env.DB
      .prepare(
        `SELECT MAX(created_at) AS latest_incoming_at
         FROM messages_log
         WHERE friend_id = ?
           AND direction = 'incoming'
           AND (delivery_type IS NULL OR delivery_type != 'test')`,
      )
      .bind(resolved.friend_id)
      .first<{ latest_incoming_at: string | null }>();
    const lastReadAt = latest?.latest_incoming_at ?? jstNow();

    await c.env.DB
      .prepare(
        `INSERT INTO chat_read_receipts (friend_id, staff_id, last_read_at)
         VALUES (?, ?, ?)
         ON CONFLICT(friend_id, staff_id)
         DO UPDATE SET last_read_at = CASE
           WHEN excluded.last_read_at > chat_read_receipts.last_read_at
             THEN excluded.last_read_at
           ELSE chat_read_receipts.last_read_at
         END`,
      )
      .bind(resolved.friend_id, staffId, lastReadAt)
      .run();

    return c.json({ success: true, data: { friendId: resolved.friend_id, lastReadAt } });
  } catch (err) {
    console.error('POST /api/chats/:id/read error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const readStatus = c.req.query('readStatus') ?? undefined;
    const tagId = c.req.query('tagId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    const priority = c.req.query('priority') ?? undefined;
    const overdue = c.req.query('overdue') ?? undefined;

    // List everyone who has any message history (incoming or outgoing — push/broadcast/scenario included)
    // PLUS any chats row that exists even before any messages_log entry is written.
    // Source = messages_log ∪ chats.friend_id; chats は status/operator/notes 用に LEFT JOIN で最新1件だけ採用。
    //
    // recent_msg CTE で friend_id ごとに最新の messages_log 行をひとつ取得し、本文 preview と
    // direction (incoming/outgoing) を一覧に出す。
    //
    // パフォーマンス対策:
    //   1. lineAccountId 指定時は scoped_friends CTE で先に対象 friend を絞ってから messages_log
    //      を ranking する (アカ別 inbox が他アカの履歴をスキャンしないように)。
    //   2. content は text のみ先頭 200 文字まで切り詰めて返す (flex/image など raw JSON を返すと
    //      broadcast 後の rows で multi-MB レスポンスになる)。
    const accountFilterSql = lineAccountId
      ? `friend_id IN (SELECT id FROM friends WHERE line_account_id = ?)`
      : `1=1`;
    let sql = `
      WITH activity AS (
        SELECT friend_id, MAX(created_at) AS last_message_at
        FROM messages_log
        WHERE (delivery_type IS NULL OR delivery_type != 'test')
          AND ${accountFilterSql}
        GROUP BY friend_id
        UNION ALL
        SELECT friend_id, last_message_at
        FROM chats
        WHERE ${accountFilterSql}
      ),
      deduped AS (
        SELECT friend_id, MAX(last_message_at) AS last_message_at
        FROM activity
        GROUP BY friend_id
      ),
      -- preview は **最新の incoming (ユーザー発)** を優先する。auto_reply / scenario 等の
      -- outbound が直後に書き込まれて preview を上書きすると「ユーザーが何と言ったか」が
      -- 一覧から見えなくなる (operator triage の主目的が損なわれる)。
      -- incoming が無い (broadcast push など outbound only) chat は最新 outbound にフォールバック。
      -- text 以外 (flex/image/sticker 等) は content を NULL にして payload size を抑える
      -- (フロントは type で 📋 Flex / 📷 画像 等のラベルを出すので content は不要)。
      -- preview は **常に最新メッセージ** を表示する。postback (rich menu tap) も含む。
      -- preview text と displayed time を揃えるための単純化 (deprioritize すると
      -- 「最新は postback だが preview は古い text」の time mismatch が起きるため)。
      -- 注: postback.data が opaque な JSON token だと一覧で人間には読めない値が出るが、
      -- それは admin が rich menu の postback.data を人間向け文言にすべき config 問題。
      -- (LINE 仕様: postback.displayText は admin が設定可能、それを data に揃えるのが推奨)
      ranked_in AS (
        SELECT friend_id,
          CASE WHEN message_type = 'text' THEN SUBSTR(content, 1, 200) ELSE NULL END AS content,
          direction, message_type, created_at,
          ROW_NUMBER() OVER (PARTITION BY friend_id ORDER BY created_at DESC) AS rn
        FROM messages_log
        WHERE direction = 'incoming'
          AND (delivery_type IS NULL OR delivery_type != 'test')
          AND ${accountFilterSql}
      ),
      ranked_any AS (
        SELECT friend_id,
          CASE WHEN message_type = 'text' THEN SUBSTR(content, 1, 200) ELSE NULL END AS content,
          direction, message_type, created_at,
          ROW_NUMBER() OVER (PARTITION BY friend_id ORDER BY created_at DESC) AS rn
        FROM messages_log
        WHERE (delivery_type IS NULL OR delivery_type != 'test')
          AND ${accountFilterSql}
      ),
      -- ra (any direction の最新) を master にして、ri (incoming の最新) を LEFT JOIN。
      -- COALESCE で ri 優先 → incoming があればそれ、無ければ outbound にフォールバック。
      -- created_at も preview の元メッセージに合わせて返す (一覧の時刻と preview text が
      -- 別メッセージを指して mismatch する事故を防ぐ)。
      recent_msg AS (
        SELECT
          ra.friend_id,
          COALESCE(ri.content, ra.content) AS content,
          COALESCE(ri.direction, ra.direction) AS direction,
          COALESCE(ri.message_type, ra.message_type) AS message_type,
          COALESCE(ri.created_at, ra.created_at) AS preview_at,
          ri.created_at AS latest_incoming_at
        FROM (SELECT * FROM ranked_any WHERE rn = 1) ra
        LEFT JOIN (SELECT * FROM ranked_in WHERE rn = 1) ri ON ra.friend_id = ri.friend_id
      )
      SELECT
        f.id AS id,
        f.id AS friend_id,
        f.display_name,
        f.picture_url,
        f.line_user_id,
        f.line_account_id,
        c.operator_id,
        COALESCE(c.status, 'resolved') AS status,
        COALESCE(c.priority, 'normal') AS priority,
        c.notes,
        c.due_at,
        c.opened_at,
        c.first_response_at,
        c.resolved_at,
        -- last_message_at は preview メッセージの時刻に揃える (一覧 row の時刻表示と preview が
        -- 別メッセージを指す mismatch を防ぐ)。preview が無い (chats 行のみ存在) ケースは
        -- d.last_message_at にフォールバック。
        COALESCE(rm.preview_at, d.last_message_at) AS last_message_at,
        rm.content AS last_message_content,
        rm.direction AS last_message_direction,
        rm.message_type AS last_message_type,
        CASE
          WHEN rm.latest_incoming_at IS NOT NULL
            AND (rr.last_read_at IS NULL OR rm.latest_incoming_at > rr.last_read_at)
          THEN 1 ELSE 0
        END AS has_unread_message,
        COALESCE(c.created_at, d.last_message_at) AS created_at,
        COALESCE(c.updated_at, d.last_message_at) AS updated_at
      FROM deduped d
      INNER JOIN friends f ON f.id = d.friend_id
      LEFT JOIN chats c ON c.id = (
        SELECT id FROM chats WHERE friend_id = f.id ORDER BY created_at DESC LIMIT 1
      )
      LEFT JOIN recent_msg rm ON rm.friend_id = f.id
      LEFT JOIN chat_read_receipts rr
        ON rr.friend_id = f.id AND rr.staff_id = ?
    `;
    // accountFilterSql に '?' が複数 (4 箇所) あるので、bindings は事前に積んでおく。
    const ctePrebindings: unknown[] = lineAccountId
      ? [lineAccountId, lineAccountId, lineAccountId, lineAccountId]
      : [];
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (readStatus && readStatus !== 'unread' && readStatus !== 'read') {
      return c.json({ success: false, error: 'readStatus must be unread or read' }, 400);
    }
    if (priority && !CHAT_PRIORITIES.has(priority)) {
      return c.json({ success: false, error: 'Invalid priority' }, 400);
    }
    if (overdue && overdue !== 'true') {
      return c.json({ success: false, error: 'overdue must be true' }, 400);
    }
    if (status) {
      conditions.push(`COALESCE(c.status, 'resolved') = ?`);
      bindings.push(status);
    }
    if (operatorId === 'unassigned') {
      conditions.push('c.operator_id IS NULL');
    } else if (operatorId) {
      conditions.push('c.operator_id = ?');
      bindings.push(operatorId);
    }
    if (readStatus === 'unread') {
      conditions.push(`rm.latest_incoming_at IS NOT NULL
        AND (rr.last_read_at IS NULL OR rm.latest_incoming_at > rr.last_read_at)`);
    } else if (readStatus === 'read') {
      conditions.push(`(rm.latest_incoming_at IS NULL
        OR (rr.last_read_at IS NOT NULL AND rm.latest_incoming_at <= rr.last_read_at))`);
    }
    if (tagId) {
      conditions.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
      bindings.push(tagId);
    }
    if (lineAccountId) {
      conditions.push('f.line_account_id = ?');
      bindings.push(lineAccountId);
    }
    if (priority) {
      conditions.push(`COALESCE(c.priority, 'normal') = ?`);
      bindings.push(priority);
    }
    if (overdue === 'true') {
      conditions.push(`COALESCE(c.status, 'resolved') != 'resolved'`);
      conditions.push('c.due_at IS NOT NULL AND c.due_at < ?');
      bindings.push(jstNow());
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY d.last_message_at DESC';

    // CTE 内 placeholder (4 個) → read receipt → 外側 WHERE の順に bind する
    const allBindings = [...ctePrebindings, staffId, ...bindings];
    const stmt = allBindings.length > 0
      ? c.env.DB.prepare(sql).bind(...allBindings)
      : c.env.DB.prepare(sql);
    const result = await stmt.all();

    return c.json({
      success: true,
      data: result.results.map((ch: Record<string, unknown>) => ({
        id: ch.id,
        friendId: ch.friend_id,
        friendName: ch.display_name || '名前なし',
        friendPictureUrl: ch.picture_url || null,
        operatorId: ch.operator_id,
        status: ch.status,
        priority: ch.priority,
        notes: ch.notes,
        lastMessageAt: ch.last_message_at,
        dueAt: ch.due_at,
        openedAt: ch.opened_at,
        firstResponseAt: ch.first_response_at,
        resolvedAt: ch.resolved_at,
        lastMessageContent: ch.last_message_content || null,
        lastMessageDirection: ch.last_message_direction || null,
        lastMessageType: ch.last_message_type || null,
        hasUnreadMessage: Boolean(ch.has_unread_message),
        createdAt: ch.created_at,
        updatedAt: ch.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats/:id', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const rawId = c.req.param('id');

    // id は chats.id または friend.id のどちらでもOK。
    // 優先順: chats.id 一致 → friend.id のとき chats.friend_id 最新行 → 何も無ければ friend のみで synthetic
    let chatRow = await getChatById(c.env.DB, rawId);
    let friendId: string | null = null;

    if (!chatRow) {
      const friendRow = await getFriendById(c.env.DB, rawId);
      if (!friendRow) return c.json({ success: false, error: 'Chat not found' }, 404);
      friendId = friendRow.id;
      // 同じ friend に紐づく chats 行があれば採用（lazy-create 後の再読みで status/notes を拾うため）
      const existing = await c.env.DB
        .prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(friendRow.id)
        .first<ChatLike>();
      if (existing) {
        chatRow = existing as Awaited<ReturnType<typeof getChatById>>;
      }
    }

    const resolvedFriendId = chatRow?.friend_id ?? friendId!;
    // 公開 ID は常に friend_id に統一する（lazy-create で ID が変わるのを防ぐため）。
    const responseId = resolvedFriendId;
    const operatorId = chatRow?.operator_id ?? null;
    const status = chatRow?.status ?? 'resolved';
    const priority = chatRow?.priority ?? 'normal';
    const notes = chatRow?.notes ?? null;
    const lastMessageAt = chatRow?.last_message_at ?? null;
    const dueAt = chatRow?.due_at ?? null;
    const openedAt = chatRow?.opened_at ?? null;
    const firstResponseAt = chatRow?.first_response_at ?? null;
    const resolvedAt = chatRow?.resolved_at ?? null;
    const createdAt = chatRow?.created_at ?? null;
    const updatedAt = chatRow?.updated_at ?? null;

    const friend = await c.env.DB
      .prepare(`SELECT display_name, picture_url, line_user_id FROM friends WHERE id = ?`)
      .bind(resolvedFriendId)
      .first<{ display_name: string | null; picture_url: string | null; line_user_id: string }>();

    // 新しい1000件を取って昇順に戻す。LIMIT 200 ASC だと古い200件だけで broadcast/scenario 等の
    // 新しい push が欠落していた（Shu で 481件中 281件欠落のバグあり）。一覧側と同様に test 配信は除外。
    // 現状の最重量ユーザー(481件)の2倍バッファ。これ以上の履歴はページング未実装（Phase 2 TODO）。
    const messages = await c.env.DB
      .prepare(
        `SELECT id, friend_id, direction, message_type, content, created_at
         FROM messages_log
         WHERE friend_id = ? AND (delivery_type IS NULL OR delivery_type != 'test')
         ORDER BY created_at DESC LIMIT 1000`,
      )
      .bind(resolvedFriendId)
      .all();
    messages.results = (messages.results as Record<string, unknown>[]).reverse();

    const readState = await c.env.DB.prepare(
      `SELECT li.latest_incoming_at, rr.last_read_at
       FROM (
         SELECT MAX(created_at) AS latest_incoming_at
         FROM messages_log
         WHERE friend_id = ?
           AND direction = 'incoming'
           AND (delivery_type IS NULL OR delivery_type != 'test')
       ) li
       LEFT JOIN chat_read_receipts rr
         ON rr.friend_id = ? AND rr.staff_id = ?`,
    )
      .bind(resolvedFriendId, resolvedFriendId, staffId)
      .first<{ latest_incoming_at: string | null; last_read_at: string | null }>();
    const hasUnreadMessage = Boolean(readState?.latest_incoming_at)
      && (!readState?.last_read_at || readState.latest_incoming_at! > readState.last_read_at);

    return c.json({
      success: true,
      data: {
        id: responseId,
        friendId: resolvedFriendId,
        friendName: friend?.display_name || '名前なし',
        friendPictureUrl: friend?.picture_url || null,
        operatorId,
        status,
        priority,
        notes,
        lastMessageAt,
        dueAt,
        openedAt,
        firstResponseAt,
        resolvedAt,
        hasUnreadMessage,
        createdAt,
        updatedAt,
        messages: (messages.results as Record<string, unknown>[]).map((m) => ({
          id: m.id,
          direction: m.direction,
          messageType: m.message_type,
          content: m.content,
          createdAt: m.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/chats', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; operatorId?: string; lineAccountId?: string | null }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    const item = await createChat(c.env.DB, body);
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE chats SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, friendId: item.friend_id, status: item.status } }, 201);
  } catch (err) {
    console.error('POST /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// チャットのアサイン/ステータス更新/ノート更新
chats.put('/api/chats/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const resolved = await resolveOrCreateChat(c.env.DB, id);
    if (!resolved) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{
      operatorId?: string | null;
      status?: string;
      priority?: string;
      notes?: string | null;
      dueAt?: string | null;
    }>();
    if (body.status && !CHAT_STATUSES.has(body.status)) {
      return c.json({ success: false, error: 'Invalid status' }, 400);
    }
    if (body.priority && !CHAT_PRIORITIES.has(body.priority)) {
      return c.json({ success: false, error: 'Invalid priority' }, 400);
    }
    if (body.dueAt !== undefined && body.dueAt !== null && !Number.isFinite(Date.parse(body.dueAt))) {
      return c.json({ success: false, error: 'Invalid dueAt' }, 400);
    }

    const updates: Parameters<typeof updateChat>[2] = {};
    if (body.operatorId !== undefined) updates.operatorId = body.operatorId;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.dueAt !== undefined) {
      updates.dueAt = body.dueAt === null ? null : toJstString(new Date(body.dueAt));
    }

    const now = jstNow();
    if (body.status === 'resolved' && resolved.status !== 'resolved') {
      updates.status = 'resolved';
      updates.resolvedAt = now;
      await updateChat(c.env.DB, resolved.id, updates);
      await c.env.DB.prepare(
        `INSERT INTO chat_resolution_events
           (id, chat_id, friend_id, operator_id, first_response_operator_id,
            resolved_by_staff_id, priority, opened_at, first_response_at,
            resolved_at, first_response_seconds, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        resolved.id,
        resolved.friend_id,
        body.operatorId !== undefined ? body.operatorId : resolved.operator_id,
        resolved.first_response_operator_id,
        c.get('staff').id,
        body.priority ?? resolved.priority ?? 'normal',
        resolved.opened_at,
        resolved.first_response_at,
        now,
        firstResponseSeconds(resolved.opened_at, resolved.first_response_at),
        now,
      ).run();
    } else {
      if (body.status) updates.status = body.status;
      if (body.status && body.status !== 'resolved' && resolved.status === 'resolved') {
        updates.priority = body.priority ?? 'normal';
        updates.openedAt = now;
        updates.dueAt = body.dueAt === undefined
          ? chatResponseDeadline(now)
          : updates.dueAt;
        updates.firstResponseAt = null;
        updates.firstResponseOperatorId = null;
        updates.resolvedAt = null;
      }
      await updateChat(c.env.DB, resolved.id, updates);
    }
    const updated = await getChatById(c.env.DB, resolved.id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      // 公開 ID は friend_id に統一
      data: {
        id: updated.friend_id,
        friendId: updated.friend_id,
        operatorId: updated.operator_id,
        status: updated.status,
        priority: updated.priority,
        notes: updated.notes,
        dueAt: updated.due_at,
        openedAt: updated.opened_at,
        firstResponseAt: updated.first_response_at,
        resolvedAt: updated.resolved_at,
      },
    });
  } catch (err) {
    console.error('PUT /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// オペレーター入力中のローディング表示を開始
chats.post('/api/chats/:id/loading', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    let loadingSecondsInput: number | undefined;
    try {
      const body = await c.req.json<{ loadingSeconds?: number }>();
      loadingSecondsInput = body.loadingSeconds;
    } catch {
      loadingSecondsInput = undefined;
    }
    const loadingSeconds = clampLoadingSeconds(loadingSecondsInput);

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    await startLoadingAnimation(
      accessToken,
      friend.line_user_id,
      loadingSeconds,
    );

    return c.json({ success: true, data: { started: true, loadingSeconds } });
  } catch (err) {
    console.error('POST /api/chats/:id/loading error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return c.json({ success: false, error: message }, 500);
  }
});

// オペレーターからメッセージ送信
chats.post('/api/chats/:id/send', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await resolveOrCreateChat(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    const body = await c.req.json<{ messageType?: string; content: string }>();
    if (!body.content) return c.json({ success: false, error: 'content is required' }, 400);

    const { friend, accessToken } = await resolveFriendAndAccessToken(
      c.env.DB,
      chat.friend_id,
      c.env.LINE_CHANNEL_ACCESS_TOKEN,
    );
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    // LINE APIでメッセージ送信
    const { LineClient } = await import('@line-crm/line-sdk');
    const lineClient = new LineClient(accessToken);
    const messageType = body.messageType ?? 'text';
    const resolvedMeta = await resolveMetadata(c.env.DB, {
      user_id: (friend as unknown as Record<string, string | null>).user_id,
      metadata: (friend as unknown as Record<string, string | null>).metadata,
    });
    const expandedContent = expandVariables(
      body.content,
      { ...friend, metadata: resolvedMeta } as Parameters<typeof expandVariables>[1],
      c.env.WORKER_URL || new URL(c.req.url).origin,
    );

    if (messageType === 'text') {
      await lineClient.pushTextMessage(friend.line_user_id, expandedContent);
    } else if (messageType === 'flex') {
      const contents = JSON.parse(expandedContent);
      await lineClient.pushFlexMessage(friend.line_user_id, extractFlexAltText(contents), contents);
    }

    // メッセージログに記録
    const logId = crypto.randomUUID();
    const sentAt = jstNow();
    await c.env.DB
      .prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, created_at) VALUES (?, ?, 'outgoing', ?, ?, 'manual', ?)`)
      .bind(logId, friend.id, messageType, expandedContent, sentAt)
      .run();

    await recordManualChatMessage(c.env.DB, chat.friend_id, sentAt);

    return c.json({ success: true, data: { sent: true, messageId: logId } });
  } catch (err) {
    console.error('POST /api/chats/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { chats };
