import { describe, expect, test, vi } from 'vitest'
import { getTagsWithCounts } from './tags.js'

describe('getTagsWithCounts', () => {
  test('counts friends with a left join so unused tags are included', async () => {
    const all = vi.fn().mockResolvedValue({
      results: [{
        id: 'tag-1',
        name: '回答済み',
        color: '#10B981',
        created_at: '2026-08-03T00:00:00.000Z',
        friend_count: 0,
      }],
    })
    const prepare = vi.fn().mockReturnValue({ all })
    const db = { prepare } as unknown as D1Database

    const result = await getTagsWithCounts(db)

    expect(result[0].friend_count).toBe(0)
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN friend_tags'))
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('COUNT(ft.friend_id)'))
  })
})
