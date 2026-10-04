import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { scenarios } from './scenarios.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE scenarios (id TEXT PRIMARY KEY, name TEXT, line_account_id TEXT, is_active INTEGER);
    CREATE TABLE scenario_steps (id TEXT PRIMARY KEY, scenario_id TEXT, step_order INTEGER);
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_account_id TEXT, display_name TEXT, picture_url TEXT, is_following INTEGER);
    CREATE TABLE friend_scenarios (
      id TEXT PRIMARY KEY, friend_id TEXT, scenario_id TEXT, status TEXT,
      current_step_order INTEGER, started_at TEXT, updated_at TEXT, next_delivery_at TEXT
    );
    INSERT INTO scenarios VALUES ('s1', 'ウェビナー案内', 'a1', 0), ('s2', '共通フォロー', NULL, 1);
    INSERT INTO scenario_steps VALUES
      ('s1-0', 's1', 0), ('s1-1', 's1', 1), ('s1-2', 's1', 2),
      ('s2-0', 's2', 0), ('s2-2', 's2', 2);
    INSERT INTO friends VALUES
      ('f1', 'a1', 'Alice', NULL, 1),
      ('f2', 'a1', 'Bob', NULL, 0),
      ('f3', 'a2', 'Carol', NULL, 1);
    INSERT INTO friend_scenarios VALUES
      ('old', 'f1', 's1', 'completed', 2, '2026-09-01', '2026-09-01', NULL),
      ('current', 'f1', 's1', 'active', 0, '2026-09-20', '2026-09-20', '2026-09-30'),
      ('paused', 'f2', 's1', 'paused', -1, '2026-09-21', '2026-09-21', '2026-10-01'),
      ('done', 'f2', 's2', 'completed', 2, '2026-09-22', '2026-09-22', NULL),
      ('other', 'f3', 's2', 'active', -1, '2026-09-23', '2026-09-23', '2026-10-02');
  `);
  return {
    prepare: (sql: string) => ({
      bind: (...args: Array<string | number>) => ({
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
      }),
    }),
  } as unknown as D1Database;
}

function setupApp() {
  const app = new Hono();
  app.route('/', scenarios);
  return app;
}

describe('scenario progress overview', () => {
  test('アカウントを絞り、再参加した友だちは現在の1件だけ表示する', async () => {
    const response = await setupApp().request('/api/scenarios/progress?lineAccountId=a1', {}, { DB: makeDb() });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        summary: Array<{ scenarioId: string; status: string; passedSteps: number; count: number }>;
        total: number;
        items: Array<{ id: string; friendId: string; scenarioActive: boolean; passedSteps: number; totalSteps: number }>;
      };
    };
    expect(body.data.summary).toEqual(expect.arrayContaining([
      { scenarioId: 's1', status: 'active', passedSteps: 1, count: 1 },
      { scenarioId: 's1', status: 'paused', passedSteps: 0, count: 1 },
      { scenarioId: 's2', status: 'completed', passedSteps: 2, count: 1 },
    ]));
    expect(body.data.total).toBe(2);
    expect(body.data.items.map((item) => item.id)).toEqual(['current', 'paused']);
    expect(body.data.items[0]).toMatchObject({
      friendId: 'f1', scenarioActive: false, passedSteps: 1, totalSteps: 3,
    });
  });

  test('段階・状態・名前の絞り込みと完了の表示ができる', async () => {
    const db = makeDb();
    const stageResponse = await setupApp().request(
      '/api/scenarios/progress?lineAccountId=a1&scenarioId=s1&stage=0&status=current',
      {}, { DB: db },
    );
    const stageBody = await stageResponse.json() as { data: { total: number; items: Array<{ friendId: string }> } };
    expect(stageBody.data.total).toBe(1);
    expect(stageBody.data.items[0].friendId).toBe('f2');

    const completedResponse = await setupApp().request(
      '/api/scenarios/progress?lineAccountId=a1&status=completed&search=%E5%85%B1%E9%80%9A',
      {}, { DB: db },
    );
    const completedBody = await completedResponse.json() as { data: { total: number; items: Array<{ id: string; passedSteps: number }> } };
    expect(completedBody.data.total).toBe(1);
    expect(completedBody.data.items).toEqual([expect.objectContaining({ id: 'done', passedSteps: 2 })]);
  });
});
