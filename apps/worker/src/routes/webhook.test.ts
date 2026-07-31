import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const getProfileMock = vi.hoisted(() => vi.fn());

// Stub the DB graph so webhook routing can be tested without D1.
vi.mock('@line-crm/db', () => ({
  upsertFriend: vi.fn(),
  recordFriendFollowEvent: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getFriendById: vi.fn(),
  getScenarios: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  upsertChatOnMessage: vi.fn(),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  jstNow: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getMessageTemplateById: vi.fn(),
  createFormSubmission: vi.fn(),
  getFormById: vi.fn(),
  getScenarioById: vi.fn(),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    verifySignature: vi.fn(),
    LineClient: vi.fn().mockImplementation(() => ({
      getProfile: getProfileMock,
    })),
  };
});

vi.mock('../services/event-bus.js', () => ({
  fireEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/step-delivery.js', () => ({
  buildMessage: vi.fn(),
  buildWebinarTemplateContext: vi.fn(),
  expandVariables: vi.fn(),
  messageToLogPayload: vi.fn(),
  resolveMetadata: vi.fn(),
}));

import { verifySignature } from '@line-crm/line-sdk';
import {
  getEntryRouteByRefCode,
  getLineAccounts,
  getFriendByLineUserId,
  getScenarios,
  jstNow,
  recordFriendFollowEvent,
  upsertChatOnMessage,
  upsertFriend,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import { webhook } from './webhook.js';

function setupApp() {
  const app = new Hono();
  app.route('/', webhook);
  return app;
}

function createDbStub() {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      const call = { sql, bindings: [] as unknown[] };
      statements.push(call);
      const statement = {
        bind: vi.fn((...bindings: unknown[]) => {
          call.bindings = bindings;
          return statement;
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      };
      return statement;
    }),
  } as unknown as D1Database;
  return { db, statements };
}

const baseEnv = {
  DB: {} as D1Database,
  LINE_CHANNEL_SECRET: 'env-default-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-default-token',
} as Record<string, unknown>;

const waitUntilMock = vi.fn();
const baseExecutionCtx = {
  waitUntil: waitUntilMock,
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /webhook — DoS defenses (#104)', () => {
  test('rejects with 413 when Content-Length declares an oversized body', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024), // 2 MiB > 1 MiB cap
          'X-Line-Signature': 'whatever',
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    // Signature verification must not even be attempted on an oversized body.
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('rejects with 413 when actual body exceeds the cap even if Content-Length is absent', async () => {
    const app = setupApp();
    const oversizedBody = 'x'.repeat(1024 * 1024 + 1);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': 'whatever',
        },
        body: oversizedBody,
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(413);
    expect(verifySignature).not.toHaveBeenCalled();
  });

  test('verifies signature before parsing JSON — malformed body with invalid signature never reaches the parser', async () => {
    vi.mocked(verifySignature).mockResolvedValue(false);

    const app = setupApp();
    // 44-char signature (valid HMAC-SHA256 base64 length) so it clears the
    // length pre-check and reaches verifySignature. Malformed JSON body: if
    // signature were verified *after* parse (old behavior), we'd hit the
    // parser-failure branch first. With signature-first, we get the invalid-
    // signature branch and never attempt to parse.
    const validShapedSignature = 'A'.repeat(43) + '=';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: '{not valid json',
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // verifySignature must run; rejection happens before any parse attempt.
    expect(verifySignature).toHaveBeenCalled();
    expect(verifySignature).toHaveBeenCalledWith('env-default-secret', '{not valid json', validShapedSignature);
  });

  test('rejects unsigned or malformed-signature requests without hitting verifySignature or D1', async () => {
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Missing X-Line-Signature header entirely.
        },
        body: JSON.stringify({ events: [] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    // Fast-rejected before any crypto / DB work.
    expect(verifySignature).not.toHaveBeenCalled();
  });
});

