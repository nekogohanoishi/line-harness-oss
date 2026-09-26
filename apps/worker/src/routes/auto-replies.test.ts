import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { autoReplies } from './auto-replies.js';

describe('GET /api/auto-replies', () => {
  test('global message automation makes a silent rule effective for the selected account', async () => {
    const db = {
      prepare(sql: string) {
        const all = async () => {
          if (sql.includes('FROM auto_replies')) return { results: [{
            id: 'reply-1', keyword: '作成会希望', match_type: 'exact', response_type: 'silent',
            response_content: '', template_id: null, line_account_id: null, is_active: 1,
            created_at: '2026-09-23T00:00:00.000Z',
          }] };
          if (sql.includes('FROM line_accounts')) return { results: [{ id: 'account-1', name: '公式LINE' }] };
          if (sql.includes('FROM automations')) return { results: [{
            line_account_id: null,
            conditions: JSON.stringify({ keyword: '作成会希望' }),
            actions: JSON.stringify([{ type: 'send_message', params: { content: '案内' } }]),
          }] };
          return { results: [] };
        };
        return { all, bind: (..._args: unknown[]) => ({ all }) };
      },
    } as unknown as D1Database;
    const app = new Hono();
    app.route('/', autoReplies);

    const response = await app.request('/api/auto-replies?accountId=account-1', {}, { DB: db });
    const body = await response.json() as {
      success: boolean;
      data: Array<{ effectiveAccounts: Array<{ accountId: string; status: string; via: string }> }>;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data[0].effectiveAccounts).toContainEqual({
      accountId: 'account-1', accountName: '公式LINE', status: 'reply', via: 'automation',
    });
  });
});
