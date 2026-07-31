import { describe, expect, test, vi } from 'vitest'
import { Hono } from 'hono'
import { chats } from './chats.js'

type TestEnv = {
  Variables: { staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' } }
  Bindings: {
    DB: D1Database
    LINE_CHANNEL_ACCESS_TOKEN: string
  }
}

function createApp(db: D1Database) {
  const app = new Hono<TestEnv>()
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', name: '担当者', role: 'staff' })
    await next()
  })
  app.route('/', chats)
  return {
    app,
    env: { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'test-token' },
  }
}

describe('chat read tracking', () => {
  test('counts friends with incoming messages newer than the staff receipt', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          return { first: async () => ({ count: 3 }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request(
      '/api/chats/unread-count?lineAccountId=account-1',
      {},
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: { count: 3 },
    })
    expect(calls[0]?.sql).toContain("m.direction = 'incoming'")
    expect(calls[0]?.sql).toContain("m.delivery_type != 'test'")
    expect(calls[0]?.sql).toContain("MAX(m.created_at) > COALESCE(rr.last_read_at, '')")
    expect(calls[0]?.binds).toEqual(['staff-1', 'account-1'])
  })

  test('records the latest incoming timestamp without changing workflow status', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          if (sql.includes('SELECT * FROM chats WHERE id = ?')) {
            return {
              first: async () => ({
                id: 'chat-1',
                friend_id: 'friend-1',
                operator_id: null,
                status: 'in_progress',
                notes: null,
                last_message_at: '2026-07-28T10:00:00.000+09:00',
                created_at: '2026-07-28T09:00:00.000+09:00',
                updated_at: '2026-07-28T10:00:00.000+09:00',
              }),
            }
          }
          if (sql.includes('MAX(created_at) AS latest_incoming_at')) {
            return {
              first: async () => ({
                latest_incoming_at: '2026-07-28T10:00:00.000+09:00',
              }),
            }
          }
          return { run: async () => ({ success: true }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request('/api/chats/friend-1/read', {
      method: 'POST',
    }, env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        friendId: 'friend-1',
        lastReadAt: '2026-07-28T10:00:00.000+09:00',
      },
    })
    expect(calls[2]?.sql).toContain('INSERT INTO chat_read_receipts')
    expect(calls[2]?.binds).toEqual([
      'friend-1',
      'staff-1',
      '2026-07-28T10:00:00.000+09:00',
    ])
    expect(calls.some((call) => call.sql.includes('UPDATE chats'))).toBe(false)
  })

  test('returns workflow and staff unread counts with secondary filters', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          return {
            first: async () => ({
              all_count: 8,
              unread_message_count: 3,
              unhandled_count: 2,
              in_progress_count: 4,
              overdue_count: 1,
              resolved_count: 2,
            }),
          }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request(
      '/api/chats/counts?operatorId=unassigned&tagId=tag-1&lineAccountId=account-1',
      {},
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        all: 8,
        unreadMessages: 3,
        unhandled: 2,
        inProgress: 4,
        overdue: 1,
        resolved: 2,
      },
    })
    expect(calls[0]?.sql).toContain('c.operator_id IS NULL')
    expect(calls[0]?.sql).toContain('friend_tags ft')
    expect(calls[0]?.binds[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(calls[0]?.binds.slice(1)).toEqual(['staff-1', 'tag-1', 'account-1'])
  })

  test('filters the chat list by staff unread state, unassigned operator, and tag', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          return { all: async () => ({ results: [] }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request(
      '/api/chats?readStatus=unread&operatorId=unassigned&tagId=tag-1&lineAccountId=account-1&priority=urgent&overdue=true',
      {},
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: [] })
    expect(calls[0]?.sql).toContain('c.operator_id IS NULL')
    expect(calls[0]?.sql).toContain('rm.latest_incoming_at > rr.last_read_at')
    expect(calls[0]?.sql).toContain('friend_tags ft')
    expect(calls[0]?.sql).toContain("COALESCE(c.priority, 'normal') = ?")
    expect(calls[0]?.sql).toContain('c.due_at IS NOT NULL AND c.due_at < ?')
    expect(calls[0]?.binds.slice(0, -1)).toEqual([
      'account-1',
      'account-1',
      'account-1',
      'account-1',
      'staff-1',
      'tag-1',
      'account-1',
      'urgent',
    ])
    expect(calls[0]?.binds.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('marks up to 100 selected friends as read in one statement', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          return { run: async () => ({ meta: { changes: 2 } }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request('/api/chats/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendIds: ['friend-1', 'friend-2'] }),
    }, env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { updated: 2 } })
    expect(calls[0]?.sql).toContain('INSERT INTO chat_read_receipts')
    expect(calls[0]?.sql).toContain('f.id IN (?, ?)')
    expect(calls[0]?.binds[0]).toBe('staff-1')
    expect(calls[0]?.binds.slice(-2)).toEqual(['friend-1', 'friend-2'])
    expect(calls.some((call) => call.sql.includes('UPDATE chats'))).toBe(false)
  })

  test('assigns selected chats without changing their workflow status', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          if (sql.includes('SELECT * FROM operators WHERE id = ?')) {
            return {
              first: async () => ({
                id: 'operator-1',
                name: '担当者A',
                email: 'operator@example.com',
                role: 'operator',
                is_active: 1,
                created_at: '2026-07-28T09:00:00.000+09:00',
                updated_at: '2026-07-28T09:00:00.000+09:00',
              }),
            }
          }
          if (sql.includes('SELECT * FROM chats WHERE id = ?')) {
            return {
              first: async () => ({
                id: 'chat-1',
                friend_id: 'friend-1',
                operator_id: null,
                status: 'unread',
                notes: null,
                last_message_at: '2026-07-28T10:00:00.000+09:00',
                created_at: '2026-07-28T09:00:00.000+09:00',
                updated_at: '2026-07-28T10:00:00.000+09:00',
              }),
            }
          }
          return { run: async () => ({ success: true }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request('/api/chats/bulk-assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ friendIds: ['friend-1'], operatorId: 'operator-1' }),
    }, env)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { updated: 1 } })
    const update = calls.find((call) => call.sql.includes('UPDATE chats SET'))
    expect(update?.sql).toContain('operator_id = ?')
    expect(update?.sql).not.toContain('status = ?')
    expect(update?.binds[0]).toBe('operator-1')
    expect(update?.binds.at(-1)).toBe('chat-1')
  })

  test('returns current workload and 30-day first-response metrics by operator', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT * FROM operators ORDER BY')) {
          return {
            all: async () => ({
              results: [{
                id: 'operator-1',
                name: '担当者A',
                email: 'a@example.com',
                role: 'operator',
                is_active: 1,
                created_at: '2026-07-28T09:00:00.000+09:00',
                updated_at: '2026-07-28T09:00:00.000+09:00',
              }],
            }),
          }
        }
        return {
          bind: (...binds: unknown[]) => {
            calls.push({ sql, binds })
            if (sql.includes("WHERE c.status != 'resolved'")) {
              return { all: async () => ({ results: [{ operator_id: 'operator-1', active_count: 4, overdue_count: 1 }] }) }
            }
            if (sql.includes('COUNT(*) AS resolved_count')) {
              return { all: async () => ({ results: [{ operator_id: 'operator-1', resolved_count: 6 }] }) }
            }
            return {
              all: async () => ({
                results: [{
                  operator_id: 'operator-1',
                  response_sample_count: 5,
                  avg_first_response_seconds: 420,
                }],
              }),
            }
          },
        }
      }),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request('/api/chats/operator-metrics?lineAccountId=account-1', {}, env)

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      success: boolean
      data: { periodDays: number; items: Array<Record<string, unknown>> }
    }
    expect(payload.success).toBe(true)
    expect(payload.data.periodDays).toBe(30)
    expect(payload.data.items[0]).toMatchObject({
      operatorId: 'operator-1',
      operatorName: '担当者A',
      active: 4,
      overdue: 1,
      resolved: 6,
      responseSamples: 5,
      averageFirstResponseSeconds: 420,
    })
    expect(payload.data.items.at(-1)).toMatchObject({ operatorId: null, operatorName: '未割当' })
    expect(calls).toHaveLength(3)
    expect(calls[0]?.binds.at(-1)).toBe('account-1')
    expect(calls[1]?.binds.at(-1)).toBe('account-1')
    expect(calls[2]?.binds.at(-1)).toBe('account-1')
  })

  test('snapshots first-response time when an active chat is resolved', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = []
    let chatReadCount = 0
    const activeChat = {
      id: 'chat-1',
      friend_id: 'friend-1',
      operator_id: 'operator-1',
      status: 'in_progress',
      priority: 'high',
      notes: null,
      last_message_at: '2026-07-28T10:05:00.000+09:00',
      due_at: '2026-07-29T10:00:00.000+09:00',
      opened_at: '2026-07-28T10:00:00.000+09:00',
      first_response_at: '2026-07-28T10:05:00.000+09:00',
      first_response_operator_id: 'operator-1',
      resolved_at: null,
      created_at: '2026-07-28T10:00:00.000+09:00',
      updated_at: '2026-07-28T10:05:00.000+09:00',
    }
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds })
          if (sql.includes('SELECT * FROM chats WHERE id = ?')) {
            chatReadCount += 1
            return {
              first: async () => chatReadCount === 1
                ? activeChat
                : { ...activeChat, status: 'resolved', resolved_at: '2026-07-28T10:10:00.000+09:00' },
            }
          }
          return { run: async () => ({ success: true }) }
        },
      })),
    } as unknown as D1Database
    const { app, env } = createApp(db)

    const response = await app.request('/api/chats/friend-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    }, env)

    expect(response.status).toBe(200)
    const historyInsert = calls.find((call) => call.sql.includes('INSERT INTO chat_resolution_events'))
    expect(historyInsert).toBeDefined()
    expect(historyInsert?.binds[3]).toBe('operator-1')
    expect(historyInsert?.binds[4]).toBe('operator-1')
    expect(historyInsert?.binds[5]).toBe('staff-1')
    expect(historyInsert?.binds[10]).toBe(300)
  })
})
