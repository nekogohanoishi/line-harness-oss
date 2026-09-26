import { describe, expect, it } from 'vitest';
import {
  computeScheduledAutoReplyAt,
  parseAutoReplyMessages,
  resolveAutoReplySchedule,
  validateAutoReplyResponse,
} from './auto-reply-messages.js';

describe('parseAutoReplyMessages', () => {
  it('keeps a single-message response compatible', () => {
    expect(parseAutoReplyMessages('text', 'hello')).toEqual([
      { messageType: 'text', messageContent: 'hello', delaySeconds: 0 },
    ]);
  });

  it('parses an ordered sequence', () => {
    const content = JSON.stringify({
      messages: [
        { messageType: 'text', messageContent: 'first' },
        { messageType: 'flex', messageContent: '{"type":"bubble"}', delaySeconds: 30 },
      ],
    });

    expect(parseAutoReplyMessages('sequence', content)).toEqual([
      { messageType: 'text', messageContent: 'first', delaySeconds: 0 },
      { messageType: 'flex', messageContent: '{"type":"bubble"}', delaySeconds: 30 },
    ]);
  });

  it('rejects an empty or oversized sequence', () => {
    expect(validateAutoReplyResponse('sequence', '{"messages":[]}')).toContain('at least one');
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: Array.from({ length: 6 }, () => ({ messageType: 'text', messageContent: 'x' })),
    }))).toContain('more than 5');
  });

  it('rejects unsupported message types and empty content', () => {
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: [{ messageType: 'video', messageContent: 'x' }],
    }))).toContain('unsupported');
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: [{ messageType: 'text', messageContent: '   ' }],
    }))).toContain('requires messageContent');
  });

  it('rejects non-integer or out-of-range delays', () => {
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: [{ messageType: 'text', messageContent: 'x', delaySeconds: 0.5 }],
    }))).toContain('integer from 0 to 86400');
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: [{ messageType: 'text', messageContent: 'x', delaySeconds: 86_401 }],
    }))).toContain('integer from 0 to 86400');
  });

  it('parses a JST clock schedule', () => {
    const content = JSON.stringify({
      messages: [{
        messageType: 'flex',
        messageContent: '{"type":"bubble"}',
        deliveryTimeJst: '20:00',
        sameDayCutoffTimeJst: '18:00',
      }],
    });

    expect(parseAutoReplyMessages('sequence', content)).toEqual([{
      messageType: 'flex',
      messageContent: '{"type":"bubble"}',
      delaySeconds: 0,
      deliveryTimeJst: '20:00',
      sameDayCutoffTimeJst: '18:00',
    }]);
  });

  it('rejects incomplete or conflicting clock schedules', () => {
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: [{ messageType: 'text', messageContent: 'x', deliveryTimeJst: '20:00' }],
    }))).toContain('requires both');
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: [{
        messageType: 'text',
        messageContent: 'x',
        deliveryTimeJst: '18:00',
        sameDayCutoffTimeJst: '20:00',
      }],
    }))).toContain('must be later');
    expect(validateAutoReplyResponse('sequence', JSON.stringify({
      messages: [{
        messageType: 'text',
        messageContent: 'x',
        delaySeconds: 30,
        deliveryTimeJst: '20:00',
        sameDayCutoffTimeJst: '18:00',
      }],
    }))).toContain('cannot combine');
  });
});

describe('computeScheduledAutoReplyAt', () => {
  it('uses the same day through the 18:00 JST cutoff', () => {
    expect(computeScheduledAutoReplyAt(
      new Date('2026-08-19T09:00:00.000Z'),
      '20:00',
      '18:00',
    ).toISOString()).toBe('2026-08-19T11:00:00.000Z');
  });

  it('uses the next day immediately after the cutoff', () => {
    const now = new Date('2026-08-19T09:00:01.000Z');
    const message = {
      messageType: 'flex',
      messageContent: '{"type":"bubble"}',
      deliveryTimeJst: '20:00',
      sameDayCutoffTimeJst: '18:00',
    };

    expect(resolveAutoReplySchedule(message, now)).toEqual({
      delaySeconds: 93_599,
      deliverAt: '2026-08-20T11:00:00.000Z',
    });
  });
});
