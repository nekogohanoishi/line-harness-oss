import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent } from './event-bus.js';

interface CapturedInsert {
  sql: string;
  binds: unknown[];
}

function fakeDb(opts: {
  friend?: { line_user_id: string };
  capturedInserts: CapturedInsert[];
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          if (sql.includes('INSERT INTO messages_log')) {
            opts.capturedInserts.push({ sql, binds: args });
          }
          return this;
        },
        async all<T>(): Promise<{ results: T[] }> {
          return { results: [] };
        },
        async first<T>(): Promise<T | null> {
          if (sql.includes('FROM friends WHERE id')) {
            return (opts.friend ?? null) as T | null;
          }
          return null;
        },
        async run(): Promise<{ success: true }> {
          return { success: true };
        },
      };
    },
  } as unknown as D1Database;
}

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@line-crm/db');
  return {
    ...actual,
    getActiveOutgoingWebhooksByEvent: vi.fn().mockResolvedValue([]),
    applyScoring: vi.fn().mockResolvedValue(undefined),
    getActiveAutomationsByEvent: vi.fn(),
    createAutomationLog: vi.fn().mockResolvedValue(undefined),
    getActiveNotificationRulesByEvent: vi.fn().mockResolvedValue([]),
    createNotification: vi.fn().mockResolvedValue(undefined),
    addTagToFriend: vi.fn().mockResolvedValue(undefined),
    removeTagFromFriend: vi.fn().mockResolvedValue(undefined),
    enrollFriendInScenario: vi.fn().mockResolvedValue(undefined),
    jstNow: () => '2026-05-08T00:00:00.000+09:00',
    getFriendScore: vi.fn().mockResolvedValue(0),
    getTemplateById: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('@line-crm/line-sdk', () => {
  return {
    LineClient: vi.fn().mockImplementation(() => ({
      replyMessage: vi.fn().mockResolvedValue(undefined),
      pushMessage: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('./ad-conversion.js', () => ({
  sendAdConversions: vi.fn().mockResolvedValue(undefined),
}));

describe('fireEvent — send_message action logging', () => {
  let captured: CapturedInsert[];

  beforeEach(async () => {
    captured = [];
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-1',
        line_account_id: 'acc-1',
        conditions: JSON.stringify({ keyword: 'コスト比較' }),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: {
              messageType: 'flex',
              content: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"hi"}]}}',
              altText: 'hi',
            },
          },
        ]),
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs flex outgoing message to messages_log when send_message fires via reply', async () => {
    const db = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      db,
      'message_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'コスト比較', matched: true },
        replyToken: 'reply-token-xyz',
      },
      'channel-token',
      'acc-1',
    );

    expect(captured).toHaveLength(1);
    const insert = captured[0];
    expect(insert.sql).toContain('INSERT INTO messages_log');
    // bind order: id, friendId, messageType, content, deliveryType, source, lineAccountId, createdAt
    expect(insert.binds[1]).toBe('friend-1');
    expect(insert.binds[2]).toBe('flex');
    expect(insert.binds[4]).toBe('reply');
    expect(insert.binds[5]).toBe('automation');
    expect(insert.binds[6]).toBe('acc-1');
  });

  it('logs delivery_type=push when no replyToken provided', async () => {
    const db = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      db,
      'message_received',
      {
        friendId: 'friend-1',
        eventData: { text: 'コスト比較', matched: true },
      },
      'channel-token',
      'acc-1',
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].binds[4]).toBe('push');
  });

  it('logs even when text message (not flex) is sent', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-2',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: { messageType: 'text', content: 'hello' },
          },
        ]),
      },
    ]);

    const dbFake = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      dbFake,
      'tag_added',
      { friendId: 'friend-1', eventData: {} },
      'channel-token',
      null,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].binds[2]).toBe('text');
    expect(captured[0].binds[3]).toBe('hello');
    expect(captured[0].binds[6]).toBe(null);
  });

  it('resolves params.template_id via templates table when set', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-tpl',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([
          {
            type: 'send_message',
            params: {
              template_id: 'tpl-1',
              // content / messageType を空にして template 経由 resolve を強制
            },
          },
        ]),
      },
    ]);
    (db.getTemplateById as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      id: 'tpl-1',
      name: 'test-tpl',
      category: 'general',
      message_type: 'flex',
      message_content: '{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[{"type":"text","text":"from-template"}]}}',
      created_at: '2026-05-08T00:00:00.000+09:00',
      updated_at: '2026-05-08T00:00:00.000+09:00',
    });

    const dbFake = fakeDb({
      friend: { line_user_id: 'U_test' },
      capturedInserts: captured,
    });
    await fireEvent(
      dbFake,
      'manual_test',
      { friendId: 'friend-1', eventData: {} },
      'channel-token',
      null,
    );

    expect(captured).toHaveLength(1);
    // log には template から取得した messageType / content が記録される
    expect(captured[0].binds[2]).toBe('flex');
    expect(String(captured[0].binds[3])).toContain('from-template');
  });
});

