// JST (Asia/Tokyo, UTC+9) 表示用の日時フォーマッタ。
//
// DB の starts_at / ends_at / requested_at 等は UTC ISO8601 (Z 付き) で
// 保存されている。ブラウザの `toLocaleString('ja-JP', ...)` は端末の
// タイムゾーンに依存するため、海外拠点や TZ が UTC のブラウザでは
// 「JST 21:00 開始の枠が 12:00 と表示される」事故が起きる。
// Admin UI の日時表示は必ずこのモジュール経由で JST 固定に変換する。
//
// Intl のタイムゾーンデータベースに依存しない (+9h 固定シフト) ので、
// Node / ブラウザ / Cloudflare Workers のどこでも同じ結果になる。
// JST は夏時間を持たないため固定オフセットで正しい。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const JA_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

function toJstParts(iso: string): {
  year: number;
  month: number;
  day: number;
  weekday: string;
  hhmm: string;
} | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const j = new Date(t + JST_OFFSET_MS);
  const hh = String(j.getUTCHours()).padStart(2, '0');
  const mm = String(j.getUTCMinutes()).padStart(2, '0');
  return {
    year: j.getUTCFullYear(),
    month: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    weekday: JA_WEEKDAYS[j.getUTCDay()],
    hhmm: `${hh}:${mm}`,
  };
}

/**
 * UTC ISO 文字列を JST の「7/30(木) 21:00」形式に変換する。
 * `withYear: true` で「2026/7/30(木) 21:00」。
 * パースできない入力は入力文字列をそのまま返す (表示を壊さない)。
 */
export function formatJstDateTime(
  iso: string,
  opts: { withYear?: boolean } = {},
): string {
  const p = toJstParts(iso);
  if (!p) return iso;
  const prefix = opts.withYear ? `${p.year}/` : '';
  return `${prefix}${p.month}/${p.day}(${p.weekday}) ${p.hhmm}`;
}

/**
 * UTC ISO 文字列を JST の「21:00」形式 (時刻のみ) に変換する。
 * 予約枠の終了時刻など、日付を省略したい箇所で使う。
 */
export function formatJstTime(iso: string): string {
  const p = toJstParts(iso);
  if (!p) return iso;
  return p.hhmm;
}
