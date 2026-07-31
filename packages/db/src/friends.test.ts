import { describe, expect, it, vi } from 'vitest';
import { upsertFriend, type Friend } from './friends.js';

const blockedFriend: Friend = {
  id: 'friend-1',
  line_user_id: 'U123',
  display_name: 'テストユーザー',
  picture_url: null,
  status_message: null,
  is_following: 0,
  blocked_at: '2026-07-25T10:00:00.000+09:00',
  last_unblocked_at: null,
  user_id: null,
  line_account_id: null,
  metadata: '{}',
  ref_code: null,
  first_tracked_link_id: null,
  created_at: '2026-07-01T10:00:00.000+09:00',
  updated_at: '2026-07-25T10:00:00.000+09:00',
};

function createDb() {
  const updateBinds: unknown[][] = [];
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => blockedFriend,
        run: async () => {
          if (sql.includes('UPDATE friends')) updateBinds.push(args);
          return { success: true };
        },
      }),
    })),
  } as unknown as D1Database;
  return { db, updateBinds };
}

describe('upsertFriend follow state', () => {
  it('プロフィール更新では既存のブロック状態を維持する', async () => {
    const { db, updateBinds } = createDb();

    await upsertFriend(db, {
      lineUserId: 'U123',
      displayName: '更新後の名前',
    });

    expect(updateBinds).toHaveLength(1);
    expect(updateBinds[0]?.[3]).toBe(0);
  });

  it('follow webhookが明示した場合だけフォロー中へ変更する', async () => {
    const { db, updateBinds } = createDb();

    await upsertFriend(db, {
      lineUserId: 'U123',
      displayName: '更新後の名前',
      isFollowing: true,
    });

    expect(updateBinds).toHaveLength(1);
    expect(updateBinds[0]?.[3]).toBe(1);
  });
});
