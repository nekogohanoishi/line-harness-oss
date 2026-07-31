import { describe, expect, test, vi } from 'vitest';
import { recordManualChatMessage, upsertChatOnMessage } from './chats.js';

const baseChat = {
  id: 'chat-1',
  friend_id: 'friend-1',
  operator_id: 'operator-1',
  status: 'unread',
  priority: 'high',
  notes: null,
  last_message_at: '2026-07-28T10:00:00.000+09:00',
  due_at: '2026-07-29T10:00:00.000+09:00',
  opened_at: '2026-07-28T10:00:00.000+09:00',
  first_response_at: null,
  first_response_operator_id: null,
  resolved_at: null,
  created_at: '2026-07-28T10:00:00.000+09:00',
  updated_at: '2026-07-28T10:00:00.000+09:00',
};

function chatDb(chat: typeof baseChat) {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...binds: unknown[]) => {
        calls.push({ sql, binds });
        if (sql.includes('SELECT * FROM chats WHERE friend_id = ?')) {
          return { first: async () => chat };
        }
        if (sql.includes('SELECT * FROM chats WHERE id = ?')) {
          return { first: async () => chat };
        }
        return { run: async () => ({ success: true }) };
      },
    })),
  } as unknown as D1Database;
  return { db, calls };
}

describe('chat SLA lifecycle', () => {
  test('records the first human response only for an active inbound cycle', async () => {
    const { db, calls } = chatDb(baseChat);
    const sentAt = '2026-07-28T10:05:00.000+09:00';

    await recordManualChatMessage(db, 'friend-1', sentAt);

    const update = calls.find((call) => call.sql.includes('UPDATE chats SET'));
    expect(update?.sql).toContain('first_response_at = ?');
    expect(update?.sql).toContain('first_response_operator_id = ?');
    expect(update?.binds).toContain(sentAt);
    expect(update?.binds).toContain('operator-1');
  });

  test('starts a fresh 24-hour cycle when a resolved chat receives a message', async () => {
    const resolved = {
      ...baseChat,
      status: 'resolved',
      due_at: null,
      opened_at: null,
      first_response_at: '2026-07-27T09:10:00.000+09:00',
      first_response_operator_id: 'operator-1',
      resolved_at: '2026-07-27T09:20:00.000+09:00',
    };
    const { db, calls } = chatDb(resolved);

    await upsertChatOnMessage(db, 'friend-1');

    const update = calls.find((call) => call.sql.includes('UPDATE chats SET'));
    expect(update?.sql).toContain('status = ?');
    expect(update?.sql).toContain('due_at = ?');
    expect(update?.sql).toContain('first_response_at = ?');
    expect(update?.binds[0]).toBe('unread');
    expect(update?.binds[1]).toBe('normal');
    expect(update?.binds).toContain(null);
    const dueAt = update?.binds[3] as string;
    const openedAt = update?.binds[4] as string;
    expect(new Date(dueAt).getTime() - new Date(openedAt).getTime()).toBe(24 * 60 * 60_000);
  });
});
