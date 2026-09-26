import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { scenarios } from './scenarios.js';

type ParticipantRow = {
  id: string;
  friend_id: string;
  scenario_id: string;
  status: 'active' | 'paused' | 'delivering';
  current_step_order: number;
  started_at: string;
  next_delivery_at: string | null;
  updated_at: string;
  display_name: string | null;
  picture_url: string | null;
  is_following: number;
  blocked_at: string | null;
  total_steps: number;
  sent_steps: number;
};

const participant: ParticipantRow = {
  id: 'enrollment-1',
  friend_id: 'friend-1',
  scenario_id: 'scenario-1',
  status: 'paused',
  current_step_order: 2,
  started_at: '2026-09-20T10:00:00.000+09:00',
  next_delivery_at: '2026-09-21T20:00:00.000+09:00',
  updated_at: '2026-09-21T12:00:00.000+09:00',
  display_name: '李 橓（すん）',
  picture_url: 'https://example.com/profile.jpg',
  is_following: 1,
  blocked_at: null,
  total_steps: 3,
  sent_steps: 1,
};

function setupApp() {
  const app = new Hono();
  app.route('/', scenarios);
  return app;
}

function makeFakeDb(options?: { scenarioExists?: boolean; rows?: ParticipantRow[] }) {
  const allCalls: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('SELECT id FROM scenarios')) {
            return options?.scenarioExists === false ? null : { id: 'scenario-1' };
          }
          if (sql.includes('COUNT(*) AS total')) {
            return { total: 2, active_count: 1, paused_count: 1, delivering_count: 0 };
          }
          return null;
        },
        all: async () => {
          allCalls.push({ sql, args });
          return { results: options?.rows ?? [participant] };
        },
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }),
  } as unknown as D1Database;
  return { db, allCalls };
}

describe('scenario participants', () => {
  test('進行中・一時停止中の友だちと現在位置を一覧で返す', async () => {
    const { db } = makeFakeDb();
    const res = await setupApp().request(
      '/api/scenarios/scenario-1/participants',
      {},
      { DB: db },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: {
        total: 2,
        counts: { active: 1, paused: 1, delivering: 0 },
        items: [{
          id: 'enrollment-1',
          friendId: 'friend-1',
          displayName: '李 橓（すん）',
          status: 'paused',
          currentStepOrder: 2,
          totalSteps: 3,
          sentSteps: 1,
          isFollowing: true,
        }],
      },
    });
  });

  test('状態と名前の絞り込みをSQLへ渡す', async () => {
    const { db, allCalls } = makeFakeDb();
    const res = await setupApp().request(
      '/api/scenarios/scenario-1/participants?status=paused&search=%E6%9D%8E',
      {},
      { DB: db },
    );

    expect(res.status).toBe(200);
    expect(allCalls).toHaveLength(1);
    expect(allCalls[0].sql).toContain('AND f.display_name LIKE ?');
    expect(allCalls[0].sql).toContain('AND fs.status = ?');
    expect(allCalls[0].args).toEqual(['scenario-1', '%李%', 'paused', 30, 0]);
  });

  test('存在しないシナリオは404を返す', async () => {
    const { db } = makeFakeDb({ scenarioExists: false });
    const res = await setupApp().request(
      '/api/scenarios/missing/participants',
      {},
      { DB: db },
    );

    expect(res.status).toBe(404);
  });
});