describe('POST /webhook — LINE follow state history', () => {
  const validShapedSignature = 'A'.repeat(43) + '=';

  async function sendEvent(event: Record<string, unknown>) {
    vi.mocked(verifySignature).mockResolvedValue(true);
    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({ destination: 'destination', events: [event] }),
      },
      baseEnv,
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    const processingPromise = waitUntilMock.mock.calls[0]?.[0] as Promise<void> | undefined;
    expect(processingPromise).toBeDefined();
    await processingPromise;
  }

  test('records an unfollow as a block with the LINE event timestamp and webhook id', async () => {
    vi.mocked(getFriendByLineUserId).mockResolvedValue({
      id: 'friend-1',
      is_following: 1,
    } as never);

    await sendEvent({
      type: 'unfollow',
      timestamp: 1784941200123,
      webhookEventId: 'webhook-block-1',
      deliveryContext: { isRedelivery: false },
      source: { type: 'user', userId: 'U123' },
      mode: 'active',
    });

    expect(recordFriendFollowEvent).toHaveBeenCalledTimes(1);
    expect(recordFriendFollowEvent).toHaveBeenCalledWith(baseEnv.DB, {
      friendId: 'friend-1',
      eventType: 'blocked',
      eventTimestamp: 1784941200123,
      webhookEventId: 'webhook-block-1',
    });
  });

  test('records an initial follow as a friend-added event', async () => {
    const newFriend = {
      id: 'friend-new',
      line_user_id: 'U456',
      display_name: '新規ユーザー',
      is_following: 1,
      ref_code: 'known-ref',
      metadata: '{}',
    };
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(upsertFriend).mockResolvedValue(newFriend as never);
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null);
    vi.mocked(getScenarios).mockResolvedValue([]);
    getProfileMock.mockResolvedValue({
      displayName: '新規ユーザー',
      pictureUrl: null,
      statusMessage: null,
    });

    await sendEvent({
      type: 'follow',
      replyToken: 'reply-token',
      timestamp: 1784943000123,
      webhookEventId: 'webhook-added-1',
      deliveryContext: { isRedelivery: false },
      source: { type: 'user', userId: 'U456' },
      mode: 'active',
    });

    expect(upsertFriend).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({
      lineUserId: 'U456',
      isFollowing: true,
    }));
    expect(recordFriendFollowEvent).toHaveBeenCalledTimes(1);
    expect(recordFriendFollowEvent).toHaveBeenCalledWith(baseEnv.DB, {
      friendId: 'friend-new',
      eventType: 'added',
      eventTimestamp: 1784943000123,
      webhookEventId: 'webhook-added-1',
    });
  });

  test('records a repeat follow as an unblock without first forcing the friend to following', async () => {
    const blockedFriend = {
      id: 'friend-1',
      line_user_id: 'U123',
      display_name: 'テストユーザー',
      is_following: 0,
      ref_code: 'known-ref',
      metadata: '{}',
    };
    vi.mocked(getFriendByLineUserId).mockResolvedValue(blockedFriend as never);
    vi.mocked(upsertFriend).mockResolvedValue(blockedFriend as never);
    vi.mocked(getEntryRouteByRefCode).mockResolvedValue(null);
    vi.mocked(getScenarios).mockResolvedValue([]);
    getProfileMock.mockResolvedValue({
      displayName: 'テストユーザー',
      pictureUrl: null,
      statusMessage: null,
    });

    await sendEvent({
      type: 'follow',
      replyToken: 'reply-token',
      timestamp: 1784944800456,
      webhookEventId: 'webhook-unblock-1',
      deliveryContext: { isRedelivery: false },
      source: { type: 'user', userId: 'U123' },
      mode: 'active',
    });

    expect(upsertFriend).toHaveBeenCalledWith(baseEnv.DB, expect.objectContaining({
      lineUserId: 'U123',
      isFollowing: false,
    }));
    expect(recordFriendFollowEvent).toHaveBeenCalledTimes(1);
    expect(recordFriendFollowEvent).toHaveBeenCalledWith(baseEnv.DB, {
      friendId: 'friend-1',
      eventType: 'unblocked',
      eventTimestamp: 1784944800456,
      webhookEventId: 'webhook-unblock-1',
    });
  });
});

