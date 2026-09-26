import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db');
  return {
    ...actual,
    getFriendById: vi.fn(),
    jstNow: vi.fn(() => '2026-08-27T12:00:00.000+09:00'),
  };
});

import { getFriendById } from '@line-crm/db';
import { friends } from './friends.js';
import { getDelayedAutoReplyControl } from '../services/delayed-auto-reply.js';

type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'delivering';

type EnrollmentRow = {
  id: string;
  friend_id: string;
  scenario_id: string;
  scenario_name: string;
  status: EnrollmentStatus;
  current_step_order: number;
  started_at: string;
  next_delivery_at: string | null;
  updated_at: string;
  total_steps: number;
  sent_steps: number;
};

const activeEnrollment: EnrollmentRow = {
  id: 'enrollment-1',
  friend_id: 'friend-1',
  scenario_id: 'scenario-1',
  scenario_name: '解説速報フォロー',
  status: 'active',
  current_step_order: 0,
  started_at: '2026-08-27T09:00:00.000+09:00',
  next_delivery_at: '2026-08-27T13:30:00.000+09:00',
  updated_at: '2026-08-27T09:00:00.000+09:00',
  total_steps: 3,
  sent_steps: 1,
};

function setupApp() {
  const app = new Hono();
  app.route('/', friends);
  return app;
}

function makeFakeDb(options: {
  enrollment?: EnrollmentRow | null;
  list?: EnrollmentRow[];
  updateChanges?: number;
}) {
  const updates: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM friend_scenarios fs')) return options.enrollment ?? null;
          return null;
        },
        all: async () => {
          if (sql.includes('FROM friend_scenarios fs')) {
            return { results: options.list ?? [] };
          }
          return { results: [] };
        },
        run: async () => {
          updates.push({ sql, args });
          return { meta: { changes: options.updateChanges ?? 1 } };
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFriendById).mockResolvedValue({ id: 'friend-1' } as never);
});

describe('friend-specific scenario delivery controls', () => {
  test('進行中と一時停止中のシナリオを友だち単位で一覧化する', async () => {
    const paused = { ...activeEnrollment, id: 'enrollment-2', status: 'paused' as const };
    const { db } = makeFakeDb({ list: [activeEnrollment, paused] });
    const res = await setupApp().request('/api/friends/friend-1/scenarios', {}, { DB: db });

    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; data: Array<Record<string, unknown>> };
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      id: 'enrollment-1',
      scenarioName: '解説速報フォロー',
      status: 'active',
      totalSteps: 3,
      sentSteps: 1,
    });
  });

  test('対象の友だちのactive配信だけをpausedへ変更する', async () => {
    const { db, updates } = makeFakeDb({ enrollment: activeEnrollment });
    const res = await setupApp().request(
      '/api/friends/friend-1/scenarios/enrollment-1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      },
      { DB: db },
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { status: string } };
    expect(json.data.status).toBe('paused');
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("SET status = 'paused'");
    expect(updates[0].args).toEqual([
      '2026-08-27T12:00:00.000+09:00',
      'enrollment-1',
      'friend-1',
    ]);
  });

  test('再開時は停止時点で残っていた待ち時間を引き継ぐ', async () => {
    const pausedEnrollment: EnrollmentRow = {
      ...activeEnrollment,
      status: 'paused',
      updated_at: '2026-08-27T10:00:00.000+09:00',
      next_delivery_at: '2026-08-27T11:30:00.000+09:00',
    };
    const { db, updates } = makeFakeDb({ enrollment: pausedEnrollment });
    const res = await setupApp().request(
      '/api/friends/friend-1/scenarios/enrollment-1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume' }),
      },
      { DB: db },
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { status: string; nextDeliveryAt: string } };
    expect(json.data.status).toBe('active');
    expect(json.data.nextDeliveryAt).toBe('2026-08-27T13:30:00.000+09:00');
    expect(updates[0].args[0]).toBe('2026-08-27T13:30:00.000+09:00');
  });

  test('送信処理中の配信は競合を避けるため停止しない', async () => {
    const { db, updates } = makeFakeDb({
      enrollment: { ...activeEnrollment, status: 'delivering' },
    });
    const res = await setupApp().request(
      '/api/friends/friend-1/scenarios/enrollment-1',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      },
      { DB: db },
    );

    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });
});

describe('friend-specific scheduled message controls', () => {
  test('予約メッセージの停止状態を取得する', async () => {
    vi.mocked(getFriendById).mockResolvedValue({
      id: 'friend-1',
      metadata: JSON.stringify({
        __lineHarnessDeliveryControl: {
          delayedAutoRepliesPaused: true,
          delayedAutoRepliesPausedAt: '2026-08-27T11:00:00.000+09:00',
        },
      }),
    } as never);
    const { db } = makeFakeDb({});
    const res = await setupApp().request(
      '/api/friends/friend-1/delivery-control',
      {},
      { DB: db },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: {
        scheduledMessagesPaused: true,
        scheduledMessagesPausedAt: '2026-08-27T11:00:00.000+09:00',
      },
    });
  });

  test('通常の友だち情報を残したまま予約メッセージを停止する', async () => {
    vi.mocked(getFriendById).mockResolvedValue({
      id: 'friend-1',
      metadata: JSON.stringify({ target_exam: '司法試験' }),
    } as never);
    const { db, updates } = makeFakeDb({});
    const res = await setupApp().request(
      '/api/friends/friend-1/delivery-control',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pause' }),
      },
      { DB: db },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { scheduledMessagesPaused: true },
    });
    const updatedMetadata = updates[0].args[0] as string;
    expect(JSON.parse(updatedMetadata)).toMatchObject({ target_exam: '司法試験' });
    expect(getDelayedAutoReplyControl(updatedMetadata).paused).toBe(true);
  });
});
