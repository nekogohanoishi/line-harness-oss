import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { automations } from './automations.js';

describe('GET /api/automations', () => {
  test('account view includes account-specific and global automations', async () => {
    const calls: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            calls.push({ sql, args });
            return {
              async all() {
                return { results: [{
                  id: 'global-rule',
                  name: '共通ルール',
                  description: null,
                  event_type: 'message_received',
                  conditions: '{}',
                  actions: '[]',
                  is_active: 1,
                  priority: 0,
                  created_at: '2026-09-23T00:00:00.000Z',
                  updated_at: '2026-09-23T00:00:00.000Z',
                }] };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const app = new Hono();
    app.route('/', automations);

    const response = await app.request('/api/automations?lineAccountId=account-1', {}, { DB: db });

    expect(response.status).toBe(200);
    const body = await response.json() as { data: Array<{ name: string }> };
    expect(body.data[0].name).toBe('共通ルール');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('line_account_id IS NULL OR line_account_id = ?');
    expect(calls[0].args).toEqual(['account-1']);
  });
});