describe('POST /webhook — pre-Harness friends', () => {
  const validShapedSignature = 'A'.repeat(43) + '=';

  async function sendEvent(event: Record<string, unknown>, db: D1Database) {
    vi.mocked(verifySignature).mockResolvedValue(true);
    vi.mocked(getLineAccounts).mockResolvedValue([{
      id: 'account-1',
      name: 'LINE Harness',
      channel_id: 'channel-1',
      channel_secret: 'env-default-secret',
      channel_access_token: 'account-token',
      is_active: 1,
    }] as never);

    const app = setupApp();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Line-Signature': validShapedSignature,
        },
        body: JSON.stringify({ destination: 'destination', events: [event] }),
      },
      { ...baseEnv, DB: db },
      baseExecutionCtx,
    );
    expect(res.status).toBe(200);
    const processingPromise = waitUntilMock.mock.calls[0]?.[0] as Promise<void> | undefined;
    expect(processingPromise).toBeDefined();
    await processingPromise;
  }

  test('imports an unknown existing friend when they send a text message', async () => {
    const { db, statements } = createDbStub();
    const importedFriend = {
      id: 'friend-imported',
      line_user_id: 'U-existing',
      display_name: '導入前ユーザー',
      picture_url: 'https://example.test/profile.jpg',
      status_message: null,
      is_following: 1,
      blocked_at: null,
      last_unblocked_at: null,
      user_id: null,
      line_account_id: null,
      ref_code: null,
      metadata: '{}',
      first_tracked_link_id: null,
      created_at: '2026-07-28T12:00:00.000+09:00',
      updated_at: '2026-07-28T12:00:00.000+09:00',
    };
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(upsertFriend).mockResolvedValue(importedFriend);
    vi.mocked(jstNow).mockReturnValue('2026-07-28T12:00:00.000+09:00');
    getProfileMock.mockResolvedValue({
      userId: 'U-existing',
      displayName: '導入前ユーザー',
      pictureUrl: 'https://example.test/profile.jpg',
    });

    await sendEvent({
      type: 'message',
      replyToken: 'reply-token',
      timestamp: 1785207600000,
      webhookEventId: 'webhook-message-1',
      deliveryContext: { isRedelivery: false },
      source: { type: 'user', userId: 'U-existing' },
      mode: 'active',
      message: { id: 'message-1', type: 'text', text: '相談したいです' },
    }, db);

    expect(upsertFriend).toHaveBeenCalledWith(db, {
      lineUserId: 'U-existing',
      displayName: '導入前ユーザー',
      pictureUrl: 'https://example.test/profile.jpg',
      statusMessage: null,
      isFollowing: true,
    });
    expect(statements.some((s) =>
      s.sql.includes('UPDATE friends') &&
      s.bindings[0] === 'account-1' &&
      s.bindings.at(-1) === 'friend-imported'
    )).toBe(true);
    expect(statements.some((s) =>
      s.sql.includes('INSERT INTO messages_log') &&
      s.bindings.includes('相談したいです') &&
      s.bindings.includes('account-1')
    )).toBe(true);
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-imported');
    expect(fireEvent).toHaveBeenCalledWith(
      db,
      'message_received',
      expect.objectContaining({ friendId: 'friend-imported' }),
      'account-token',
      'account-1',
    );
    expect(recordFriendFollowEvent).not.toHaveBeenCalled();
    expect(getScenarios).not.toHaveBeenCalled();
  });

  test('imports an unknown existing friend when they send a non-text message', async () => {
    const { db, statements } = createDbStub();
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null);
    vi.mocked(upsertFriend).mockResolvedValue({
      id: 'friend-image',
      line_user_id: 'U-image',
      display_name: '画像ユーザー',
      is_following: 1,
      line_account_id: null,
    } as never);
    vi.mocked(jstNow).mockReturnValue('2026-07-28T12:05:00.000+09:00');
    getProfileMock.mockResolvedValue({ userId: 'U-image', displayName: '画像ユーザー' });

    await sendEvent({
      type: 'message',
      replyToken: 'reply-token',
      timestamp: 1785207900000,
      webhookEventId: 'webhook-message-2',
      deliveryContext: { isRedelivery: false },
      source: { type: 'user', userId: 'U-image' },
      mode: 'active',
      message: { id: 'message-2', type: 'image', contentProvider: { type: 'line' } },
    }, db);

    expect(statements.some((s) =>
      s.sql.includes('INSERT INTO messages_log') &&
      s.bindings.includes('image') &&
      s.bindings.includes('account-1')
    )).toBe(true);
    expect(upsertChatOnMessage).toHaveBeenCalledWith(db, 'friend-image');
    expect(fireEvent).not.toHaveBeenCalled();
  });
});
