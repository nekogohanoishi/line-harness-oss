import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  replyMessage: vi.fn(async () => undefined),
  pushMessage: vi.fn(async () => undefined),
  addTagToFriend: vi.fn(async () => undefined),
  removeTagFromFriend: vi.fn(async () => undefined),
  enrollFriendInScenario: vi.fn(async () => null),
  getFriendById: vi.fn(async () => ({ id: 'friend-1', line_user_id: 'U1', display_name: '山田', metadata: '{}', user_id: null })),
  getTemplateById: vi.fn(async () => null),
  fireEvent: vi.fn(async () => undefined),
  logOutgoingMessage: vi.fn(async () => undefined),
  enrollTagTriggeredScenarios: vi.fn(async () => undefined),
}));

vi.mock('@line-crm/line-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@line-crm/line-sdk')>()),
  LineClient: vi.fn().mockImplementation(() => ({ replyMessage: mocks.replyMessage, pushMessage: mocks.pushMessage })),
}));
vi.mock('@line-crm/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@line-crm/db')>()),
  addTagToFriend: mocks.addTagToFriend,
  removeTagFromFriend: mocks.removeTagFromFriend,
  enrollFriendInScenario: mocks.enrollFriendInScenario,
  getFriendById: mocks.getFriendById,
  getTemplateById: mocks.getTemplateById,
}));
vi.mock('./event-bus.js', () => ({ fireEvent: mocks.fireEvent, logOutgoingMessage: mocks.logOutgoingMessage }));
vi.mock('./tag-scenarios.js', () => ({ enrollTagTriggeredScenarios: mocks.enrollTagTriggeredScenarios }));

const { handleMessageActionPostback, isPastDeadline, parseActionPostback, sanitizeSteps } = await import('./message-actions.js');
const { messageActions, parseActionInput } = await import('../routes/message-actions.js');

const baseRow = {
  id: 'act-1',
  line_account_id: null,
  name: '作成会・詳しく知りたい',
  kind: 'postback',
  steps: JSON.stringify([
    { type: 'add_tag', tagId: 'tag-meeting' },
    { type: 'reply_text', text: '{{name}}さん、ありがとうございます。案内をお送りします。' },
  ]),
  link_url: null,
  once_per_friend: 0,
  repeat_reply: null,
  deadline_at: null,
  expired_reply: null,
  expired_url: null,
  is_active: 1,
  created_at: '2026-10-06T10:00:00.000',
  updated_at: '2026-10-06T10:00:00.000',
};

function fakeDb(row: Record<string, unknown> | null, opts: { alreadyDone?: boolean } = {}) {
  const logs: Array<{ friendId: unknown; result: unknown }> = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => {
              if (sql.includes('FROM message_actions')) return row;
              if (sql.includes('FROM message_action_logs')) return opts.alreadyDone ? { hit: 1 } : null;
              if (sql.includes('SELECT metadata FROM friends')) return { metadata: '{}' };
              return null;
            },
            run: async () => {
              if (sql.includes('INSERT INTO message_action_logs')) logs.push({ friendId: args[2], result: args[3] });
              return { success: true };
            },
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, logs };
}

const run = (db: D1Database, now?: Date) =>
  handleMessageActionPostback({ db, lineAccessToken: 'token', replyToken: 'reply-1', friendId: 'friend-1', actionId: 'act-1', lineAccountId: null, now });

beforeEach(() => vi.clearAllMocks());

