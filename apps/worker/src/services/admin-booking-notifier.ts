// Admin (owner/staff) push notification for event bookings.
//
// Why this exists: requires_approval=1 のイベントでは、予約リクエストを
// オーナーが承認しない限り確定しない。ところが従来はリクエスト発生を知る
// 手段が Admin UI のポーリングバッジしかなく、気付かないままリクエストが
// expire する運用事故が起きやすかった。予約発生を運営者の LINE に即時
// push することでこのギャップを塞ぐ。
//
// 通知先は account_settings の key='booking_notify_recipients' に
// JSON 配列 (friend id のリスト) で保存する。test_recipients と同じ
// パターン。運営者自身が bot の友だちであることが前提（自分の LINE で
// 公式アカウントを友だち追加していれば良い）。

export interface AdminBookingNotifyParams {
  eventName: string;
  /** JST 表示用に整形済みの開始日時 (例: "2026-07-10 21:00") */
  startsAtJst: string;
  friendDisplayName: string;
  customerNote: string | null;
  /** 'requested'/'confirmed' は予約発生、'cancelled' は友だち起点のキャンセル */
  status: 'requested' | 'confirmed' | 'cancelled';
  adminUrl?: string;
}

/**
 * 予約管理画面へのディープリンク。
 *
 * 第1引数は「管理画面のベースURL」で、Worker 同一オリジン配信では base path
 * (`https://xxx.workers.dev/admin`) を含む。呼び出し側は
 * `resolveAdminBaseUrl(env)` を通して渡すこと。ADMIN_ORIGIN を直接渡すと
 * カンマ区切りの複数オリジン指定を壊す。
 */
export function buildAdminBookingUrl(
  adminBaseUrl: string | null | undefined,
  eventId: string,
): string | undefined {
  if (!adminBaseUrl) return undefined;
  const base = adminBaseUrl.replace(/\/+$/, '');
  return `${base}/events/bookings?id=${encodeURIComponent(eventId)}`;
}

export function renderAdminBookingNotificationText(p: AdminBookingNotifyParams): string {
  const noteLine = p.customerNote?.trim()
    ? `\n備考: ${p.customerNote.trim().slice(0, 200)}`
    : '';
  const header =
    p.status === 'requested'
      ? '📅 新しい予約リクエストが届きました（要承認）'
      : p.status === 'cancelled'
        ? '📅 予約がキャンセルされました'
        : '📅 新しい予約が確定しました';
  const actionLine =
    p.status === 'requested'
      ? `\n\n放置すると期限切れになります。管理画面から承認/却下してください。`
      : p.status === 'cancelled'
        ? `\n\n枠が空きました。`
        : '';
  const urlLine = p.adminUrl ? `\n${p.adminUrl}` : '';
  return `${header}\n\nイベント: ${p.eventName}\n日時: ${p.startsAtJst}\nお名前: ${p.friendDisplayName}さん${noteLine}${actionLine}${urlLine}`;
}

/**
 * account_settings から通知先 friend を解決し、それぞれの line_user_id に
 * push を送る。あらゆる失敗は握りつぶす (booking 本体を失敗させない)。
 * 戻り値は送信を試みた人数（テスト用）。
 */
export async function notifyAdminsOfBooking(
  db: D1Database,
  channelAccessToken: string,
  accountId: string,
  params: AdminBookingNotifyParams,
  pushFn?: (to: string, text: string) => Promise<void>,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT value FROM account_settings
        WHERE line_account_id = ? AND key = 'booking_notify_recipients'`,
    )
    .bind(accountId)
    .first<{ value: string }>();
  if (!row?.value) return 0;

  let friendIds: string[] = [];
  try {
    const parsed = JSON.parse(row.value);
    if (Array.isArray(parsed)) {
      friendIds = parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
  } catch {
    return 0;
  }
  if (friendIds.length === 0) return 0;

  const placeholders = friendIds.map(() => '?').join(',');
  const friends = await db
    .prepare(
      `SELECT line_user_id FROM friends
        WHERE id IN (${placeholders}) AND is_following = 1 AND line_user_id IS NOT NULL`,
    )
    .bind(...friendIds)
    .all<{ line_user_id: string }>();

  const targets = (friends.results ?? []).map((f) => f.line_user_id).filter(Boolean);
  if (targets.length === 0) return 0;

  const text = renderAdminBookingNotificationText(params);
  const push =
    pushFn ??
    (async (to: string, body: string) => {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({ to, messages: [{ type: 'text', text: body }] }),
      });
      if (!res.ok) {
        console.error('[admin-booking-notifier] push failed', res.status, await res.text());
      }
    });

  let attempted = 0;
  for (const to of targets) {
    try {
      await push(to, text);
      attempted += 1;
    } catch (e) {
      console.error('[admin-booking-notifier] push threw', e);
    }
  }
  return attempted;
}
