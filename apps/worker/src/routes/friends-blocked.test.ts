import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { friends } from './friends.js';

function createApp() {
  const row = {
    id: 'blocked-friend',
    line_user_id: 'U-blocked',
    display_name: 'テスト友だち',
    picture_url: null,
    status_message: null,
    is_following: 0,
    blocked_at: '2026-10-09T12:00:00.000+09:00',
    last_unblocked_at: null,
    metadata: '{}',
    ref_code: null,
    user_id: null,
    created_at: '2026-07-01T09:00:00.000+09:00',
    updated_at: '2026-10-09T12:00:00.000+09:00',
  };
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const prepare = vi.fn((sql: string) => {
    const execute = (values: unknown[]) => {
      calls.push({ sql, values });
      return { first: async () => ({ count: 25 }), all: async () => ({ results: [row] }) };
    };
    return {
      first: async () => { calls.push({ sql, values: [] }); return { count: 25 }; },
      bind: (...values: unknown[]) => execute(values),
    };
  });
  const app = new Hono();
  app.route('/', friends);
  return { app, env: { DB: { prepare } as unknown as D1Database }, calls, prepare };
}

describe('GET /api/friends blocked list', () => {
  test.each(['recent', 'oldest'])('ブロック日時の%s順で、アカウントとページの条件を保つ', async (sort) => {
    const { app, env, calls, prepare } = createApp();
    const response = await app.request(`/api/friends?followStatus=blocked&sort=${sort}&lineAccountId=account-1&limit=20&offset=20&includeTags=false`, {}, env);
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { total: number; hasNextPage: boolean; items: Array<{ isFollowing: boolean; blockedAt: string }> } };
    expect(body.data).toMatchObject({ total: 25, hasNextPage: false });
    expect(body.data.items[0]).toMatchObject({ isFollowing: false, blockedAt: '2026-10-09T12:00:00.000+09:00' });
    const query = calls[1];
    expect(query.sql).toContain('f.line_account_id = ?');
    expect(query.sql).toContain('f.is_following = 0');
    expect(query.sql).toContain(`ORDER BY CASE WHEN f.blocked_at IS NULL THEN 1 ELSE 0 END ASC, f.blocked_at ${sort === 'oldest' ? 'ASC' : 'DESC'}`);
    expect(query.values).toEqual(['account-1', 20, 20]);
    expect(prepare.mock.calls).toHaveLength(2);
  });

  test('ブロック中の名前検索でも一致度の次にブロック日時を使う', async () => {
    const { app, env, calls } = createApp();
    const response = await app.request('/api/friends?followStatus=blocked&search=test&includeTags=false', {}, env);
    expect(response.status).toBe(200);
    expect(calls[1].sql).toContain('ORDER BY match_score ASC, CASE WHEN f.blocked_at IS NULL THEN 1 ELSE 0 END ASC, f.blocked_at DESC');
    expect(calls[1].values).toEqual(['test', 'test%', '% test%', '%　test%', '%test%', 50, 0]);
  });

  test('フォロー中の一覧は従来の追加日時順を維持する', async () => {
    const { app, env, calls } = createApp();
    const response = await app.request('/api/friends?followStatus=following&sort=oldest&includeTags=false', {}, env);
    expect(response.status).toBe(200);
    expect(calls[1].sql).toContain('f.is_following = 1');
    expect(calls[1].sql).toContain('ORDER BY f.created_at ASC');
    expect(calls[1].sql).not.toContain('ORDER BY CASE');
  });
});