// ------------------------------------------------------------
// Phase 5: webinar_* イベントが automations を発火させ、
// conditions.eventId / ctaItemId による絞り込みが効くことを確認する。
// ------------------------------------------------------------
describe('fireEvent — webinar_* automations', () => {
  let captured: CapturedInsert[];

  beforeEach(() => {
    captured = [];
    vi.clearAllMocks();
  });

  it('webinar_completed: fires add_tag action for matching eventId', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-w1',
        line_account_id: 'acc-1',
        conditions: JSON.stringify({ eventId: 'ev-target' }),
        actions: JSON.stringify([
          { type: 'add_tag', params: { tagId: 'tag-completed' } },
        ]),
      },
    ]);

    const dbFake = fakeDb({ friend: { line_user_id: 'U' }, capturedInserts: captured });

    await fireEvent(
      dbFake,
      'webinar_completed',
      {
        friendId: 'friend-1',
        eventData: { eventId: 'ev-target', bookingId: 'b1' },
      },
      'token',
      'acc-1',
    );

    expect((db.addTagToFriend as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(1);
    expect((db.addTagToFriend as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]).toBe('friend-1');
    expect((db.addTagToFriend as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][2]).toBe('tag-completed');
  });

  it('webinar_completed: skips automation when eventId does not match', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-w2',
        line_account_id: 'acc-1',
        conditions: JSON.stringify({ eventId: 'ev-target' }),
        actions: JSON.stringify([
          { type: 'add_tag', params: { tagId: 'tag-completed' } },
        ]),
      },
    ]);

    const dbFake = fakeDb({ friend: { line_user_id: 'U' }, capturedInserts: captured });

    await fireEvent(
      dbFake,
      'webinar_completed',
      {
        friendId: 'friend-1',
        eventData: { eventId: 'ev-different', bookingId: 'b1' },
      },
      'token',
      'acc-1',
    );

    expect((db.addTagToFriend as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBe(0);
  });

  it('webinar_cta_clicked: ctaItemId condition filters automations', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-cta1',
        line_account_id: null,
        conditions: JSON.stringify({ ctaItemId: 'cta-A' }),
        actions: JSON.stringify([{ type: 'add_tag', params: { tagId: 'clicked-A' } }]),
      },
      {
        id: 'auto-cta2',
        line_account_id: null,
        conditions: JSON.stringify({ ctaItemId: 'cta-B' }),
        actions: JSON.stringify([{ type: 'add_tag', params: { tagId: 'clicked-B' } }]),
      },
      {
        id: 'auto-cta-all',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([{ type: 'add_tag', params: { tagId: 'clicked-any' } }]),
      },
    ]);

    const dbFake = fakeDb({ friend: { line_user_id: 'U' }, capturedInserts: captured });

    await fireEvent(
      dbFake,
      'webinar_cta_clicked',
      {
        friendId: 'friend-1',
        eventData: { eventId: 'ev1', bookingId: 'b1', ctaItemId: 'cta-A', positionSeconds: 30 },
      },
      'token',
      null,
    );

    const addTagCalls = (db.addTagToFriend as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    // cta-A 一致 と 条件無しの2つが発火する
    const taggedIds = addTagCalls.map((c) => c[2]);
    expect(taggedIds).toContain('clicked-A');
    expect(taggedIds).toContain('clicked-any');
    expect(taggedIds).not.toContain('clicked-B');
  });

  it('webinar_opened: empty conditions match all webinars', async () => {
    const db = await import('@line-crm/db');
    (db.getActiveAutomationsByEvent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: 'auto-open',
        line_account_id: null,
        conditions: JSON.stringify({}),
        actions: JSON.stringify([{ type: 'add_tag', params: { tagId: 'opened-any' } }]),
      },
    ]);

    const dbFake = fakeDb({ friend: { line_user_id: 'U' }, capturedInserts: captured });

    await fireEvent(
      dbFake,
      'webinar_opened',
      {
        friendId: 'friend-1',
        eventData: { eventId: 'any-event', bookingId: 'b1' },
      },
      'token',
      null,
    );

    const addTagCalls = (db.addTagToFriend as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(addTagCalls.length).toBe(1);
    expect(addTagCalls[0][2]).toBe('opened-any');
  });
});
