import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { friends } from './friends.js';

describe('GET /api/friends tag enrichment', () => {
  test('returns the same tag shape with one batch query and skips it when disabled', async () => {
    const friend = {
      id: 'friend-1',
      line_user_id: 'U123',
      display_name: 'れい',
      picture_url: null,
      status_message: null,
      is_following: 1,
      blocked_at: null,
      last_unblocked_at: null,
      metadata: '{}',
      ref_code: null,
      user_id: null,
      created_at: '2026-09-01',
      updated_at: '2026-09-01',
    };
    const prepare = vi.fn((sql: string) => ({
      first: async () => ({ count: 1 }),
      bind: (..._args: unknown[]) => ({
        all: async () => {
          if (sql.includes('FROM friend_tags ft')) {
            return {
              results: [{ friend_id: friend.id, id: 'tag-1', name: '回答済み', color: '#00aa00', created_at: '2026-09-01' }],
            };
          }
          return { results: [friend] };
        },
      }),
    }));
    const app = new Hono();
    app.route('/', friends);
    const env = { DB: { prepare } as unknown as D1Database };

    const response = await app.request('/api/friends?limit=1', {}, env);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { items: Array<{ tags: Array<{ id: string; name: string }> }> };
    };
    expect(body.data.items[0].tags).toEqual([
      { id: 'tag-1', name: '回答済み', color: '#00aa00', createdAt: '2026-09-01' },
    ]);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('FROM friend_tags ft'))).toHaveLength(1);

    const withoutTags = await app.request('/api/friends?limit=1&includeTags=false', {}, env);
    expect(withoutTags.status).toBe(200);
    const withoutTagsBody = await withoutTags.json() as {
      data: { items: Array<{ tags: unknown[] }> };
    };
    expect(withoutTagsBody.data.items[0].tags).toEqual([]);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('FROM friend_tags ft'))).toHaveLength(1);
  });
});
