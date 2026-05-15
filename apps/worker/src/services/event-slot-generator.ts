// Phase 6a (Webinar Launch): event_slot_recurrence ルールから event_slots を
// 自動生成する idempotent worker。
//
// 設計要旨:
//   - recurrence は (pattern_type, weekdays_json, times_json, duration_minutes,
//     capacity, generate_days_ahead, timezone, last_generated_through) を持つ
//     1 行 = 1 個の生成ルール。
//   - cron tick 毎に runAllRecurrenceGeneration() を呼び、active な全ルールに対し
//     generateSlotsForRecurrence() を実行する。
//   - 「生成済み日付」は last_generated_through (ISO 日付 YYYY-MM-DD JST 基準) で
//     管理し、毎回 last_generated_through+1日 〜 today+generate_days_ahead を走査。
//   - JST タイムゾーン固定 (timezone カラムは将来拡張用に保持しているが v1 では
//     "Asia/Tokyo" 以外を入れても挙動は JST のまま。validation で弾く)。
//   - 重複防止: 各 (event_id, starts_at) について既存 event_slots を SELECT し、
//     被っていたらスキップ。何度実行しても結果は同じ。
//   - 失敗は console.error して次のルールを継続。1 ルールの障害が他に波及しない。

const JST_OFFSET_MS = 9 * 3600_000;

