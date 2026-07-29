// main.tsx — Event booking LIFF entry. Loaded via dynamic import from
// apps/worker/src/client/main.ts (?page=event&id=<eventId> or ?page=event-me).
// 友だち(受験生)が LINE 内で開くモバイル前提の予約ページ。
// 日時は datetime.ts の純関数で JST 固定表示、API エラーはすべて日本語文言に変換する。

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './styles.css';
import {
  durationMinutes,
  formatJstDateTime,
  formatJstLongDateTime,
  formatJstTime,
  groupByJstDate,
  remainingLabel,
  toJstParts,
  type JstParts,
} from './datetime';

let _root: Root | null = null;

export interface EventBookingContext {
  liffId: string;
  lineUserId: string;
  idToken: string;
}

interface EventDetail {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  // 既予約検出 (multi-account 含む): 同一人物が別アカで既に予約済の場合に
  // Worker が GET 時点で詰めて返す。null は未予約。
  my_existing_booking?: {
    id: string;
    status: string;
    slot_starts_at: string;
    line_account_id: string;
  } | null;
}

interface EventSlot {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  active_count: number;
  remaining: number | null;
}

interface MyBooking {
  id: string;
  event_id: string;
  status: string;
  customer_note: string | null;
  event_name: string;
  event_image_url: string | null;
  venue_name: string | null;
  venue_url: string | null;
  cancel_deadline_hours_before: number | null;
  slot_starts_at: string;
  slot_ends_at: string;
}

// ─── API helpers ─────────────────────────────────────────

interface ApiErrorShape extends Error {
  status: number;
  body: unknown;
}

