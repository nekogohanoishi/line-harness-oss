import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { friends } from './friends.js';

const friendRow = (id: string) => ({
  id,
  line_user_id: `U-${id}`,
  display_name: id,
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
  chat_status: 'resolved',
});

describe('GET /api/friends scenario summary', () => {
  test('一時停止・完了も状態として返し、activeScenario は進行中だけに保つ', async () => {
    const rows = [friendRow('paused-friend'), friendRow('done-friend'), friendRow('active-friend'), friendRow('new-friend')];
    const scenarioRows = [
      { friend_id: 'paused-friend', scenario_name: '解説速報', status: 'paused', next_delivery_at: '2026-10-06T12:00:00' },
      { friend_id: 'done-friend', scenario_name: '解説速報', status: 'completed', next_delivery_at: null },
      { friend_id: 'active-friend', scenario_name: '作成会案内', status: 'active', next_delivery_at: '2026-10-05T20:00:00' },
    ];
    const prepare = vi.fn((sql: string) => ({
      first: async () => ({ count: rows.length }),
      bind: (..._args: unknown[]) => ({
        all: async () => {
          if (sql.includes('FROM friend_scenarios')) return { results: scenarioRows };
          if (sql.includes('FROM messages_log') || sql.includes('FROM friend_tags ft')) return { results: [] };
          return { results: rows };
        },
      }),
    }));
    const app = new Hono();
    app.route('/', friends);
    const env = { DB: { prepare } as unknown as D1Database };

    const response = await app.request('/api/friends?limit=4&includeChatStatus=true', {}, env);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { items: Array<{ id: string; activeScenario: unknown; scenarioSummary: unknown }> };
    };
    const byId = new Map(body.data.items.map((item) => [item.id, item]));

    expect(byId.get('paused-friend')).toMatchObject({
      activeScenario: null,
      scenarioSummary: { name: '解説速報', status: 'paused', nextDeliveryAt: '2026-10-06T12:00:00' },
    });
    expect(byId.get('done-friend')).toMatchObject({
      activeScenario: null,
      scenarioSummary: { name: '解説速報', status: 'completed', nextDeliveryAt: null },
    });
    expect(byId.get('active-friend')).toMatchObject({
      activeScenario: { name: '作成会案内', status: 'active' },
      scenarioSummary: { name: '作成会案内', status: 'active', nextDeliveryAt: '2026-10-05T20:00:00' },
    });
    expect(byId.get('new-friend')).toMatchObject({ activeScenario: null, scenarioSummary: null });

    // 状態の優先順 (送信処理中 > 配信待ち > 一時停止 > 完了) を SQL 側で決めていること
    const scenarioSql = prepare.mock.calls.map(([sql]) => sql).find((sql) => sql.includes('FROM friend_scenarios')) ?? '';
    expect(scenarioSql).toMatch(/WHEN 'delivering' THEN 0 WHEN 'active' THEN 1 WHEN 'paused' THEN 2/);
    expect(scenarioSql).not.toMatch(/status IN \('active', 'delivering'\)/);
  });
});