// "HH:MM" を分単位の整数に変換 (0..1440 未満)。不正値は null。
function parseHHMM(s: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// "YYYY-MM-DD" を JST 当日 00:00 として UTC ms に変換。
function jstDateToUtcMs(yyyyMmDd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // JST 00:00 = UTC (前日 15:00)
  return Date.UTC(y, mo - 1, d) - JST_OFFSET_MS;
}

// UTC ms を JST の "YYYY-MM-DD" に変換。
function utcMsToJstDate(ms: number): string {
  const jst = new Date(ms + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// JST 日付 + 分 (0..1440) を UTC ISO8601 (Z) に変換。
function jstDateAndMinutesToUtcIso(yyyyMmDd: string, minutes: number): string | null {
  const baseUtc = jstDateToUtcMs(yyyyMmDd);
  if (baseUtc == null) return null;
  return new Date(baseUtc + minutes * 60_000).toISOString();
}

// JST 日付の曜日 (日=0..土=6)。
function jstWeekday(yyyyMmDd: string): number | null {
  const ms = jstDateToUtcMs(yyyyMmDd);
  if (ms == null) return null;
  return new Date(ms + JST_OFFSET_MS).getUTCDay();
}

// 翌日 (JST) を返す。
function jstNextDate(yyyyMmDd: string): string {
  const ms = jstDateToUtcMs(yyyyMmDd);
  if (ms == null) return yyyyMmDd;
  return utcMsToJstDate(ms + 24 * 3600_000);
}

export interface RecurrenceRow {
  id: string;
  event_id: string;
  pattern_type: 'daily' | 'weekly';
  weekdays_json: string | null;
  times_json: string;
  duration_minutes: number;
  capacity: number | null;
  generate_days_ahead: number;
  timezone: string;
  is_active: number;
  last_generated_through: string | null;
}

export interface GenerateOptions {
  // テストやマニュアル実行用。本番 cron では Date を渡さない (= now を使う)。
  now?: Date;
}

export interface GenerateResult {
  recurrenceId: string;
  eventId: string;
  attempted: number;  // 走査した (date, time) ペアの数
  inserted: number;
  skippedDuplicate: number;
  errors: number;
  lastGeneratedThrough: string | null;
}

// 1 つの recurrence ルールから不足分の event_slots を生成する。
// idempotent — 既存 slot と starts_at が一致する組合せはスキップ。
export async function generateSlotsForRecurrence(
  db: D1Database,
  rec: RecurrenceRow,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const result: GenerateResult = {
    recurrenceId: rec.id,
    eventId: rec.event_id,
    attempted: 0,
    inserted: 0,
    skippedDuplicate: 0,
    errors: 0,
    lastGeneratedThrough: rec.last_generated_through,
  };

  // パース: times_json
  let times: number[] = [];
  try {
    const raw = JSON.parse(rec.times_json) as unknown;
    if (!Array.isArray(raw)) throw new Error('times_json must be array');
    for (const t of raw) {
      if (typeof t !== 'string') throw new Error('times_json item must be string');
      const m = parseHHMM(t);
      if (m == null) throw new Error(`invalid time: ${t}`);
      times.push(m);
    }
    times = Array.from(new Set(times)).sort((a, b) => a - b);
  } catch (e) {
    console.error(`[slot-generator] times_json parse failed rec=${rec.id}:`, e);
    result.errors++;
    return result;
  }
  if (times.length === 0) return result;

  // パース: weekdays_json (weekly 限定)
  let weekdays: Set<number> | null = null;
  if (rec.pattern_type === 'weekly') {
    try {
      const raw = rec.weekdays_json ? (JSON.parse(rec.weekdays_json) as unknown) : null;
      if (!Array.isArray(raw)) throw new Error('weekdays_json must be array for weekly');
      const set = new Set<number>();
      for (const w of raw) {
        if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > 6) {
          throw new Error(`invalid weekday: ${String(w)}`);
        }
        set.add(w);
      }
      weekdays = set;
    } catch (e) {
      console.error(`[slot-generator] weekdays_json parse failed rec=${rec.id}:`, e);
      result.errors++;
      return result;
    }
    if (weekdays.size === 0) return result;
  }

  const now = opts.now ?? new Date();
  const todayJst = utcMsToJstDate(now.getTime());

  // 走査開始日: last_generated_through+1 か今日のうち遅い方
  // 初回 (last_generated_through == null) は今日から
  let startDate: string;
  if (rec.last_generated_through) {
    const candidate = jstNextDate(rec.last_generated_through);
    startDate = candidate < todayJst ? todayJst : candidate;
  } else {
    startDate = todayJst;
  }

  // 終了日: 今日 + generate_days_ahead
  const endMs = jstDateToUtcMs(todayJst);
  if (endMs == null) {
    result.errors++;
    return result;
  }
  const endDate = utcMsToJstDate(endMs + rec.generate_days_ahead * 24 * 3600_000);

  if (startDate > endDate) {
    // 何もすることがない (既に先まで生成済み)
    return result;
  }

  // 既存 event_slots の starts_at をまとめて取得して被り判定に使う
  // 走査範囲は startDate 00:00 JST 〜 endDate 23:59 JST 相当だが、UTC で計算
  const rangeStartUtc = jstDateToUtcMs(startDate);
  const rangeEndUtc = jstDateToUtcMs(endDate);
  if (rangeStartUtc == null || rangeEndUtc == null) {
    result.errors++;
    return result;
  }
  const rangeEndUtcIso = new Date(rangeEndUtc + 24 * 3600_000).toISOString();
  const rangeStartUtcIso = new Date(rangeStartUtc).toISOString();
  const existing = await db
    .prepare(
      `SELECT starts_at FROM event_slots
        WHERE event_id = ? AND deleted_at IS NULL
          AND starts_at >= ? AND starts_at < ?`,
    )
    .bind(rec.event_id, rangeStartUtcIso, rangeEndUtcIso)
    .all<{ starts_at: string }>();
  const existingSet = new Set<string>();
  for (const r of existing.results ?? []) {
    // 比較は normalize した ISO (秒以下を切り捨て) で行うと安全
    existingSet.add(normalizeIso(r.starts_at));
  }

  // 走査
  let cursor = startDate;
  let lastDone: string | null = result.lastGeneratedThrough;
  while (cursor <= endDate) {
    const wd = jstWeekday(cursor);
    const allowed =
      rec.pattern_type === 'daily' ||
      (rec.pattern_type === 'weekly' && weekdays != null && wd != null && weekdays.has(wd));
    if (allowed) {
      for (const tMin of times) {
        result.attempted++;
        const startsIso = jstDateAndMinutesToUtcIso(cursor, tMin);
        if (!startsIso) {
          result.errors++;
          continue;
        }
        const startKey = normalizeIso(startsIso);
        if (existingSet.has(startKey)) {
          result.skippedDuplicate++;
          continue;
        }
        const endsIso = new Date(
          new Date(startsIso).getTime() + rec.duration_minutes * 60_000,
        ).toISOString();
        const slotId = crypto.randomUUID();
        try {
          await db
            .prepare(
              `INSERT INTO event_slots
                 (id, event_id, starts_at, ends_at, capacity, is_active, sort_order)
               VALUES (?, ?, ?, ?, ?, 1, 0)`,
            )
            .bind(slotId, rec.event_id, startsIso, endsIso, rec.capacity)
            .run();
          existingSet.add(startKey);  // 同ループ内重複も防ぐ
          result.inserted++;
        } catch (e) {
          console.error(`[slot-generator] insert failed rec=${rec.id} starts=${startsIso}:`, e);
          result.errors++;
        }
      }
    }
    lastDone = cursor;
    cursor = jstNextDate(cursor);
  }

  // last_generated_through を更新 (実際に走査が完了した最後の日付)
  if (lastDone) {
    const updatedAt = new Date().toISOString();
    try {
      await db
        .prepare(
          `UPDATE event_slot_recurrence
              SET last_generated_through = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(lastDone, updatedAt, rec.id)
        .run();
      result.lastGeneratedThrough = lastDone;
    } catch (e) {
      console.error(`[slot-generator] update last_generated_through failed rec=${rec.id}:`, e);
      result.errors++;
    }
  }

  return result;
}

// ISO8601 を秒精度に丸める (ms / TZ 表記揺れを吸収)
function normalizeIso(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString();
}

// 全 active recurrence をループして実行する。cron tick から呼ばれる。
export async function runAllRecurrenceGeneration(
  db: D1Database,
  opts: GenerateOptions = {},
): Promise<{
  total: number;
  inserted: number;
  skippedDuplicate: number;
  errors: number;
  results: GenerateResult[];
}> {
  const rows = await db
    .prepare(
      `SELECT id, event_id, pattern_type, weekdays_json, times_json, duration_minutes,
              capacity, generate_days_ahead, timezone, is_active, last_generated_through
         FROM event_slot_recurrence
        WHERE is_active = 1`,
    )
    .all<RecurrenceRow>();

  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const results: GenerateResult[] = [];
  for (const r of rows.results ?? []) {
    try {
      const res = await generateSlotsForRecurrence(db, r, opts);
      inserted += res.inserted;
      skipped += res.skippedDuplicate;
      errors += res.errors;
      results.push(res);
    } catch (e) {
      console.error(`[slot-generator] generateSlotsForRecurrence threw rec=${r.id}:`, e);
      errors++;
    }
  }
  return {
    total: rows.results?.length ?? 0,
    inserted,
    skippedDuplicate: skipped,
    errors,
    results,
  };
}
