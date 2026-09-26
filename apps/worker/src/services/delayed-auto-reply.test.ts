import { describe, expect, it, vi } from 'vitest';
import {
  buildRoadmapInvitationText,
  deliverDelayedAutoReply,
  getDelayedAutoReplyControl,
  getDelayedAutoReplyWaitSeconds,
  pushLineMessageWithRetryKey,
  resolveDelayedAutoReplyMessage,
  setDelayedAutoReplyPaused,
} from './delayed-auto-reply.js';

const payload = {
  deliveryId: '123e4567-e89b-12d3-a456-426614174000',
  friendId: 'friend-1',
  lineAccountId: 'account-1',
  messageType: 'text',
  messageContent: 'hello',
};

describe('getDelayedAutoReplyWaitSeconds', () => {
  it('caps a future wait at the Cloudflare Queue 24-hour maximum', () => {
    expect(getDelayedAutoReplyWaitSeconds(
      { ...payload, deliverAt: '2026-08-20T11:00:00.000Z' },
      new Date('2026-08-19T09:00:01.000Z'),
    )).toBe(86_400);
  });

  it('returns the remaining wait after the first queue delay', () => {
    expect(getDelayedAutoReplyWaitSeconds(
      { ...payload, deliverAt: '2026-08-20T11:00:00.000Z' },
      new Date('2026-08-20T09:00:01.000Z'),
    )).toBe(7_199);
  });

  it('allows delivery when the target time has arrived', () => {
    expect(getDelayedAutoReplyWaitSeconds(
      { ...payload, deliverAt: '2026-08-20T11:00:00.000Z' },
      new Date('2026-08-20T11:00:00.000Z'),
    )).toBe(0);
  });
});

describe('queued roadmap invitation migration', () => {
  const oldRoadmapFlex = JSON.stringify({
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: '解説速報はもうご覧いただけましたか。' }],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'button',
        action: {
          type: 'message',
          label: '作成会の詳しい案内を見る',
          text: 'ロードマップ作成会について',
        },
      }],
    },
  });

  it('replaces an already queued old roadmap Flex with the current text invitation', () => {
    expect(resolveDelayedAutoReplyMessage({
      messageType: 'flex',
      messageContent: oldRoadmapFlex,
    }, 'れい')).toEqual({
      messageType: 'text',
      messageContent: buildRoadmapInvitationText('れい'),
    });
    expect(buildRoadmapInvitationText('れい')).toContain('れいさん');
    expect(buildRoadmapInvitationText('れい')).toContain('「作成会希望」と送ってください。');
  });

  it('does not change unrelated delayed messages', () => {
    expect(resolveDelayedAutoReplyMessage({
      messageType: 'flex',
      messageContent: JSON.stringify({ type: 'bubble', body: { type: 'box' } }),
    }, 'れい')).toEqual({
      messageType: 'flex',
      messageContent: JSON.stringify({ type: 'bubble', body: { type: 'box' } }),
    });
  });
});

describe('friend-level delayed auto-reply control', () => {
  it('preserves normal metadata while pausing and removes only the control when resuming', () => {
    const paused = setDelayedAutoReplyPaused(
      JSON.stringify({ target_exam: '司法試験' }),
      true,
      '2026-08-27T18:00:00.000+09:00',
    );
    expect(JSON.parse(paused)).toMatchObject({ target_exam: '司法試験' });
    expect(getDelayedAutoReplyControl(paused)).toEqual({
      paused: true,
      pausedAt: '2026-08-27T18:00:00.000+09:00',
    });

    const resumed = setDelayedAutoReplyPaused(paused, false, '2026-08-27T19:00:00.000+09:00');
    expect(JSON.parse(resumed)).toEqual({ target_exam: '司法試験' });
    expect(getDelayedAutoReplyControl(resumed)).toEqual({ paused: false, pausedAt: null });
  });

  it('skips an already queued message when the friend is paused before delivery', async () => {
    const metadata = setDelayedAutoReplyPaused(
      '{}',
      true,
      '2026-08-27T18:00:00.000+09:00',
    );
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => sql.includes('messages_log')
            ? null
            : {
                id: 'friend-1',
                is_following: 1,
                metadata,
                line_account_id: null,
              },
        }),
      }),
    } as unknown as D1Database;

    await expect(deliverDelayedAutoReply(db, payload, 'default-token')).resolves.toBe('skipped');
  });
});

describe('pushLineMessageWithRetryKey', () => {
  it('sends a push with the LINE retry key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(pushLineMessageWithRetryKey(
      fetcher,
      'token',
      'U123',
      [{ type: 'text', text: 'hello' }],
      '123e4567-e89b-12d3-a456-426614174000',
    )).resolves.toBe('sent');

    expect(fetcher).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Line-Retry-Key': '123e4567-e89b-12d3-a456-426614174000',
        }),
      }),
    );
  });

  it('treats a previously accepted retry key as success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', {
      status: 409,
      headers: { 'x-line-accepted-request-id': 'accepted-request-id' },
    }));

    await expect(pushLineMessageWithRetryKey(
      fetcher,
      'token',
      'U123',
      [{ type: 'text', text: 'hello' }],
      '123e4567-e89b-12d3-a456-426614174000',
    )).resolves.toBe('already_sent');
  });

  it('throws for an unaccepted LINE error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('server error', { status: 500 }));

    await expect(pushLineMessageWithRetryKey(
      fetcher,
      'token',
      'U123',
      [{ type: 'text', text: 'hello' }],
      '123e4567-e89b-12d3-a456-426614174000',
    )).rejects.toThrow('LINE delayed push failed: 500');
  });
});
