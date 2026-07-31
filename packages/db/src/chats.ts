import { jstNow, toJstString } from './utils.js';
// オペレーター＆チャット管理クエリヘルパー

export const DEFAULT_CHAT_RESPONSE_MINUTES = 24 * 60;

export interface OperatorRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ChatRow {
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
}

// --- オペレーター ---

export async function getOperators(db: D1Database): Promise<OperatorRow[]> {
  const result = await db.prepare(`SELECT * FROM operators ORDER BY created_at DESC`).all<OperatorRow>();
  return result.results;
}

export async function getOperatorById(db: D1Database, id: string): Promise<OperatorRow | null> {
  return db.prepare(`SELECT * FROM operators WHERE id = ?`).bind(id).first<OperatorRow>();
}

export async function createOperator(
  db: D1Database,
  input: { name: string; email: string; role?: string },
): Promise<OperatorRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO operators (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, input.name, input.email, input.role ?? 'operator', now, now).run();
  return (await getOperatorById(db, id))!;
}

export async function updateOperator(
  db: D1Database,
  id: string,
  updates: Partial<{ name: string; email: string; role: string; isActive: boolean }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.email !== undefined) { sets.push('email = ?'); values.push(updates.email); }
  if (updates.role !== undefined) { sets.push('role = ?'); values.push(updates.role); }
  if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE operators SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

export async function deleteOperator(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM operators WHERE id = ?`).bind(id).run();
}

// --- チャット ---

export async function getChats(db: D1Database, opts: { status?: string; operatorId?: string } = {}): Promise<ChatRow[]> {
  if (opts.status && opts.operatorId) {
    const result = await db.prepare(`SELECT * FROM chats WHERE status = ? AND operator_id = ? ORDER BY last_message_at DESC`)
      .bind(opts.status, opts.operatorId).all<ChatRow>();
    return result.results;
  }
  if (opts.status) {
    const result = await db.prepare(`SELECT * FROM chats WHERE status = ? ORDER BY last_message_at DESC`)
      .bind(opts.status).all<ChatRow>();
    return result.results;
  }
  if (opts.operatorId) {
    const result = await db.prepare(`SELECT * FROM chats WHERE operator_id = ? ORDER BY last_message_at DESC`)
      .bind(opts.operatorId).all<ChatRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM chats ORDER BY last_message_at DESC`).all<ChatRow>();
  return result.results;
}

export async function getChatById(db: D1Database, id: string): Promise<ChatRow | null> {
  return db.prepare(`SELECT * FROM chats WHERE id = ?`).bind(id).first<ChatRow>();
}

export async function getChatByFriendId(db: D1Database, friendId: string): Promise<ChatRow | null> {
  return db.prepare(`SELECT * FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1`).bind(friendId).first<ChatRow>();
}

export async function createChat(
  db: D1Database,
  input: { friendId: string; operatorId?: string },
): Promise<ChatRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const dueAt = chatResponseDeadline(now);
  await db.prepare(
    `INSERT INTO chats
       (id, friend_id, operator_id, last_message_at, opened_at, due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.friendId, input.operatorId ?? null, now, now, dueAt, now, now).run();
  return (await getChatById(db, id))!;
}

export function chatResponseDeadline(openedAt: string): string {
  return toJstString(new Date(new Date(openedAt).getTime() + DEFAULT_CHAT_RESPONSE_MINUTES * 60_000));
}

export async function updateChat(
  db: D1Database,
  id: string,
  updates: Partial<{ operatorId: string | null; status: string; priority: string; notes: string | null; lastMessageAt: string; dueAt: string | null; openedAt: string | null; firstResponseAt: string | null; firstResponseOperatorId: string | null; resolvedAt: string | null }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.operatorId !== undefined) { sets.push('operator_id = ?'); values.push(updates.operatorId); }
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.priority !== undefined) { sets.push('priority = ?'); values.push(updates.priority); }
  if (updates.notes !== undefined) { sets.push('notes = ?'); values.push(updates.notes); }
  if (updates.lastMessageAt !== undefined) { sets.push('last_message_at = ?'); values.push(updates.lastMessageAt); }
  if (updates.dueAt !== undefined) { sets.push('due_at = ?'); values.push(updates.dueAt); }
  if (updates.openedAt !== undefined) { sets.push('opened_at = ?'); values.push(updates.openedAt); }
  if (updates.firstResponseAt !== undefined) { sets.push('first_response_at = ?'); values.push(updates.firstResponseAt); }
  if (updates.firstResponseOperatorId !== undefined) { sets.push('first_response_operator_id = ?'); values.push(updates.firstResponseOperatorId); }
  if (updates.resolvedAt !== undefined) { sets.push('resolved_at = ?'); values.push(updates.resolvedAt); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);
  await db.prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}

/** 友だちからメッセージ受信時にチャットを作成/更新 */
export async function upsertChatOnMessage(db: D1Database, friendId: string): Promise<ChatRow> {
  const existing = await getChatByFriendId(db, friendId);
  const now = jstNow();
  if (existing) {
    if (existing.status === 'resolved') {
      await updateChat(db, existing.id, {
        status: 'unread',
        priority: 'normal',
        lastMessageAt: now,
        openedAt: now,
        dueAt: chatResponseDeadline(now),
        firstResponseAt: null,
        firstResponseOperatorId: null,
        resolvedAt: null,
      });
    } else {
      await updateChat(db, existing.id, {
        status: existing.status,
        lastMessageAt: now,
        ...(existing.opened_at ? {} : {
          openedAt: now,
          dueAt: chatResponseDeadline(now),
        }),
      });
    }
    return (await getChatById(db, existing.id))!;
  }
  return createChat(db, { friendId });
}

/**
 * Record a successful human-operated send in the chat workflow.
 * A send against an active inbound cycle is the first response. A proactive
 * send from a resolved/no-chat state starts work but is not counted as a reply.
 */
export async function recordManualChatMessage(
  db: D1Database,
  friendId: string,
  sentAt = jstNow(),
): Promise<ChatRow> {
  let chat = await getChatByFriendId(db, friendId);
  if (!chat) {
    chat = await createChat(db, { friendId });
    await updateChat(db, chat.id, {
      status: 'in_progress',
      lastMessageAt: sentAt,
      openedAt: sentAt,
      dueAt: chatResponseDeadline(sentAt),
      firstResponseAt: null,
      firstResponseOperatorId: null,
      resolvedAt: null,
    });
    return (await getChatById(db, chat.id))!;
  }

  if (chat.status === 'resolved') {
    await updateChat(db, chat.id, {
      status: 'in_progress',
      priority: 'normal',
      lastMessageAt: sentAt,
      openedAt: sentAt,
      dueAt: chatResponseDeadline(sentAt),
      firstResponseAt: null,
      firstResponseOperatorId: null,
      resolvedAt: null,
    });
  } else {
    const openedAt = chat.opened_at ?? chat.last_message_at ?? sentAt;
    await updateChat(db, chat.id, {
      status: 'in_progress',
      lastMessageAt: sentAt,
      openedAt,
      dueAt: chat.due_at ?? chatResponseDeadline(openedAt),
      ...(chat.first_response_at ? {} : {
        firstResponseAt: sentAt,
        firstResponseOperatorId: chat.operator_id,
      }),
    });
  }

  return (await getChatById(db, chat.id))!;
}
