import { describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { friendEvents } from './friend-events.js'

type TestEnv = {
  Variables: { staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' } }
  Bindings: { DB: D1Database }
}

function createApp(db: D1Database) {
  const app = new Hono<TestEnv>()
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'staff' })
    await next()
  })
  app.route('/', friendEvents)
  return { app, env: { DB: db } }
}

describe('GET /api/friend-events', () => {
  test('filters and serializes the global lifecycle timeline', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const row = {
      id: 'event-1',
      event_type: 'blocked',
      event_at: '2026-07-26T18:30:00.000+09:00',
      created_at: '2026-07-26T18:30:01.000+09:00',
      line_account_id: 'account-1',
      friend_id: 'friend-1',
      display_name: '山田太郎',
      picture_url: 'https://example.test/avatar.png',
      ref_code: 'campaign-a',
      first_tracked_link_name: '夏期講座LP',
      is_following: 0,
      cursor_last_seen_at: null,
    }
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          return {
            first: async () => ({ count: 1 }),
            all: async () => ({ results: [row] }),
          }
        },
        first: async () => ({ count: 1 }),
      })),
    } as unknown as D1Database

    const { app, env } = createApp(db)
    const response = await app.request(
      '/api/friend-events?eventType=blocked&lineAccountId=account-1&search=%E5%B1%B1%E7%94%B0&limit=10&offset=20',
      {},
      env,
    )

    expect(response.status).toBe(200)
    const body = await response.json() as {
      success: boolean
      data: { total: number; hasNextPage: boolean; items: Array<Record<string, unknown>> }
    }
    expect(body).toEqual({
      success: true,
      data: {
        total: 1,
        hasNextPage: false,
        items: [{
          id: 'event-1',
          eventType: 'blocked',
          eventAt: '2026-07-26T18:30:00.000+09:00',
          createdAt: '2026-07-26T18:30:01.000+09:00',
          friendId: 'friend-1',
          displayName: '山田太郎',
          pictureUrl: 'https://example.test/avatar.png',
          refCode: 'campaign-a',
          firstTrackedLinkName: '夏期講座LP',
          isFollowing: false,
          isUnread: true,
        }],
      },
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]?.sql).toContain('e.event_type = ?')
    expect(calls[0]?.sql).toContain('f.line_account_id = ?')
    expect(calls[0]?.binds).toEqual(['blocked', 'account-1', '%山田%'])
    expect(calls[1]?.binds).toEqual(['staff-1', 'blocked', 'account-1', '%山田%', 10, 20])
  })

  test('counts only events newer than the current staff cursor', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          return { first: async () => ({ count: 4 }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request(
      '/api/friend-events/unread-count?lineAccountId=account-1',
      {},
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: { count: 4 },
    })
    expect(calls[0]?.sql).toContain('sac.last_seen_at IS NULL OR e.event_at > sac.last_seen_at')
    expect(calls[0]?.binds).toEqual(['staff-1', 'friend_lifecycle', 'account-1'])
  })

  test('marks the latest lifecycle event as read for the selected account', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          if (sql.includes('MAX(e.event_at)')) {
            return {
              all: async () => ({
                results: [{
                  line_account_id: 'account-1',
                  latest_event_at: '2026-07-26T18:30:00.000+09:00',
                }],
              }),
            }
          }
          return { run: async () => ({ success: true }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request('/api/friend-events/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineAccountId: 'account-1' }),
    }, env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { updated: 1 } })
    expect(calls[0]?.binds).toEqual(['account-1'])
    expect(calls[1]?.sql).toContain('INSERT INTO staff_activity_cursors')
    expect(calls[1]?.binds).toEqual([
      'staff-1',
      'account-1',
      'friend_lifecycle',
      '2026-07-26T18:30:00.000+09:00',
    ])
  })
})