function buildAuthHeaders(ctx: EventBookingContext, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${ctx.idToken}`, ...extra };
}

async function throwApiError(r: Response): Promise<never> {
  const text = await r.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* ignore */ }
  const err = new Error(`API ${r.status}`) as ApiErrorShape;
  err.status = r.status;
  err.body = parsed ?? text;
  throw err;
}

async function apiGet<T>(path: string, ctx: EventBookingContext): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const r = await fetch(url.toString(), { headers: buildAuthHeaders(ctx) });
  if (!r.ok) await throwApiError(r);
  return r.json() as Promise<T>;
}

async function apiPost<T>(
  path: string,
  body: unknown,
  ctx: EventBookingContext,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json', ...extraHeaders }),
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

function uid(): string {
  return crypto.randomUUID();
}

// ─── エラー文言 (生の API ステータスは表示しない) ──────────

const AUTH_ERROR_TEXT =
  'LINEの認証情報を確認できませんでした。トーク画面に戻り、友だち追加ができているかご確認のうえ、もう一度開いてください。';
const NETWORK_ERROR_TEXT = '通信に失敗しました。電波のよい場所で、もう一度お試しください。';
const GENERIC_SUBMIT_ERROR_TEXT = '予約を受け付けられませんでした。時間をおいて、もう一度お試しください。';

function errorCode(err: unknown): string | null {
  const body = (err as { body?: unknown }).body;
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return null;
}

function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

/** 詳細/一覧の読み込み失敗用。 */
function loadErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return NETWORK_ERROR_TEXT;
  const code = errorCode(err);
  const status = (err as { status?: number }).status;
  if (code === 'not_found' || status === 404) {
    return 'このイベントは現在受付を停止しています。または、ご利用中のLINEアカウントでは予約できません。';
  }
  if (code === 'unauthorized' || code === 'friend_not_found' || status === 401) {
    return AUTH_ERROR_TEXT;
  }
  return '読み込みに失敗しました。時間をおいて、もう一度開き直してください。';
}

const BOOKING_ERROR_TEXT: Record<string, string> = {
  slot_full: 'この枠は満席になりました。恐れ入りますが、ほかの枠をお選びください。',
  over_friend_limit: 'このイベントでご予約いただける回数の上限に達しています。',
  slot_started: 'この枠は開始時刻を過ぎたため、受付を終了しました。',
  slot_inactive: 'この枠は受付を締め切りました。ほかの枠をお選びください。',
  event_unpublished: 'このイベントは現在、予約の受付を停止しています。',
  invalid_slot_id: '選択した枠の情報が古くなっています。ページを開き直して、もう一度お選びください。',
  invalid_customer_note: 'ご記入いただいた内容が長すぎます。5000字以内におまとめください。',
  idempotent_in_progress: 'さきほどの送信をまだ処理しています。少し待ってから、予約履歴をご確認ください。',
  idempotency_key_required: GENERIC_SUBMIT_ERROR_TEXT,
  liff_account_resolution_failed: GENERIC_SUBMIT_ERROR_TEXT,
  internal_error: GENERIC_SUBMIT_ERROR_TEXT,
  unauthorized: AUTH_ERROR_TEXT,
  friend_not_found: AUTH_ERROR_TEXT,
};

/** 予約送信失敗用。 */
function bookingErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return NETWORK_ERROR_TEXT;
  const code = errorCode(err);
  if (code === 'duplicate_friend_booking') {
    const existing = ((err as { body?: { existing?: { slot_starts_at?: string } } }).body)?.existing;
    const when = existing?.slot_starts_at ? formatJstLongDateTime(existing.slot_starts_at) : '';
    return `このイベントはすでにご予約があります${when ? `（${when}）` : ''}。変更する場合は、予約履歴からキャンセルのうえ、あらためてお申し込みください。`;
  }
  if (code && BOOKING_ERROR_TEXT[code]) return BOOKING_ERROR_TEXT[code];
  return GENERIC_SUBMIT_ERROR_TEXT;
}

const CANCEL_ERROR_TEXT: Record<string, string> = {
  cancel_deadline_passed: 'キャンセル期限を過ぎているため、この画面からはキャンセルできません。',
  cancel_not_allowed: 'この予約はこの画面からキャンセルできません。お手数ですが、LINEのトークでご連絡ください。',
  invalid_state: 'この予約はすでにキャンセル済みか、変更できない状態です。最新の状況を表示しました。',
  not_found: '対象の予約が見つかりませんでした。画面を開き直してご確認ください。',
  unauthorized: AUTH_ERROR_TEXT,
  friend_not_found: AUTH_ERROR_TEXT,
};

function cancelErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return NETWORK_ERROR_TEXT;
  const code = errorCode(err);
  if (code && CANCEL_ERROR_TEXT[code]) return CANCEL_ERROR_TEXT[code];
  return 'キャンセルできませんでした。時間をおいて、もう一度お試しください。';
}

// ─── 説明文の分割 (参加条件などを折りたたみへ) ─────────────

const FOLD_HEADING_RE = /^【?(参加条件|対象者?|注意事項|ご注意|キャンセルポリシー)(】|[：:]|$)/;

function splitDescription(desc: string): { main: string; foldTitle: string | null; folded: string | null } {
  const lines = desc.split('\n');
  const idx = lines.findIndex((l) => FOLD_HEADING_RE.test(l.trim()));
  if (idx === -1) return { main: desc, foldTitle: null, folded: null };
  const heading = lines[idx].trim();
  let title = heading;
  let restOfLine = '';
  const bracket = heading.match(/^【([^】]+)】(.*)$/);
  if (bracket) {
    title = bracket[1];
    restOfLine = bracket[2].trim();
  } else {
    const sep = heading.search(/[：:]/);
    if (sep >= 0) {
      title = heading.slice(0, sep).trim();
      restOfLine = heading.slice(sep + 1).trim();
    }
  }
  const body = lines.slice(idx + 1).join('\n');
  const folded = `${restOfLine ? `${restOfLine}\n` : ''}${body}`.trim();
  return {
    main: lines.slice(0, idx).join('\n').trim(),
    foldTitle: title,
    folded: folded || null,
  };
}

// ─── 小物コンポーネント ──────────────────────────────────

function DateRail({ parts }: { parts: JstParts }) {
  return (
    <div className="eb-date-rail" aria-hidden>
      <span className="eb-date-day">{parts.day}</span>
      <span className="eb-date-sub">{parts.month}月({parts.weekday})</span>
    </div>
  );
}

function SkeletonDetail() {
  return (
    <div className="px-5 pt-6" aria-hidden>
      <div className="eb-skel h-6 w-3/4" />
      <div className="eb-skel h-4 w-1/2 mt-3" />
      <div className="eb-skel h-4 w-full mt-8" />
      <div className="eb-skel h-4 w-5/6 mt-2" />
      <div className="eb-skel h-4 w-2/3 mt-2" />
      <div className="eb-skel h-3 w-24 mt-10" />
      <div className="flex gap-4 mt-4">
        <div className="eb-skel h-12 w-12" />
        <div className="flex-1 space-y-2">
          <div className="eb-skel h-12 w-full" />
          <div className="eb-skel h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

function SkeletonHistory() {
  return (
    <div className="px-5 pt-6 space-y-6" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4">
          <div className="eb-skel h-12 w-12" />
          <div className="flex-1 space-y-2">
            <div className="eb-skel h-5 w-3/4" />
            <div className="eb-skel h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  requested: { text: '承認待ち', cls: 'eb-status-pending' },
  confirmed: { text: '確定', cls: 'eb-status-confirmed' },
  rejected: { text: '見送り', cls: 'eb-status-neutral' },
  cancelled: { text: 'キャンセル済み', cls: 'eb-status-neutral' },
  expired: { text: '期限切れ', cls: 'eb-status-neutral' },
  attended: { text: '参加済み', cls: 'eb-status-done' },
  no_show: { text: '不参加', cls: 'eb-status-neutral' },
};

function statusLabel(b: MyBooking): { text: string; cls: string } {
  // 確定のまま開催が終わったものは「終了」として表示する
  if (b.status === 'confirmed' && new Date(b.slot_ends_at).getTime() < Date.now()) {
    return { text: '終了', cls: 'eb-status-done' };
  }
  return STATUS_LABEL[b.status] ?? { text: b.status, cls: 'eb-status-neutral' };
}

// ─── 予約画面 (詳細 + 日時選択 + 送信) ───────────────────

function EventBookingScreen({
  ctx,
  eventId,
  onDone,
  onGoHistory,
}: {
  ctx: EventBookingContext;
  eventId: string;
  onDone: (done: { status: string; slotIso: string }) => void;
  onGoHistory: () => void;
}) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [myActive, setMyActive] = useState<MyBooking[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 送信の「意図」(枠・記入内容) が変わったら Idempotency-Key を作り直す。
  // 同一キーの再送はサーバ側でキャッシュ応答が返るため、失敗後の再試行時も作り直す。
  const idemKeyRef = useRef<string>(uid());
  useEffect(() => {
    idemKeyRef.current = uid();
  }, [selectedSlotId, note]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [e, s] = await Promise.all([
          apiGet<EventDetail>(`/api/liff/events/${eventId}`, ctx),
          apiGet<{ items: EventSlot[] }>(`/api/liff/events/${eventId}/slots`, ctx),
        ]);
        if (cancelled) return;
        setEvent(e);
        setSlots(s.items);
        try {
          const [up, past] = await Promise.all([
            apiGet<{ items: MyBooking[] }>('/api/liff/events/me?tab=upcoming', ctx),
            apiGet<{ items: MyBooking[] }>('/api/liff/events/me?tab=past', ctx),
          ]);
          if (cancelled) return;
          const all = [...up.items, ...past.items];
          setMyActive(
            all.filter((b) => b.event_id === e.id && (b.status === 'requested' || b.status === 'confirmed')),
          );
        } catch {
          /* best-effort */
        }
      } catch (err) {
        if (!cancelled) setLoadError(loadErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [ctx, eventId]);

  const groups = useMemo(() => groupByJstDate(slots), [slots]);
  const selectedSlot = selectedSlotId ? slots.find((s) => s.id === selectedSlotId) ?? null : null;

  async function refreshSlots(): Promise<void> {
    try {
      const s = await apiGet<{ items: EventSlot[] }>(`/api/liff/events/${eventId}/slots`, ctx);
      setSlots(s.items);
      // 選択中の枠が消えた / 満席になったら選択を解除する
      if (selectedSlotId) {
        const still = s.items.find((x) => x.id === selectedSlotId);
        if (!still || (still.remaining != null && still.remaining <= 0)) {
          setSelectedSlotId(null);
        }
      }
    } catch {
      /* best-effort */
    }
  }

  async function submit() {
    if (!selectedSlot || submitting) return;
    if (note.length > 5000) {
      setSubmitError('ご記入いただいた内容が長すぎます。5000字以内におまとめください。');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiPost<{ id: string; status: string }>(
        `/api/liff/events/${eventId}/bookings`,
        { slot_id: selectedSlot.id, customer_note: note || null },
        ctx,
        { 'Idempotency-Key': idemKeyRef.current },
      );
      onDone({ status: res.status, slotIso: selectedSlot.starts_at });
    } catch (err) {
      idemKeyRef.current = uid();
      setSubmitError(bookingErrorMessage(err));
      void refreshSlots();
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <SkeletonDetail />;
  if (loadError || !event) {
    return (
      <div className="px-5 py-12 text-center eb-fade-in">
        <p className="eb-load-error">{loadError ?? 'イベントが見つかりません。'}</p>
      </div>
    );
  }

  const max = event.max_bookings_per_friend;
  const existing = event.my_existing_booking;
  const bookedOut = Boolean(existing && max === 1);
  const overLimit = !bookedOut && max != null && myActive.length >= max;
  const blocked = bookedOut || overLimit;

  const firstSlot = slots[0];
  const duration = firstSlot ? durationMinutes(firstSlot.starts_at, firstSlot.ends_at) : null;
  const metaParts = [
    event.venue_name,
    duration != null && duration > 0 ? `所要${duration}分` : null,
    '参加無料',
    event.requires_approval === 1 ? '承認制' : null,
  ].filter((p): p is string => Boolean(p));

  const desc = event.description ? splitDescription(event.description) : null;
  const canSubmit = !blocked && slots.length > 0;

  return (
    <div className={`eb-fade-in ${canSubmit ? 'pb-44' : 'pb-16'}`}>
      {event.image_url && (
        <img src={event.image_url} alt="" className="w-full max-h-56 object-cover" />
      )}

      {/* 予約済み / 上限到達の案内 */}
      {bookedOut && existing && (
        <div className="px-5 pt-5">
          <div className="eb-notice" role="status">
            <p className="eb-notice-title">ご予約済みです</p>
            <p className="eb-notice-strong">
              {formatJstLongDateTime(existing.slot_starts_at)}
              <span className={`eb-status ${(STATUS_LABEL[existing.status] ?? STATUS_LABEL.requested).cls} ml-2`}>
                {(STATUS_LABEL[existing.status] ?? { text: existing.status }).text}
              </span>
            </p>
            <p className="eb-notice-body">
              日時を変更する場合は、予約履歴で現在のご予約をキャンセルしてから、あらためてお申し込みください。
            </p>
            <button type="button" onClick={onGoHistory} className="eb-notice-btn">
              予約履歴を開く
            </button>
          </div>
        </div>
      )}
      {overLimit && (
        <div className="px-5 pt-5">
          <div className="eb-notice" role="status">
            <p className="eb-notice-title">ご予約回数が上限に達しています</p>
            <p className="eb-notice-body">
              このイベントでご予約いただけるのは {max} 回までです。内容の変更は、予約履歴からキャンセルのうえ再度お申し込みください。
            </p>
            <button type="button" onClick={onGoHistory} className="eb-notice-btn">
              予約履歴を開く
            </button>
          </div>
        </div>
      )}

      {/* イベント名 + メタ情報 */}
      <div className="px-5 pt-6">
        <h1 className="eb-title">{event.name}</h1>
        {metaParts.length > 0 && <p className="eb-meta">{metaParts.join('・')}</p>}
        {event.venue_url && (
          <a href={event.venue_url} target="_blank" rel="noopener noreferrer" className="eb-text-link">
            会場・参加方法の詳細を見る
          </a>
        )}
      </div>

      {/* 説明文 */}
      {desc && (desc.main || desc.folded) && (
        <div className="px-5 mt-5">
          {desc.main && (
            <p className={`eb-desc ${event.description_centered === 1 ? 'text-center' : ''}`}>{desc.main}</p>
          )}
          {desc.folded && (
            <details className="eb-fold">
              <summary>{desc.foldTitle ?? '参加条件'}</summary>
              <p className="eb-desc mt-2">{desc.folded}</p>
            </details>
          )}
        </div>
      )}

      {/* 日時選択 */}
      <div className="px-5 mt-9">
        <h2 className="eb-section-label" id="eb-slot-label">日時を選ぶ</h2>
        {slots.length === 0 ? (
          <p className="eb-empty-inline">現在、予約できる枠はありません。時間をおいてご確認ください。</p>
        ) : (
          <div role="group" aria-labelledby="eb-slot-label">
            {groups.map((g) => (
              <div key={g.key} className="eb-daygroup">
                <DateRail parts={g.parts} />
                <div className="eb-daygroup-slots">
                  {g.items.map((s) => {
                    const full = s.remaining != null && s.remaining <= 0;
                    const rem = remainingLabel(s.capacity, s.remaining);
                    const selected = s.id === selectedSlotId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={full || blocked || submitting}
                        aria-pressed={selected}
                        onClick={() => setSelectedSlotId(selected ? null : s.id)}
                        className={`eb-slot-btn ${selected ? 'is-selected' : ''}`}
                      >
                        <span className="eb-slot-time">
                          {formatJstTime(s.starts_at)}
                          <span className="eb-slot-tilde">〜</span>
                          {formatJstTime(s.ends_at)}
                        </span>
                        {rem && <span className={`eb-slot-remaining is-${rem.tone}`}>{rem.text}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 相談内容 (任意) */}
      {canSubmit && (
        <div className="px-5 mt-9">
          <label htmlFor="eb-note" className="eb-section-label">当日相談したいこと（任意）</label>
          <textarea
            id="eb-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="例）短答の過去問が終わらない、論文の書き方に自信がない　など"
            className="eb-textarea"
            disabled={submitting}
          />
          <p className="eb-note-hint">ご記入いただいた内容をもとに、当日のお話を準備します。</p>
        </div>
      )}

      <div className="px-5 mt-10 text-center">
        <button type="button" onClick={onGoHistory} className="eb-text-link">
          予約履歴を見る
        </button>
      </div>

      {/* 画面下部固定の予約ボタン */}
      {canSubmit && (
        <div className="eb-cta-bar">
          <div className="eb-cta-inner">
            {submitError ? (
              <p role="alert" className="eb-cta-error">{submitError}</p>
            ) : event.requires_approval === 1 ? (
              <p className="eb-cta-note">承認制のため、お申し込み後に運営が内容を確認します</p>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={!selectedSlot || submitting}
              aria-busy={submitting}
              className="eb-primary-btn"
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="eb-btn-spinner" aria-hidden />
                  送信しています…
                </span>
              ) : selectedSlot ? (
                `${formatJstDateTime(selectedSlot.starts_at)} で予約する`
              ) : (
                '日時を選択してください'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 完了画面 ────────────────────────────────────────────

function DoneScreen({
  status,
  slotIso,
  onGoHistory,
}: {
  status: string;
  slotIso: string;
  onGoHistory: () => void;
}) {
  const pending = status === 'requested';
  const steps: { text: string; done: boolean }[] = pending
    ? [
        { text: 'お申し込みを受け付けました', done: true },
        { text: '運営が内容を確認します', done: false },
        { text: '結果をLINEのトークでお知らせします', done: false },
      ]
    : [
        { text: 'ご予約が確定しました', done: true },
        { text: '当日のご案内をLINEのトークでお送りします', done: false },
      ];
  return (
    <div className="px-5 py-12 text-center eb-slide-up">
      <svg className="eb-check" viewBox="0 0 56 56" aria-hidden>
        <circle className="eb-check-circle" cx="28" cy="28" r="25" />
        <path className="eb-check-mark" d="M17 29l8 8 15-16" />
      </svg>
      <h1 className="eb-done-title">
        {pending ? 'お申し込みを受け付けました' : 'ご予約が確定しました'}
      </h1>
      <p className="eb-done-when">{formatJstLongDateTime(slotIso)}</p>
      {pending && (
        <p className="eb-done-lead">承認までいましばらくお待ちください。</p>
      )}
      <ol className="eb-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? 'is-done' : ''}>{s.text}</li>
        ))}
      </ol>
      <button type="button" onClick={onGoHistory} className="eb-primary-btn mt-10">
        予約履歴を見る
      </button>
    </div>
  );
}

// ─── 予約履歴 ────────────────────────────────────────────

type CancelState =
  | { kind: 'allowed' }
  | { kind: 'deadline_passed'; hours: number }
  | { kind: 'not_allowed' }
  | { kind: 'none' };

function cancelState(b: MyBooking): CancelState {
  if (b.status !== 'requested' && b.status !== 'confirmed') return { kind: 'none' };
  if (new Date(b.slot_starts_at).getTime() <= Date.now()) return { kind: 'none' };
  if (b.cancel_deadline_hours_before == null) return { kind: 'not_allowed' };
  const deadlineMs = new Date(b.slot_starts_at).getTime() - b.cancel_deadline_hours_before * 3600_000;
  return deadlineMs > Date.now()
    ? { kind: 'allowed' }
    : { kind: 'deadline_passed', hours: b.cancel_deadline_hours_before };
}

function HistoryScreen({
  ctx,
  onGoDetail,
}: {
  ctx: EventBookingContext;
  onGoDetail: (() => void) | null;
}) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [items, setItems] = useState<MyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(current: 'upcoming' | 'past') {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: MyBooking[] }>(`/api/liff/events/me?tab=${current}`, ctx);
      setItems(res.items);
    } catch (e) {
      setError(loadErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function cancel(b: MyBooking) {
    if (busyId) return;
    const ok = confirm(
      `「${b.event_name}」\n${formatJstLongDateTime(b.slot_starts_at)}\nこの予約をキャンセルしますか？`,
    );
    if (!ok) return;
    setBusyId(b.id);
    setError(null);
    try {
      await apiPost(`/api/liff/events/me/${b.id}/cancel`, {}, ctx);
      await refresh(tab);
    } catch (err) {
      setError(cancelErrorMessage(err));
      if (errorCode(err) === 'invalid_state') await refresh(tab);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="pb-16 eb-fade-in">
      <div className="eb-tabs">
        {(['upcoming', 'past'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-selected={tab === t}
            className={`eb-tab ${tab === t ? 'is-active' : ''}`}
          >
            {t === 'upcoming' ? 'これから' : '過去'}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-5 pt-4">
          <p role="alert" className="eb-cta-error">{error}</p>
        </div>
      )}

      {loading ? (
        <SkeletonHistory />
      ) : items.length === 0 ? (
        <div className="eb-empty">
          <p className="eb-empty-title">
            {tab === 'upcoming' ? '予約はまだありません' : '過去の予約はありません'}
          </p>
          {tab === 'upcoming' && (
            onGoDetail ? (
              <button type="button" onClick={onGoDetail} className="eb-secondary-btn mt-6">
                予約ページへ戻る
              </button>
            ) : (
              <p className="eb-empty-sub">イベント案内のリンクからご予約いただけます。</p>
            )
          )}
        </div>
      ) : (
        <ul className="px-5">
          {items.map((b) => {
            const s = statusLabel(b);
            const c = cancelState(b);
            return (
              <li key={b.id} className="eb-book-row">
                <DateRail parts={toJstParts(b.slot_starts_at)} />
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="eb-book-name">{b.event_name}</p>
                    <span className={`eb-status ${s.cls} shrink-0`}>{s.text}</span>
                  </div>
                  <p className="eb-book-time">
                    {formatJstTime(b.slot_starts_at)}〜{formatJstTime(b.slot_ends_at)}
                  </p>
                  {b.venue_name && <p className="eb-book-venue">{b.venue_name}</p>}
                  {c.kind === 'allowed' && (
                    <button
                      type="button"
                      onClick={() => cancel(b)}
                      disabled={busyId != null}
                      className="eb-cancel-btn"
                    >
                      {busyId === b.id ? 'キャンセルしています…' : '予約をキャンセル'}
                    </button>
                  )}
                  {c.kind === 'deadline_passed' && (
                    <div>
                      <button type="button" disabled className="eb-cancel-btn">
                        予約をキャンセル
                      </button>
                      <p className="eb-cancel-reason">
                        開催{c.hours}時間前を過ぎたため、この画面からはキャンセルできません。
                      </p>
                    </div>
                  )}
                  {c.kind === 'not_allowed' && (
                    <p className="eb-cancel-reason">
                      キャンセルをご希望の場合は、LINEのトークでご連絡ください。
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────

type Screen =
  | { kind: 'detail'; eventId: string }
  | { kind: 'done'; status: string; slotIso: string; eventId: string }
  | { kind: 'history'; eventId?: string };

function App({ ctx, initial }: { ctx: EventBookingContext; initial: Screen }) {
  const [screen, setScreen] = useState<Screen>(initial);

  const headerLabel = (() => {
    switch (screen.kind) {
      case 'detail': return 'イベント予約';
      case 'done': return '受付完了';
      case 'history': return '予約履歴';
    }
  })();

  // 履歴から予約画面へ戻れるのは、遷移元のイベントが分かっている場合のみ
  const backEventId = screen.kind === 'history' ? screen.eventId ?? null
    : screen.kind === 'done' ? screen.eventId
    : null;

  return (
    <div className="eb-page">
      <header className="eb-header">
        <div className="eb-header-inner">
          <div className="eb-header-side">
            {screen.kind === 'history' && backEventId ? (
              <button
                type="button"
                className="eb-header-link"
                onClick={() => setScreen({ kind: 'detail', eventId: backEventId })}
              >
                ← イベント
              </button>
            ) : (
              <span className="eb-header-mark" aria-hidden />
            )}
          </div>
          <span className="eb-header-title">{headerLabel}</span>
          <div className="eb-header-side eb-header-side-right">
            {screen.kind === 'detail' && (
              <button
                type="button"
                className="eb-header-link"
                onClick={() => setScreen({ kind: 'history', eventId: screen.eventId })}
              >
                予約履歴
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-md mx-auto">
        {screen.kind === 'detail' && (
          <EventBookingScreen
            ctx={ctx}
            eventId={screen.eventId}
            onDone={({ status, slotIso }) =>
              setScreen({ kind: 'done', status, slotIso, eventId: screen.eventId })}
            onGoHistory={() => setScreen({ kind: 'history', eventId: screen.eventId })}
          />
        )}
        {screen.kind === 'done' && (
          <DoneScreen
            status={screen.status}
            slotIso={screen.slotIso}
            onGoHistory={() => setScreen({ kind: 'history', eventId: screen.eventId })}
          />
        )}
        {screen.kind === 'history' && (
          <HistoryScreen
            ctx={ctx}
            onGoDetail={backEventId ? () => setScreen({ kind: 'detail', eventId: backEventId }) : null}
          />
        )}
      </main>
    </div>
  );
}

export function mountEventBooking(
  container: HTMLElement,
  ctx: EventBookingContext,
  initial: { kind: 'detail'; eventId: string } | { kind: 'history' },
): void {
  document.body.classList.add('eb-active');
  if (!_root) _root = createRoot(container);
  _root.render(
    <StrictMode>
      <App ctx={ctx} initial={initial} />
    </StrictMode>,
  );
}
