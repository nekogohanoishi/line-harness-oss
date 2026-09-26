import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'

const dbMocks = {
  getTags: vi.fn(),
  getTagsWithCounts: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
}

vi.mock('@line-crm/db', () => dbMocks)

const { tags } = await import('./tags.js')

const db = {} as D1Database
const env = { DB: db }

function setupApp() {
  const app = new Hono()
  app.route('/', tags)
  return app
}

const tagRow = {
  id: 'tag-1',
  name: '回答済み',
  color: '#10B981',
  created_at: '2026-08-03T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/tags', () => {
  test('returns the lightweight list by default', async () => {
    dbMocks.getTags.mockResolvedValue([tagRow])

    const response = await setupApp().request('/api/tags', undefined, env)
    const body = (await response.json()) as { success: boolean; data: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(dbMocks.getTags).toHaveBeenCalledWith(db)
    expect(dbMocks.getTagsWithCounts).not.toHaveBeenCalled()
    expect(body.data[0]).not.toHaveProperty('friendCount')
  })

  test('returns friend counts only when requested', async () => {
    dbMocks.getTagsWithCounts.mockResolvedValue([{ ...tagRow, friend_count: 12 }])

    const response = await setupApp().request('/api/tags?withCounts=1', undefined, env)
    const body = (await response.json()) as { success: boolean; data: Array<{ friendCount: number }> }

    expect(response.status).toBe(200)
    expect(dbMocks.getTagsWithCounts).toHaveBeenCalledWith(db)
    expect(dbMocks.getTags).not.toHaveBeenCalled()
    expect(body.data[0].friendCount).toBe(12)
  })
})

describe('POST /api/tags', () => {
  test('trims the tag name before saving', async () => {
    dbMocks.createTag.mockResolvedValue(tagRow)

    const response = await setupApp().request('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  回答済み  ', color: '#10B981' }),
    }, env)

    expect(response.status).toBe(201)
    expect(dbMocks.createTag).toHaveBeenCalledWith(db, {
      name: '回答済み',
      color: '#10B981',
    })
  })

  test('returns 409 for duplicate names', async () => {
    dbMocks.createTag.mockRejectedValue(new Error('UNIQUE constraint failed: tags.name'))

    const response = await setupApp().request('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '回答済み' }),
    }, env)

    expect(response.status).toBe(409)
  })
})

describe('DELETE /api/tags/:id', () => {
  test('returns 409 when another setting still references the tag', async () => {
    dbMocks.deleteTag.mockRejectedValue(new Error('FOREIGN KEY constraint failed'))

    const response = await setupApp().request('/api/tags/tag-1', { method: 'DELETE' }, env)

    expect(response.status).toBe(409)
  })
})
