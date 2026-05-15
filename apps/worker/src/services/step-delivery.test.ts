// Phase 6c: webinar / cart countdown template 変数の単体テスト。
// expandVariables の純粋関数部分 + formatRemainingJa / formatDateTimeJa /
// findActiveBookingForFriend / findActiveCartStatusForFriend を検証。

import { describe, expect, test } from 'vitest';
import {
  expandVariables,
  formatRemainingJa,
  formatDateTimeJa,
  findActiveBookingForFriend,
  findActiveCartStatusForFriend,
} from './step-delivery.js';

const baseFriend = {
  id: 'f1',
  display_name: 'Taro',
  user_id: 'u1',
  metadata: {} as Record<string, unknown>,
};

describe('formatRemainingJa', () => {
  const now = new Date('2026-05-15T00:00:00Z');

  test('past => "終了"', () => {
    expect(formatRemainingJa('2026-05-14T23:59:00Z', now)).toBe('終了');
  });
  test('< 1 min => "もうすぐ"', () => {
    expect(formatRemainingJa('2026-05-15T00:00:30Z', now)).toBe('もうすぐ');
  });
  test('< 60 min => "あとN分"', () => {
    expect(formatRemainingJa('2026-05-15T00:45:00Z', now)).toBe('あと45分');
  });
  test('< 24h => "あとN時間M分"', () => {
    expect(formatRemainingJa('2026-05-15T03:20:00Z', now)).toBe('あと3時間20分');
  });
  test('< 24h whole hour => "あとN時間"', () => {
    expect(formatRemainingJa('2026-05-15T05:00:00Z', now)).toBe('あと5時間');
  });
  test('>= 24h => "あとN日"', () => {
    expect(formatRemainingJa('2026-05-17T00:00:00Z', now)).toBe('あと2日');
  });
});

describe('formatDateTimeJa', () => {
  test('formats UTC ISO to JST clock', () => {
    // 2026-05-16 11:00 UTC -> 2026-05-16 20:00 JST
    expect(formatDateTimeJa('2026-05-16T11:00:00Z')).toBe('2026-05-16 20:00');
  });
});

