import { describe, expect, test } from 'vitest';
import {
  buildAdminBookingUrl,
  notifyAdminsOfBooking,
  renderAdminBookingNotificationText,
} from './admin-booking-notifier.js';

const baseParams = {
  eventName: 'ロードマップ作成会（無料・60分）',
  startsAtJst: '2026-07-10 21:00',
  friendDisplayName: '山田太郎',
  customerNote: '答案の書き方で悩んでいます',
  status: 'requested' as const,
  adminUrl: 'https://admin.example.com/events/bookings',
};

describe('buildAdminBookingUrl', () => {
  test('対象イベントID付きの予約確認URLを生成する', () => {
    expect(buildAdminBookingUrl('https://admin.example.com', 'event-1')).toBe(
      'https://admin.example.com/events/bookings?id=event-1',
    );
  });

  test('末尾スラッシュとURLエンコードを処理する', () => {
    expect(buildAdminBookingUrl('https://admin.example.com/', 'event / 2')).toBe(
      'https://admin.example.com/events/bookings?id=event%20%2F%202',
    );
  });

  test('管理画面URLが未設定ならリンクを生成しない', () => {
    expect(buildAdminBookingUrl(undefined, 'event-1')).toBeUndefined();
    expect(buildAdminBookingUrl(null, 'event-1')).toBeUndefined();
  });

  test('Worker 同一オリジン配信の base path (/admin) を保持する', () => {
    expect(
      buildAdminBookingUrl('https://line-harness.example.workers.dev/admin', 'event-1'),
    ).toBe('https://line-harness.example.workers.dev/admin/events/bookings?id=event-1');
  });
});

describe('renderAdminBookingNotificationText', () => {
  test('requested は要承認の文言と管理画面URLを含む', () => {
    const text = renderAdminBookingNotificationText(baseParams);
    expect(text).toContain('要承認');
    expect(text).toContain('ロードマップ作成会');
    expect(text).toContain('2026-07-10 21:00');
    expect(text).toContain('山田太郎さん');
    expect(text).toContain('備考: 答案の書き方で悩んでいます');
    expect(text).toContain('期限切れ');
    expect(text).toContain('https://admin.example.com/events/bookings');
  });

  test('confirmed は承認催促を含まない', () => {
    const text = renderAdminBookingNotificationText({ ...baseParams, status: 'confirmed' });
    expect(text).toContain('予約が確定しました');
    expect(text).not.toContain('要承認');
    expect(text).not.toContain('期限切れ');
  });

  test('customerNote が空なら備考行を出さない', () => {
    const text = renderAdminBookingNotificationText({ ...baseParams, customerNote: null });
    expect(text).not.toContain('備考:');
  });

  test('cancelled はキャンセル文言と「枠が空きました」を含み、要承認/期限切れは含まない', () => {
    const text = renderAdminBookingNotificationText({ ...baseParams, status: 'cancelled' });
    expect(text).toContain('予約がキャンセルされました');
    expect(text).toContain('ロードマップ作成会');
    expect(text).toContain('2026-07-10 21:00');
    expect(text).toContain('山田太郎さん');
    expect(text).toContain('枠が空きました。');
    expect(text).toContain('https://admin.example.com/events/bookings');
    expect(text).not.toContain('要承認');
    expect(text).not.toContain('期限切れ');
  });

  test('cancelled でも customerNote があれば備考行を出す', () => {
    const text = renderAdminBookingNotificationText({ ...baseParams, status: 'cancelled' });
    expect(text).toContain('備考: 答案の書き方で悩んでいます');
  });
});

// 最小限の D1 モック: prepare(sql).bind(...).first()/all() チェーンを再現
function mockDb(opts: {
  settingValue: string | null;
  friends: Array<{ line_user_id: string }>;
}): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: async () =>
              sql.includes('account_settings')
                ? opts.settingValue !== null
                  ? { value: opts.settingValue }
                  : null
                : null,
            all: async () => ({ results: opts.friends }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('notifyAdminsOfBooking', () => {
  test('設定が無ければ 0 件送信', async () => {
    const db = mockDb({ settingValue: null, friends: [] });
    const n = await notifyAdminsOfBooking(db, 'token', 'acc1', baseParams, async () => {});
    expect(n).toBe(0);
  });

  test('設定が壊れた JSON なら 0 件送信', async () => {
    const db = mockDb({ settingValue: '{not json', friends: [] });
    const n = await notifyAdminsOfBooking(db, 'token', 'acc1', baseParams, async () => {});
    expect(n).toBe(0);
  });

  test('受信者2人に push が飛ぶ', async () => {
    const db = mockDb({
      settingValue: JSON.stringify(['f1', 'f2']),
      friends: [{ line_user_id: 'U111' }, { line_user_id: 'U222' }],
    });
    const sent: string[] = [];
    const n = await notifyAdminsOfBooking(db, 'token', 'acc1', baseParams, async (to, text) => {
      sent.push(to);
      expect(text).toContain('ロードマップ作成会');
    });
    expect(n).toBe(2);
    expect(sent).toEqual(['U111', 'U222']);
  });

  test('1人目の push が throw しても2人目に送る', async () => {
    const db = mockDb({
      settingValue: JSON.stringify(['f1', 'f2']),
      friends: [{ line_user_id: 'U111' }, { line_user_id: 'U222' }],
    });
    const sent: string[] = [];
    const n = await notifyAdminsOfBooking(db, 'token', 'acc1', baseParams, async (to) => {
      if (to === 'U111') throw new Error('boom');
      sent.push(to);
    });
    expect(n).toBe(1);
    expect(sent).toEqual(['U222']);
  });
});