describe('ボタンの動き: 押されたときの処理', () => {
  test('通常: タグを付け、タグで始まるシナリオも動かし、名前を差し込んだ返信を1回で送る', async () => {
    const { db, logs } = fakeDb(baseRow);
    expect(await run(db)).toBe('done');
    expect(mocks.addTagToFriend).toHaveBeenCalledWith(db, 'friend-1', 'tag-meeting');
    expect(mocks.enrollTagTriggeredScenarios).toHaveBeenCalledWith(db, 'friend-1', 'tag-meeting');
    expect(mocks.replyMessage).toHaveBeenCalledTimes(1);
    expect(mocks.replyMessage.mock.calls[0][1]).toEqual([{ type: 'text', text: '山田さん、ありがとうございます。案内をお送りします。' }]);
    expect(logs).toEqual([{ friendId: 'friend-1', result: 'done' }]);
  });

  test('締切後: 手順は実行せず、締切後の返信だけを送る', async () => {
    const { db, logs } = fakeDb({ ...baseRow, deadline_at: '2026-10-06T12:00', expired_reply: '今回の募集は終了しました。' });
    expect(await run(db, new Date('2026-10-06T03:00:00Z'))).toBe('expired'); // 日本時間 12:00 ちょうど
    expect(mocks.addTagToFriend).not.toHaveBeenCalled();
    expect(mocks.replyMessage.mock.calls[0][1]).toEqual([{ type: 'text', text: '今回の募集は終了しました。' }]);
    expect(logs).toEqual([{ friendId: 'friend-1', result: 'expired' }]);
  });

  test('1人1回: 2回目は手順を実行せず、2回目用の返信だけを送る', async () => {
    const { db, logs } = fakeDb({ ...baseRow, once_per_friend: 1, repeat_reply: 'すでに受け付けています。' }, { alreadyDone: true });
    expect(await run(db)).toBe('repeat');
    expect(mocks.addTagToFriend).not.toHaveBeenCalled();
    expect(mocks.replyMessage.mock.calls[0][1]).toEqual([{ type: 'text', text: 'すでに受け付けています。' }]);
    expect(logs).toEqual([{ friendId: 'friend-1', result: 'repeat' }]);
  });

  test('無効・見つからない動きは何もしない', async () => {
    const { db, logs } = fakeDb(null);
    expect(await run(db)).toBe('ignored');
    expect(mocks.replyMessage).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
});

describe('ボタンの動き: 小さな部品', () => {
  test('postback data から番号を取り出す', () => {
    expect(parseActionPostback('lh:act:act-1')).toBe('act-1');
    expect(parseActionPostback('lh:survey:1')).toBeNull();
    expect(parseActionPostback('lh:act:../../etc')).toBeNull();
  });

  test('締切は日本時間で判定する', () => {
    expect(isPastDeadline(null)).toBe(false);
    expect(isPastDeadline('2026-10-06T12:00', new Date('2026-10-06T02:59:59Z'))).toBe(false);
    expect(isPastDeadline('2026-10-06T12:00', new Date('2026-10-06T03:00:00Z'))).toBe(true);
  });

  test('手順の検証: 知らない種類や空のタグは受け付けない', () => {
    expect(sanitizeSteps([{ type: 'add_tag', tagId: 'tag-1' }, { type: 'set_metadata', key: '関心', value: '作成会' }])).toHaveLength(2);
    expect(sanitizeSteps([{ type: 'delete_friend' }])).toBeNull();
    expect(sanitizeSteps([{ type: 'add_tag', tagId: '' }])).toBeNull();
  });

  test('保存内容の検証: 押したときの動きが空、リンクが https でない、締切の形式違いは日本語のエラー', () => {
    expect('error' in parseActionInput({ name: 'x', kind: 'postback', steps: [] })).toBe(true);
    expect(parseActionInput({ name: 'x', kind: 'link', linkUrl: 'ftp://example.com' })).toEqual({ error: '開くページのURLを https:// から入力してください' });
    expect('error' in parseActionInput({ name: 'x', kind: 'link', linkUrl: 'https://example.com', deadlineAt: '10/6 12:00' })).toBe(true);
    const ok = parseActionInput({ name: ' 申込リンク ', kind: 'link', linkUrl: 'https://example.com/form', deadlineAt: '2026-10-31T23:59' });
    expect(ok).toMatchObject({ input: { name: '申込リンク', kind: 'link', linkUrl: 'https://example.com/form', deadlineAt: '2026-10-31T23:59', steps: [] } });
  });
});

describe('締切つきリンク /go/:id', () => {
  const linkRow = { ...baseRow, kind: 'link', steps: '[]', link_url: 'https://example.com/form' };
  const request = (row: Record<string, unknown> | null) => {
    const app = new Hono();
    app.route('/', messageActions);
    return app.request('/go/act-1', {}, { DB: fakeDb(row).db });
  };

  test('締切前は本来のページへ移す', async () => {
    const res = await request(linkRow);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/form');
  });

  test('締切後は締切後のページへ。なければ案内の文を出す', async () => {
    const past = { ...linkRow, deadline_at: '2020-01-01T00:00' };
    const toPage = await request({ ...past, expired_url: 'https://example.com/next' });
    expect(toPage.headers.get('location')).toBe('https://example.com/next');
    const toNotice = await request({ ...past, expired_reply: '次回の募集をお待ちください。' });
    expect(toNotice.status).toBe(200);
    expect(await toNotice.text()).toContain('次回の募集をお待ちください。');
  });

  test('存在しない・無効なリンクは 404', async () => {
    expect((await request(null)).status).toBe(404);
  });
});
