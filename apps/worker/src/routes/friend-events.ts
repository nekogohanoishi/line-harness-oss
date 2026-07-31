import { Hono } from 'hono';
import type { Env } from '../index.js';

const friendEvents = new Hono<Env>();

type FriendEventType = 'added' | 'blocked' | 'unblocked';

type FriendEventRow = {
  id: string;
  event_type: FriendEventType;
  event_at: string;
  created_at: string;
  line_account_id: string;
  friend_id: string;
  display_name: string | null;
  picture_url: string | null;
  ref_code: string | null;
  first_tracked_link_name: string | null;
  is_following: number;
  cursor_last_seen_at: string | null;
};

const FRIEND_LIFECYCLE_ACTIVITY = 'friend_lifecycle';

friendEvents.get('/api/friend-events/unread-count', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const lineAccountId = c.req.query('lineAccountId');
    const accountCondition = lineAccountId ? 'AND f.line_account_id = ?' : '';
    const bindings: unknown[] = [staffId, FRIEND_LIFECYCLE_ACTIVITY];
    if (lineAccountId) bindings.push(lineAccountId);

    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM friend_follow_events e
       INNER JOIN friends f ON f.id = e.friend_id
       LEFT JOIN staff_activity_cursors sac
         ON sac.staff_id = ?
        AND sac.activity_type = ?
        AND sac.line_account_id = f.line_account_id
       WHERE (sac.last_seen_at IS NULL OR e.event_at > sac.last_seen_at)
         ${accountCondition}`,
    ).bind(...bindings).first<{ count: number }>();

    return c.json({ success: true, data: { count: row?.count ?? 0 } });
  } catch (err) {
    console.error('GET /api/friend-events/unread-count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendEvents.post('/api/friend-events/read', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const body: { lineAccountId?: string } = await c.req
      .json<{ lineAccountId?: string }>().catch(() => ({}));
    const accountCondition = body.lineAccountId ? 'WHERE f.line_account_id = ?' : '';
    const statement = c.env.DB.prepare(
      `SELECT f.line_account_id, MAX(e.event_at) AS latest_event_at
       FROM friend_follow_events e
       INNER JOIN friends f ON f.id = e.friend_id
       ${accountCondition}
       GROUP BY f.line_account_id`,
    );
    const latestByAccount = await (body.lineAccountId
      ? statement.bind(body.lineAccountId)
      : statement).all<{ line_account_id: string; latest_event_at: string | null }>();

    let updated = 0;
    for (const row of latestByAccount.results) {
      if (!row.latest_event_at) continue;
      await c.env.DB.prepare(
        `INSERT INTO staff_activity_cursors
           (staff_id, line_account_id, activity_type, last_seen_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(staff_id, line_account_id, activity_type)
         DO UPDATE SET last_seen_at = CASE
           WHEN excluded.last_seen_at > staff_activity_cursors.last_seen_at
             THEN excluded.last_seen_at
           ELSE staff_activity_cursors.last_seen_at
         END`,
      ).bind(
        staffId,
        row.line_account_id,
        FRIEND_LIFECYCLE_ACTIVITY,
        row.latest_event_at,
      ).run();
      updated += 1;
    }

    return c.json({ success: true, data: { updated } });
  } catch (err) {
    console.error('POST /api/friend-events/read error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friendEvents.get('/api/friend-events', async (c) => {
  try {
    const staffId = c.get('staff').id;
    const requestedLimit = Number(c.req.query('limit') ?? '30');
    const requestedOffset = Number(c.req.query('offset') ?? '0');
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.trunc(requestedLimit)))
      : 30;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.trunc(requestedOffset))
      : 0;
    const eventTypeParam = c.req.query('eventType');
    const eventType: FriendEventType | null = eventTypeParam === 'added'
      || eventTypeParam === 'blocked'
      || eventTypeParam === 'unblocked'
      ? eventTypeParam
      : null;
    const search = c.req.query('search')?.trim();
    const lineAccountId = c.req.query('lineAccountId');

    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (eventType) {
      conditions.push('e.event_type = ?');
      binds.push(eventType);
    }
    if (lineAccountId) {
      conditions.push('f.line_account_id = ?');
      binds.push(lineAccountId);
    }
    if (search) {
      conditions.push('f.display_name LIKE ?');
      binds.push(`%${search}%`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countStatement = c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM friend_follow_events e
       INNER JOIN friends f ON f.id = e.friend_id
       ${where}`,
    );
    const countRow = await (binds.length > 0
      ? countStatement.bind(...binds)
      : countStatement).first<{ count: number }>();
    const total = countRow?.count ?? 0;

    const result = await c.env.DB.prepare(
      `SELECT e.id, e.event_type, e.event_at, e.created_at, f.line_account_id,
              f.id AS friend_id, f.display_name, f.picture_url, f.ref_code,
              tl.name AS first_tracked_link_name, f.is_following,
              sac.last_seen_at AS cursor_last_seen_at
       FROM friend_follow_events e
       INNER JOIN friends f ON f.id = e.friend_id
       LEFT JOIN tracked_links tl ON tl.id = f.first_tracked_link_id
       LEFT JOIN staff_activity_cursors sac
         ON sac.staff_id = ?
        AND sac.line_account_id = f.line_account_id
        AND sac.activity_type = '${FRIEND_LIFECYCLE_ACTIVITY}'
       ${where}
       ORDER BY e.event_at DESC, e.created_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(staffId, ...binds, limit, offset).all<FriendEventRow>();

    return c.json({
      success: true,
      data: {
        items: result.results.map((event) => ({
          id: event.id,
          eventType: event.event_type,
          eventAt: event.event_at,
          createdAt: event.created_at,
          friendId: event.friend_id,
          displayName: event.display_name,
          pictureUrl: event.picture_url,
          refCode: event.ref_code,
          firstTrackedLinkName: event.first_tracked_link_name,
          isFollowing: Boolean(event.is_following),
          isUnread: !event.cursor_last_seen_at || event.event_at > event.cursor_last_seen_at,
        })),
        total,
        hasNextPage: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('GET /api/friend-events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friendEvents };
