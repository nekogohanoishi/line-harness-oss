import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { accountSettings, sanitizeFriendSavedFilters } from './account-settings.js';

describe('sanitizeFriendSavedFilters', () => {
  test('名前と既知の絞り込み条件だけを残し、空や既定値は落とす', () => {
    expect(sanitizeFriendSavedFilters([
      { id: 'f-1', name: '  受講生 ', filters: { tagId: 'tag-1', sort: 'recent', search: ' ', unknown: 'x' } },
      { id: 'f-2', name: '未対応の人', filters: { handled: 'unhandled', followStatus: 'following', sort: 'oldest' } },
    ])).toEqual([
      { id: 'f-1', name: '受講生', filters: { tagId: 'tag-1' } },
      { id: 'f-2', name: '未対応の人', filters: { handled: 'unhandled', followStatus: 'following', sort: 'oldest' } },
    ]);
  });

  test('不正な id は作り直し、名前が空・長すぎる・件数超過は全体を拒否する', () => {
    const [entry] = sanitizeFriendSavedFilters([{ id: 'bad id!', name: 'ブロック中', filters: { followStatus: 'blocked' } }]) ?? [];
    expect(entry.name).toBe('ブロック中');
    expect(entry.id).toMatch(/^[\w-]+$/);
    expect(entry.id).not.toBe('bad id!');

    expect(sanitizeFriendSavedFilters([{ id: 'a', name: ' ', filters: {} }])).toBeNull();
    expect(sanitizeFriendSavedFilters([{ id: 'a', name: 'あ'.repeat(31), filters: {} }])).toBeNull();
    expect(sanitizeFriendSavedFilters(Array.from({ length: 21 }, (_, i) => ({ id: `f${i}`, name: `条件${i}`, filters: {} })))).toBeNull();
    expect(sanitizeFriendSavedFilters('not array')).toBeNull();
  });
});

// account_settings を1行だけ持つ最小限の D1 モック
function settingsDb() {
  const store = new Map<string, string>();
  return {
    store,
    db: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => {
                const value = store.get(`${args[0]}:friend_saved_filters`);
                return value === undefined ? null : { value };
              },
              run: async () => {
                if (sql.includes('INSERT INTO account_settings')) store.set(`${args[1]}:friend_saved_filters`, String(args[2]));
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

describe('friend-saved-filters API', () => {
  test('保存した内容をアカウントごとに読み戻せ、不正な内容は 400 で保存しない', async () => {
    const { db, store } = settingsDb();
    const app = new Hono();
    app.route('/', accountSettings);
    const env = { DB: db };

    const empty = await app.request('/api/account-settings/friend-saved-filters?accountId=acc-1', {}, env);
    expect(await empty.json()).toEqual({ success: true, data: [] });

    const put = await app.request('/api/account-settings/friend-saved-filters', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', filters: [{ id: 'f-1', name: '受講生', filters: { tagId: 'tag-1' } }] }),
    }, env);
    expect(put.status).toBe(200);

    const got = await app.request('/api/account-settings/friend-saved-filters?accountId=acc-1', {}, env);
    expect(await got.json()).toEqual({ success: true, data: [{ id: 'f-1', name: '受講生', filters: { tagId: 'tag-1' } }] });

    const bad = await app.request('/api/account-settings/friend-saved-filters', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'acc-1', filters: [{ id: 'f-2', name: '', filters: {} }] }),
    }, env);
    expect(bad.status).toBe(400);
    expect(JSON.parse(store.get('acc-1:friend_saved_filters') ?? '[]')).toHaveLength(1);
  });
});
