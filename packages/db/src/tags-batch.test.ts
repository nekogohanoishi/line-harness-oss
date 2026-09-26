import { describe, expect, test, vi } from 'vitest';
import { getFriendTagsByIds } from './tags.js';

describe('getFriendTagsByIds', () => {
  test('groups the selected friends without querying each friend separately', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [
        { friend_id: 'friend-a', id: 'tag-1', name: 'A', color: '#000000', created_at: '2026-01-01' },
        { friend_id: 'friend-a', id: 'tag-2', name: 'B', color: '#ffffff', created_at: '2026-01-01' },
        { friend_id: 'friend-b', id: 'tag-3', name: 'C', color: '#000000', created_at: '2026-01-01' },
      ],
    });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    const tags = await getFriendTagsByIds(db, ['friend-a', 'friend-b', 'friend-c', 'friend-a']);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE ft.friend_id IN (?,?,?)'));
    expect(bind).toHaveBeenCalledWith('friend-a', 'friend-b', 'friend-c');
    expect(tags.get('friend-a')?.map((tag) => tag.name)).toEqual(['A', 'B']);
    expect(tags.get('friend-b')?.map((tag) => tag.name)).toEqual(['C']);
    expect(tags.get('friend-c')).toEqual([]);
    expect(tags.get('friend-a')?.[0]).not.toHaveProperty('friend_id');
  });

  test('queries at most 100 friends at a time and skips an empty page', async () => {
    const bind = vi.fn().mockReturnValue({ all: vi.fn().mockResolvedValue({ results: [] }) });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    expect(await getFriendTagsByIds(db, [])).toEqual(new Map());
    expect(prepare).not.toHaveBeenCalled();

    const ids = Array.from({ length: 125 }, (_, index) => `friend-${index}`);
    const tags = await getFriendTagsByIds(db, ids);

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(bind.mock.calls[0]).toHaveLength(100);
    expect(bind.mock.calls[1]).toHaveLength(25);
    expect(tags.size).toBe(125);
  });
});