describe('expandVariables: webinar / cart vars', () => {
  test('expands webinar_starts_in / webinar_starts_at / webinar_url', () => {
    const ctx = {
      bookingId: 'b1',
      bookingStartsAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
      workerUrl: 'https://example.test',
    };
    const out = expandVariables(
      'starts {{webinar_starts_in}} at {{webinar_starts_at}} url={{webinar_url}}',
      baseFriend,
      undefined,
      ctx,
    );
    expect(out).toMatch(/starts あと(1時間5[5-9]分|2時間) at /);
    expect(out).toContain('url=https://example.test/liff/webinar/b1');
  });

  test('webinar vars become empty string when ctx is absent', () => {
    const out = expandVariables(
      'before [{{webinar_starts_in}}] [{{webinar_url}}] after',
      baseFriend,
    );
    expect(out).toBe('before [] [] after');
  });

  test('cart_closes_in formats remaining time', () => {
    const ctx = {
      cartClosesAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const out = expandVariables('close: {{cart_closes_in}}', baseFriend, undefined, ctx);
    expect(out).toMatch(/^close: あと(29|30)分$/);
  });

  test('still expands {{name}} normally without ctx', () => {
    const out = expandVariables('hi {{name}}', { ...baseFriend, display_name: 'Hanako' });
    expect(out).toBe('hi Hanako');
  });
});

// ---- DB stubs for finder helpers ----

interface BookingRow {
  id: string;
  friend_id: string;
  event_id: string;
  slot_id: string;
  status: string;
}
interface SlotRow {
  id: string;
  starts_at: string;
  ends_at: string;
  deleted_at: string | null;
}
interface CartStatusRow {
  booking_id: string;
  event_id: string;
  friend_id: string;
  opened_at: string | null;
  closes_at: string | null;
  purchased_at: string | null;
}

interface State {
  bookings: BookingRow[];
  slots: SlotRow[];
  cartStatuses: CartStatusRow[];
}

function makeDb(state: State): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          if (
            sql.includes('FROM event_bookings b') &&
            sql.includes('JOIN event_slots s') &&
            sql.includes("status = 'confirmed'")
          ) {
            const [friendId, nowIso] = bound as [string, string];
            const eligible = state.bookings
              .filter((b) => b.friend_id === friendId && b.status === 'confirmed')
              .map((b) => {
                const s = state.slots.find(
                  (x) => x.id === b.slot_id && x.deleted_at == null && x.ends_at > nowIso,
                );
                return s ? { booking: b, slot: s } : null;
              })
              .filter((x): x is { booking: BookingRow; slot: SlotRow } => x != null)
              .sort((a, b) => a.slot.starts_at.localeCompare(b.slot.starts_at));
            const winner = eligible[0];
            if (!winner) return null as T | null;
            return {
              booking_id: winner.booking.id,
              event_id: winner.booking.event_id,
              starts_at: winner.slot.starts_at,
              ends_at: winner.slot.ends_at,
            } as T;
          }
          if (
            sql.includes('FROM event_cart_status') &&
            sql.includes('opened_at IS NOT NULL')
          ) {
            const [friendId, nowIso] = bound as [string, string];
            const eligible = state.cartStatuses
              .filter(
                (c) =>
                  c.friend_id === friendId &&
                  c.opened_at != null &&
                  c.closes_at != null &&
                  c.closes_at > nowIso &&
                  c.purchased_at == null,
              )
              .sort((a, b) => (a.closes_at ?? '').localeCompare(b.closes_at ?? ''));
            const winner = eligible[0];
            if (!winner) return null as T | null;
            return {
              booking_id: winner.booking_id,
              event_id: winner.event_id,
              closes_at: winner.closes_at,
            } as T;
          }
          return null as T | null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('finder helpers', () => {
  test('findActiveBookingForFriend returns the nearest future confirmed booking', async () => {
    const now = new Date('2026-05-15T00:00:00Z');
    const state: State = {
      bookings: [
        { id: 'b1', friend_id: 'f1', event_id: 'ev1', slot_id: 'sl1', status: 'confirmed' },
        { id: 'b2', friend_id: 'f1', event_id: 'ev2', slot_id: 'sl2', status: 'confirmed' },
        { id: 'b3', friend_id: 'f1', event_id: 'ev3', slot_id: 'sl3', status: 'requested' },
      ],
      slots: [
        {
          id: 'sl1',
          starts_at: '2026-05-15T10:00:00Z',
          ends_at: '2026-05-15T11:00:00Z',
          deleted_at: null,
        },
        {
          id: 'sl2',
          starts_at: '2026-05-15T03:00:00Z',
          ends_at: '2026-05-15T04:00:00Z',
          deleted_at: null,
        },
        {
          id: 'sl3',
          starts_at: '2026-05-15T02:00:00Z',
          ends_at: '2026-05-15T03:00:00Z',
          deleted_at: null,
        },
      ],
      cartStatuses: [],
    };
    const db = makeDb(state);
    const r = await findActiveBookingForFriend(db, 'f1', now);
    expect(r).not.toBeNull();
    expect(r!.booking_id).toBe('b2'); // earliest future confirmed
  });

  test('findActiveBookingForFriend ignores past bookings (ends_at <= now)', async () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const state: State = {
      bookings: [{ id: 'b1', friend_id: 'f1', event_id: 'ev1', slot_id: 'sl1', status: 'confirmed' }],
      slots: [
        {
          id: 'sl1',
          starts_at: '2026-05-15T10:00:00Z',
          ends_at: '2026-05-15T11:00:00Z',
          deleted_at: null,
        },
      ],
      cartStatuses: [],
    };
    const db = makeDb(state);
    const r = await findActiveBookingForFriend(db, 'f1', now);
    expect(r).toBeNull();
  });

  test('findActiveCartStatusForFriend returns nearest closing open cart', async () => {
    const now = new Date('2026-05-15T00:00:00Z');
    const state: State = {
      bookings: [],
      slots: [],
      cartStatuses: [
        {
          booking_id: 'b1',
          event_id: 'ev1',
          friend_id: 'f1',
          opened_at: '2026-05-14T22:00:00Z',
          closes_at: '2026-05-15T02:00:00Z',
          purchased_at: null,
        },
        {
          booking_id: 'b2',
          event_id: 'ev2',
          friend_id: 'f1',
          opened_at: '2026-05-14T23:00:00Z',
          closes_at: '2026-05-15T01:00:00Z',
          purchased_at: null,
        },
        // purchased -> excluded
        {
          booking_id: 'b3',
          event_id: 'ev3',
          friend_id: 'f1',
          opened_at: '2026-05-14T20:00:00Z',
          closes_at: '2026-05-15T00:30:00Z',
          purchased_at: '2026-05-14T21:00:00Z',
        },
      ],
    };
    const db = makeDb(state);
    const r = await findActiveCartStatusForFriend(db, 'f1', now);
    expect(r).not.toBeNull();
    expect(r!.booking_id).toBe('b2');
  });
});
