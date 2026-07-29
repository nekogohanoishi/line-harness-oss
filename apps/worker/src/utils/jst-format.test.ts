// packages/shared/src/jst-format.ts のテスト。
// flex-builder.test.ts と同じく、shared の純関数を worker のテストスイート
// から検証する (web には test runner がないため)。
import { describe, expect, test } from 'vitest';
import { formatJstDateTime, formatJstTime } from '@line-crm/shared';

describe('formatJstDateTime', () => {
  test('UTC 正午は JST 21:00 になる (再現ケース: 7/30 21:00 開始枠)', () => {
    expect(formatJstDateTime('2026-07-30T12:00:00.000Z')).toBe('7/30(木) 21:00');
  });

  test('withYear: true で年を先頭に付ける', () => {
    expect(formatJstDateTime('2026-07-30T12:00:00.000Z', { withYear: true })).toBe(
      '2026/7/30(木) 21:00',
    );
  });

  test('UTC 深夜帯は JST で翌日に繰り上がる', () => {
    expect(formatJstDateTime('2026-07-30T16:30:00Z')).toBe('7/31(金) 01:30');
  });

  test('年またぎ: UTC 12/31 15:30 は JST 1/1 00:30', () => {
    expect(formatJstDateTime('2025-12-31T15:30:00Z', { withYear: true })).toBe(
      '2026/1/1(木) 00:30',
    );
  });

  test('分は 2 桁 0 埋めされる', () => {
    expect(formatJstDateTime('2026-07-30T02:05:00Z')).toBe('7/30(木) 11:05');
  });

  test('パースできない入力は入力をそのまま返す', () => {
    expect(formatJstDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatJstTime', () => {
  test('JST の HH:MM のみ返す', () => {
    expect(formatJstTime('2026-07-30T12:00:00.000Z')).toBe('21:00');
  });

  test('日付繰り上がり後の時刻も JST 基準', () => {
    expect(formatJstTime('2026-07-30T16:30:00Z')).toBe('01:30');
  });

  test('パースできない入力は入力をそのまま返す', () => {
    expect(formatJstTime('')).toBe('');
  });
});
