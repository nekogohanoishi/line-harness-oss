import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// friend / line_account 解決だけを db package からモックする。resolveStepContent /
// buildWebinarTemplateContext 等は素通しし、fake D1Database (下の makeFakeDb) が
// webinar/cart クエリに null を返すことで「active booking/cart なし」を再現する。
vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/db')>('@line-crm/db');
  return {
    ...actual,
    getFriendById: vi.fn(),
    getLineAccountById: vi.fn(),
    getLineAccounts: vi.fn(),
    jstNow: vi.fn(() => '2026-01-01T00:00:00+09:00'),
  };
});

const pushMessageMock = vi.fn();

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    LineClient: vi.fn().mockImplementation((token: string) => ({
      _token: token,
      pushMessage: pushMessageMock,
    })),
  };
});

import { getFriendById, getLineAccountById, getLineAccounts } from '@line-crm/db';
import { scenarios } from './scenarios.js';

function setupApp() {
  const app = new Hono();
  app.route('/', scenarios);
  return app;
}

interface FakeDbOptions {
  scenario?: { id: string; line_account_id: string | null } | null;
  step?: Record<string, unknown> | null;
  testRecipientsValue?: string | null;
}

function makeFakeDb(opts: FakeDbOptions): D1Database {
  const scenario = opts.scenario;
  const step = opts.step;
  const testRecipientsRow = opts.testRecipientsValue != null ? { value: opts.testRecipientsValue } : null;

  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM scenarios WHERE id')) return scenario ?? null;
          if (sql.includes('FROM scenario_steps WHERE id')) return step ?? null;
          if (sql.includes("key = 'test_recipients'")) return testRecipientsRow;
          return null;
        },
        run: async () => ({ success: true } as unknown),
        all: async () => ({ results: [] }),
      }),
    }),
  } as unknown as D1Database;
}

const baseEnv = {
  WORKER_URL: 'https://worker.example.test',
} as Record<string, unknown>;

const baseStep = {
  id: 'step-1',
  scenario_id: 'scenario-1',
  step_order: 1,
  delay_minutes: 0,
  message_type: 'text',
  message_content: 'こんにちは {{name}} さん',
  condition_type: null,
  condition_value: null,
  next_step_on_false: null,
  offset_days: null,
  offset_minutes: null,
  delivery_time: null,
  template_id: null,
  on_reach_tag_id: null,
  created_at: '2026-01-01T00:00:00+09:00',
};

const account1 = {
  id: 'acct-1',
  channel_id: 'ch-1',
  name: 'テストアカウント',
  channel_access_token: 'token-1',
  channel_secret: 'secret-1',
  login_channel_id: null,
  login_channel_secret: null,
  liff_id: null,
  is_active: 1,
  country: null,
  role: null,
  display_order: 0,
  token_expires_at: null,
  created_at: '2026-01-01T00:00:00+09:00',
  updated_at: '2026-01-01T00:00:00+09:00',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/scenarios/:id/steps/:stepId/test-send', () => {
  test('test_recipients に登録された友だち全員へ【テスト送信】付きで push する', async () => {
    vi.mocked(getFriendById).mockImplementation(async (_db, id) => {
      if (id === 'friend-1') {
        return {
          id: 'friend-1',
          line_user_id: 'U_friend1',
          display_name: '太郎',
          picture_url: null,
          status_message: null,
          is_following: 1,
          user_id: null,
          line_account_id: 'acct-1',
          metadata: '{}',
          first_tracked_link_id: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
        };
      }
      if (id === 'friend-2') {
        return {
          id: 'friend-2',
          line_user_id: 'U_friend2',
          display_name: '花子',
          picture_url: null,
          status_message: null,
          is_following: 1,
          user_id: null,
          line_account_id: 'acct-1',
          metadata: '{}',
          first_tracked_link_id: null,
          created_at: '2026-01-01T00:00:00+09:00',
          updated_at: '2026-01-01T00:00:00+09:00',
        };
      }
      return null;
    });
    vi.mocked(getLineAccountById).mockResolvedValue(account1);
    vi.mocked(getLineAccounts).mockResolvedValue([account1]);

    const app = setupApp();
    const env = {
      ...baseEnv,
      DB: makeFakeDb({
        scenario: { id: 'scenario-1', line_account_id: 'acct-1' },
        step: baseStep,
        testRecipientsValue: JSON.stringify(['friend-1', 'friend-2']),
      }),
    };

    const res = await app.request(
      '/api/scenarios/scenario-1/steps/step-1/test-send',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, sent: 2 });
    expect(pushMessageMock).toHaveBeenCalledTimes(2);
    const [to1, messages1] = pushMessageMock.mock.calls[0];
    expect(to1).toBe('U_friend1');
    expect(messages1[0].type).toBe('text');
    expect(messages1[0].text).toBe('【テスト送信】\nこんにちは 太郎 さん');
  });

  test('test_recipients が未設定なら 400 no_test_recipients を返し push は行わない', async () => {
    const app = setupApp();
    const env = {
      ...baseEnv,
      DB: makeFakeDb({
        scenario: { id: 'scenario-1', line_account_id: 'acct-1' },
        step: baseStep,
        testRecipientsValue: null,
      }),
    };

    const res = await app.request(
      '/api/scenarios/scenario-1/steps/step-1/test-send',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env,
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: 'no_test_recipients' });
    expect(pushMessageMock).not.toHaveBeenCalled();
  });

  test('存在しない stepId は 404 Step not found', async () => {
    const app = setupApp();
    const env = {
      ...baseEnv,
      DB: makeFakeDb({
        scenario: { id: 'scenario-1', line_account_id: 'acct-1' },
        step: null,
        testRecipientsValue: JSON.stringify(['friend-1']),
      }),
    };

    const res = await app.request(
      '/api/scenarios/scenario-1/steps/missing-step/test-send',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env,
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: 'Step not found' });
    expect(pushMessageMock).not.toHaveBeenCalled();
  });

  test('存在しない scenarioId は 404 Scenario not found', async () => {
    const app = setupApp();
    const env = {
      ...baseEnv,
      DB: makeFakeDb({
        scenario: null,
        step: baseStep,
        testRecipientsValue: JSON.stringify(['friend-1']),
      }),
    };

    const res = await app.request(
      '/api/scenarios/missing-scenario/steps/step-1/test-send',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      env,
    );

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: 'Scenario not found' });
    expect(pushMessageMock).not.toHaveBeenCalled();
  });
});
