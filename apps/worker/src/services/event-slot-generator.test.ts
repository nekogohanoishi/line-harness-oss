// Phase 6a: event-slot-generator のユニットテスト。
// memDB スタブを使って generateSlotsForRecurrence / runAllRecurrenceGeneration の
// happy-path / idempotency / weekly フィルタを検証する。

import { describe, expect, test } from 'vitest';
import {
  generateSlotsForRecurrence,
  runAllRecurrenceGeneration,
  type RecurrenceRow,
} from './event-slot-generator.js';

interface SlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  deleted_at: string | null;
}

interface State {
  recurrences: RecurrenceRow[];
  slots: SlotRow[];
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
          return null as T | null;
        },
        async all<T>() {
          if (sql.includes('FROM event_slot_recurrence') && sql.includes('is_active = 1')) {
            return {
              results: state.recurrences.filter((r) => r.is_active === 1) as unknown as T[],
            };
          }
          if (sql.includes('FROM event_slots') && sql.includes('event_id = ?')) {
            const [event_id, startIso, endIso] = bound as [string, string, string];
            const items = state.slots.filter(
              (s) =>
                s.event_id === event_id &&
                s.deleted_at == null &&
                s.starts_at >= startIso &&
                s.starts_at < endIso,
            );
            return { results: items as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (sql.startsWith('INSERT INTO event_slots')) {
            const [id, event_id, starts_at, ends_at, capacity] = bound as [
              string,
              string,
              string,
              string,
              number | null,
            ];
            state.slots.push({
              id,
              event_id,
              starts_at,
              ends_at,
              capacity,
              is_active: 1,
              sort_order: 0,
              deleted_at: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_slot_recurrence') && sql.includes('last_generated_through')) {
            const [last, _updated, id] = bound as [string, string, string];
            const r = state.recurrences.find((x) => x.id === id);
            if (r) r.last_generated_through = last;
            return { success: true, meta: { changes: r ? 1 : 0 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function makeRec(overrides: Partial<RecurrenceRow> = {}): RecurrenceRow {
  return {
    id: 'rec1',
    event_id: 'ev1',
    pattern_type: 'daily',
    weekdays_json: null,
    times_json: '["10:00","20:00"]',
    duration_minutes: 60,
    capacity: 50,
    generate_days_ahead: 3,
    timezone: 'Asia/Tokyo',
    is_active: 1,
    last_generated_through: null,
    ...overrides,
  };
}

describe('generateSlotsForRecurrence', () => {
  test('daily pattern inserts slots for today through generate_days_ahead', async () => {
    const state: State = { recurrences: [], slots: [] };
    const db = makeDb(state);
    // 2026-05-15 12:00 JST = 2026-05-15 03:00 UTC
    const now = new Date('2026-05-15T03:00:00Z');
    const rec = makeRec({ generate_days_ahead: 2 });
    state.recurrences.push(rec);

    const res = await generateSlotsForRecurrence(db, rec, { now });
    // 3 日 (today, +1, +2) × 2 times = 6 slots
    expect(res.inserted).toBe(6);
    expect(res.skippedDuplicate).toBe(0);
    expect(state.slots).toHaveLength(6);
    // 1 つ目: 2026-05-15 10:00 JST = 2026-05-15 01:00 UTC
    const starts = state.slots.map((s) => s.starts_at).sort();
    expect(starts[0]).toBe('2026-05-15T01:00:00.000Z');
    // 2 つ目同日 20:00 JST = 11:00 UTC
    expect(starts[1]).toBe('2026-05-15T11:00:00.000Z');
    // last_generated_through 更新
    expect(res.lastGeneratedThrough).toBe('2026-05-17');
    expect(rec.last_generated_through).toBe('2026-05-17');
    // capacity / ends_at が反映されている
    expect(state.slots[0].capacity).toBe(50);
    // ends_at は starts_at + 60min
    const s0 = state.slots[0];
    expect(new Date(s0.ends_at).getTime() - new Date(s0.starts_at).getTime()).toBe(60 * 60_000);
  });

  test('idempotent: re-running with same now does nothing', async () => {
    const state: State = { recurrences: [], slots: [] };
    const db = makeDb(state);
    const now = new Date('2026-05-15T03:00:00Z');
    const rec = makeRec({ generate_days_ahead: 1 });
    state.recurrences.push(rec);

    const r1 = await generateSlotsForRecurrence(db, rec, { now });
    expect(r1.inserted).toBe(4); // 2 days × 2 times
    const r2 = await generateSlotsForRecurrence(db, rec, { now });
    // last_generated_through が 2026-05-16 なので、再走しても何もせず終わる
    expect(r2.inserted).toBe(0);
    expect(state.slots).toHaveLength(4);
  });

  test('idempotent: pre-existing slot at same starts_at is skipped', async () => {
    const state: State = { recurrences: [], slots: [] };
    const db = makeDb(state);
    const now = new Date('2026-05-15T03:00:00Z');
    // 既存 slot: 2026-05-15 10:00 JST = 01:00 UTC
    state.slots.push({
      id: 'existing-1',
      event_id: 'ev1',
      starts_at: '2026-05-15T01:00:00.000Z',
      ends_at: '2026-05-15T02:00:00.000Z',
      capacity: 99,
      is_active: 1,
      sort_order: 0,
      deleted_at: null,
    });
    const rec = makeRec({ generate_days_ahead: 0 }); // 今日のみ
    const res = await generateSlotsForRecurrence(db, rec, { now });
    // 2 times のうち 10:00 は既存と重複でスキップされ、20:00 のみ追加
    expect(res.inserted).toBe(1);
    expect(res.skippedDuplicate).toBe(1);
    expect(state.slots).toHaveLength(2);
  });

  test('weekly pattern filters by weekdays_json', async () => {
    const state: State = { recurrences: [], slots: [] };
    const db = makeDb(state);
    // 2026-05-15 は金曜 (5)。土曜 (6) と日曜 (0) のみ生成するルール。
    const now = new Date('2026-05-15T03:00:00Z');
    const rec = makeRec({
      pattern_type: 'weekly',
      weekdays_json: '[0,6]',
      times_json: '["10:00"]',
      generate_days_ahead: 2, // today(5/15金), 5/16土, 5/17日
    });
    const res = await generateSlotsForRecurrence(db, rec, { now });
    // 5/16 土曜 + 5/17 日曜 = 2 slots
    expect(res.inserted).toBe(2);
    const dates = state.slots.map((s) => s.starts_at).sort();
    expect(dates[0]).toBe('2026-05-16T01:00:00.000Z');
    expect(dates[1]).toBe('2026-05-17T01:00:00.000Z');
  });

  test('invalid times_json returns errors and does not insert', async () => {
    const state: State = { recurrences: [], slots: [] };
    const db = makeDb(state);
    const rec = makeRec({ times_json: '["25:00"]' });
    const res = await generateSlotsForRecurrence(db, rec);
    expect(res.errors).toBeGreaterThan(0);
    expect(res.inserted).toBe(0);
    expect(state.slots).toHaveLength(0);
  });
});

describe('runAllRecurrenceGeneration', () => {
  test('runs over all active rules and aggregates counts', async () => {
    const state: State = { recurrences: [], slots: [] };
    const now = new Date('2026-05-15T03:00:00Z');
    state.recurrences.push(
      makeRec({ id: 'r1', event_id: 'ev1', generate_days_ahead: 0, times_json: '["10:00"]' }),
      makeRec({ id: 'r2', event_id: 'ev2', generate_days_ahead: 0, times_json: '["12:00","13:00"]' }),
      // 非アクティブはスキップ
      makeRec({ id: 'r3', event_id: 'ev3', is_active: 0, times_json: '["09:00"]' }),
    );
    const db = makeDb(state);
    const res = await runAllRecurrenceGeneration(db, { now });
    expect(res.total).toBe(2); // r3 は is_active=0 なので SELECT で弾かれる
    expect(res.inserted).toBe(3); // 1 + 2
    expect(state.slots).toHaveLength(3);
  });
});
