// datetime.ts — event-booking 用の日時純関数群。
// すべて UTC→JST を +9 時間の固定オフセットで明示的に計算し、
// 端末のタイムゾーン設定・ロケール実装に依存しない (Asia/Tokyo は夏時間なし)。
// vitest (node 環境) でテストできるよう DOM に依存しない。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

export interface JstParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
  weekday: (typeof WEEKDAYS_JA)[number];
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
}

/** ISO 文字列 (UTC) を JST の年月日・曜日・時刻へ分解する。 */
export function toJstParts(iso: string): JstParts {
  const shifted = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: WEEKDAYS_JA[shifted.getUTCDay()],
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** '21:00' / '09:30' — 桁を揃えるためゼロ埋め。 */
export function formatJstTime(iso: string): string {
  const p = toJstParts(iso);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** '7/31(金)' */
export function formatJstShortDate(iso: string): string {
  const p = toJstParts(iso);
  return `${p.month}/${p.day}(${p.weekday})`;
}

/** '2026年7月31日(金)' */
export function formatJstLongDate(iso: string): string {
  const p = toJstParts(iso);
  return `${p.year}年${p.month}月${p.day}日(${p.weekday})`;
}

/** '7/31(金) 21:00' — CTA ボタンなど短い文脈用。 */
export function formatJstDateTime(iso: string): string {
  return `${formatJstShortDate(iso)} ${formatJstTime(iso)}`;
}

/** '2026年7月31日(金) 21:00' — 確認・履歴表示用。 */
export function formatJstLongDateTime(iso: string): string {
  return `${formatJstLongDate(iso)} ${formatJstTime(iso)}`;
}

/** JST 基準の日付キー '2026-07-31'。グループ化に使う。 */
export function jstDateKey(iso: string): string {
  const p = toJstParts(iso);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export interface JstDateGroup<T> {
  key: string;
  parts: JstParts;
  items: T[];
}

/**
 * starts_at (UTC ISO) を持つ要素を JST の日付単位でグループ化する。
 * グループも各グループ内の要素も開始時刻の昇順。
 */
export function groupByJstDate<T extends { starts_at: string }>(items: T[]): JstDateGroup<T>[] {
  const sorted = [...items].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  const groups: JstDateGroup<T>[] = [];
  for (const item of sorted) {
    const key = jstDateKey(item.starts_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, parts: toJstParts(item.starts_at), items: [item] });
    }
  }
  return groups;
}

/** 開始〜終了の所要分数。ISO が不正なら null。 */
export function durationMinutes(startIso: string, endIso: string): number | null {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 60_000);
}

export type RemainingTone = 'full' | 'few';

/**
 * 残枠表示。定員なし・残枠十分なら null (何も表示しない)。
 * 残り 3 枠以下で「残N枠」、0 以下で「満席」。
 */
export function remainingLabel(
  capacity: number | null,
  remaining: number | null,
): { text: string; tone: RemainingTone } | null {
  if (capacity == null || remaining == null) return null;
  if (remaining <= 0) return { text: '満席', tone: 'full' };
  if (remaining <= 3) return { text: `残${remaining}枠`, tone: 'few' };
  return null;
}
