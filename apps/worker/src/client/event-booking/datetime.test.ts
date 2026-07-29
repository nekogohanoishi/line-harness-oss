// datetime.test.ts — event-booking LIFF の日時純関数のテスト。
// UTC→JST 変換が端末タイムゾーンに依存せず固定 +9 時間であることを確認する。

import { describe, expect, it } from 'vitest';
import {
  durationMinutes,
  formatJstDateTime,
  formatJstLongDateTime,
  formatJstShortDate,
  formatJstTime,
  groupByJstDate,
  jstDateKey,
  remainingLabel,
  toJstParts,
} from './datetime';

describe('toJstParts (UTC→JST 変換)', () => {
  it('UTC 12:00 は JST 21:00 になる', () => {
    expect(toJstParts('2026-07-31T12:00:00Z')).toEqual({
      year: 2026,
      month: 7,
      day: 31,
      weekday: '金',
      hour: 21,
      minute: 0,
    });
  });

  it('UTC 15:00 以降は JST では翌日に繰り上がる', () => {
    const p = toJstParts('2026-07-30T15:30:00Z'); // JST 2026-07-31 00:30
    expect(p.day).toBe(31);
    expect(p.hour).toBe(0);
    expect(p.minute).toBe(30);
    expect(p.weekday).toBe('金');
  });

  it('年をまたぐ境界も JST 基準で正しい', () => {
    const p = toJstParts('2026-12-31T22:05:00Z'); // JST 2027-01-01 07:05
    expect(p.year).toBe(2027);
    expect(p.month).toBe(1);
    expect(p.day).toBe(1);
    expect(p.weekday).toBe('金');
  });
});

describe('曜日付きフォーマット', () => {
  it('formatJstShortDate は M/D(曜) 形式', () => {
    expect(formatJstShortDate('2026-07-31T12:00:00Z')).toBe('7/31(金)');
  });

  it('formatJstTime はゼロ埋めの HH:MM', () => {
    expect(formatJstTime('2026-07-31T12:00:00Z')).toBe('21:00');
    expect(formatJstTime('2026-07-31T00:05:00Z')).toBe('09:05');
  });

  it('formatJstDateTime は CTA 向けの短い表記', () => {
    expect(formatJstDateTime('2026-07-31T12:00:00Z')).toBe('7/31(金) 21:00');
  });

  it('formatJstLongDateTime は年月日+時刻', () => {
    expect(formatJstLongDateTime('2026-12-31T22:05:00Z')).toBe('2027年1月1日(金) 07:05');
  });
});

describe('groupByJstDate (日付グループ化)', () => {
  it('JST の日付単位でまとまり、時刻順が保たれる', () => {
    const slots = [
      { id: 'c', starts_at: '2026-08-01T10:00:00Z' }, // JST 8/1 19:00
      { id: 'a', starts_at: '2026-07-31T12:00:00Z' }, // JST 7/31 21:00
      { id: 'b', starts_at: '2026-07-30T15:00:00Z' }, // JST 7/31 00:00 (UTC では前日)
    ];
    const groups = groupByJstDate(slots);
    expect(groups.map((g) => g.key)).toEqual(['2026-07-31', '2026-08-01']);
    expect(groups[0].items.map((s) => s.id)).toEqual(['b', 'a']);
    expect(groups[0].parts.weekday).toBe('金');
    expect(groups[1].items.map((s) => s.id)).toEqual(['c']);
  });

  it('空配列は空のグループ列を返す', () => {
    expect(groupByJstDate([])).toEqual([]);
  });

  it('jstDateKey は JST 基準の日付キーを返す', () => {
    expect(jstDateKey('2026-07-30T15:00:00Z')).toBe('2026-07-31');
    expect(jstDateKey('2026-07-30T14:59:00Z')).toBe('2026-07-30');
  });
});

describe('remainingLabel (残枠表示)', () => {
  it('残 0 以下は「満席」', () => {
    expect(remainingLabel(5, 0)).toEqual({ text: '満席', tone: 'full' });
    expect(remainingLabel(5, -1)).toEqual({ text: '満席', tone: 'full' });
  });

  it('残りわずか (3 以下) は「残N枠」', () => {
    expect(remainingLabel(5, 1)).toEqual({ text: '残1枠', tone: 'few' });
    expect(remainingLabel(5, 3)).toEqual({ text: '残3枠', tone: 'few' });
  });

  it('残枠が十分なら表示しない', () => {
    expect(remainingLabel(10, 8)).toBeNull();
  });

  it('定員なしは表示しない', () => {
    expect(remainingLabel(null, null)).toBeNull();
  });
});

describe('durationMinutes (所要時間)', () => {
  it('60 分のスロットは 60 を返す', () => {
    expect(durationMinutes('2026-07-31T12:00:00Z', '2026-07-31T13:00:00Z')).toBe(60);
  });

  it('不正な ISO は null', () => {
    expect(durationMinutes('invalid', '2026-07-31T13:00:00Z')).toBeNull();
  });
});
