import { beforeEach, describe, expect, test, vi } from 'vitest';

const eventBusMocks = {
  fireEvent: vi.fn().mockResolvedValue(undefined),
};
vi.mock('./event-bus.js', () => eventBusMocks);

const { processWebinarAbandonment } = await import('./webinar-abandonment.js');

interface BookingRow {
  id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  line_account_id: string;
  status: string;
  webinar_video_started_at: string | null;
  webinar_last_heartbeat_at: string | null;
  webinar_completed_at: string | null;
  webinar_abandoned_at: string | null;
  webinar_max_position_seconds: number;
}

interface EventRow {
  id: string;
  kind: string;
}

interface SlotRow {
  id: string;
  starts_at: string;
}

interface LineAccountRow {
  id: string;
  channel_access_token: string | null;
}

interface State {
  bookings: BookingRow[];
  events: EventRow[];
  slots: SlotRow[];
  lineAccounts: LineAccountRow[];
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
        async all<T>() {
          if (sql.includes('FROM event_bookings b') && sql.includes("e.kind = 'webinar'")) {
            const [cutoff, nowIso, limit] = bound as [string, string, number];
            const rows = state.bookings
              .filter((b) => {
                const e = state.events.find((x) => x.id === b.event_id);
                const s = state.slots.find((x) => x.id === b.slot_id);
                return (
                  e?.kind === 'webinar' &&
                  s != null &&
                  s.starts_at <= nowIso &&
                  b.status === 'confirmed' &&
                  b.webinar_video_started_at != null &&
                  b.webinar_last_heartbeat_at != null &&
                  b.webinar_last_heartbeat_at <= cutoff &&
                  b.webinar_completed_at == null &&
                  b.webinar_abandoned_at == null
                );
              })
              .sort((a, b) =>
                (a.webinar_last_heartbeat_at ?? '').localeCompare(b.webinar_last_heartbeat_at ?? ''),
              )
              .slice(0, limit)
              .map((b) => {
                const la = state.lineAccounts.find((x) => x.id === b.line_account_id);
                return {
                  booking_id: b.id,
                  event_id: b.event_id,
                  friend_id: b.friend_id,
                  line_account_id: b.line_account_id,
                  channel_access_token: la?.channel_access_token ?? null,
                  webinar_last_heartbeat_at: b.webinar_last_heartbeat_at!,
                  webinar_max_position_seconds: b.webinar_max_position_seconds,
                };
              });
            return { results: rows as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.startsWith('UPDATE event_bookings')) {
            const [abandonedAt, updatedAt, id] = bound as [string, string, string];
            const b = state.bookings.find((x) => x.id === id);
            if (!b || b.webinar_abandoned_at != null || b.webinar_completed_at != null) {
              return { success: true, meta: { changes: 0 } };
            }
            b.webinar_abandoned_at = abandonedAt;
            (b as unknown as { updated_at?: string }).updated_at = updatedAt;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function baseState(now: Date): State {
  return {
    events: [{ id: 'ev1', kind: 'webinar' }],
    slots: [{ id: 'sl1', starts_at: new Date(now.getTime() - 60_000).toISOString() }],
    lineAccounts: [{ id: 'la1', channel_access_token: 'line-token' }],
    bookings: [],
  };
}

function booking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'b1',
    event_id: 'ev1',
    slot_id: 'sl1',
    friend_id: 'f1',
    line_account_id: 'la1',
    status: 'confirmed',
    webinar_video_started_at: '2026-05-20T00:00:00.000Z',
    webinar_last_heartbeat_at: '2026-05-20T00:05:00.000Z',
    webinar_completed_at: null,
    webinar_abandoned_at: null,
    webinar_max_position_seconds: 320,
    ...overrides,
  };
}

beforeEach(() => {
  eventBusMocks.fireEvent.mockClear();
  eventBusMocks.fireEvent.mockResolvedValue(undefined);
});

describe('processWebinarAbandonment', () => {
  test('marks stale started booking and fires webinar_abandoned once', async () => {
    const now = new Date('2026-05-20T00:20:00.000Z');
    const state = baseState(now);
    state.bookings.push(booking());
    const db = makeDb(state);

    const result = await processWebinarAbandonment(db, {
      now,
      abandonedAfterSeconds: 600,
    });

    expect(result).toEqual({ scanned: 1, marked: 1, fired: 1, failed: 0 });
    expect(state.bookings[0].webinar_abandoned_at).toBe(now.toISOString());
    expect(eventBusMocks.fireEvent).toHaveBeenCalledTimes(1);
    expect(eventBusMocks.fireEvent.mock.calls[0][1]).toBe('webinar_abandoned');
    expect(eventBusMocks.fireEvent.mock.calls[0][2]).toMatchObject({
      friendId: 'f1',
      eventData: {
        eventId: 'ev1',
        bookingId: 'b1',
        positionSeconds: 320,
        lastHeartbeatAt: '2026-05-20T00:05:00.000Z',
        abandonedAfterSeconds: 600,
      },
    });
  });

  test('skips completed, already abandoned, and fresh heartbeat bookings', async () => {
    const now = new Date('2026-05-20T00:20:00.000Z');
    const state = baseState(now);
    state.bookings.push(
      booking({ id: 'completed', webinar_completed_at: '2026-05-20T00:10:00.000Z' }),
      booking({ id: 'abandoned', webinar_abandoned_at: '2026-05-20T00:12:00.000Z' }),
      booking({ id: 'fresh', webinar_last_heartbeat_at: '2026-05-20T00:15:30.000Z' }),
    );
    const db = makeDb(state);

    const result = await processWebinarAbandonment(db, {
      now,
      abandonedAfterSeconds: 600,
    });

    expect(result).toEqual({ scanned: 0, marked: 0, fired: 0, failed: 0 });
    expect(eventBusMocks.fireEvent).not.toHaveBeenCalled();
  });
});
