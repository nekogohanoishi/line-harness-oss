// Webinar abandonment detector.
//
// Cron scans confirmed webinar bookings whose heartbeat stopped for long enough,
// marks them once, then fires webinar_abandoned into the existing event bus.

import { fireEvent } from './event-bus.js';
import { WEBINAR_ABANDONED_AFTER_SECONDS } from './event-booking-types.js';

interface AbandonedCandidateRow {
  booking_id: string;
  event_id: string;
  friend_id: string;
  line_account_id: string;
  channel_access_token: string | null;
  webinar_last_heartbeat_at: string;
  webinar_max_position_seconds: number;
}

export interface ProcessWebinarAbandonmentParams {
  now: Date;
  abandonedAfterSeconds?: number;
  limit?: number;
}

export interface ProcessWebinarAbandonmentResult {
  scanned: number;
  marked: number;
  fired: number;
  failed: number;
}

export async function processWebinarAbandonment(
  db: D1Database,
  params: ProcessWebinarAbandonmentParams,
): Promise<ProcessWebinarAbandonmentResult> {
  const abandonedAfterSeconds =
    params.abandonedAfterSeconds ?? WEBINAR_ABANDONED_AFTER_SECONDS;
  const limit = params.limit ?? 100;
  const cutoff = new Date(params.now.getTime() - abandonedAfterSeconds * 1000).toISOString();
  const nowIso = params.now.toISOString();

  const rows = await db
    .prepare(
      `SELECT
          b.id AS booking_id,
          b.event_id,
          b.friend_id,
          b.line_account_id,
          la.channel_access_token,
          b.webinar_last_heartbeat_at,
          b.webinar_max_position_seconds
         FROM event_bookings b
         INNER JOIN events e ON e.id = b.event_id
         INNER JOIN event_slots s ON s.id = b.slot_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
        WHERE e.kind = 'webinar'
          AND b.status = 'confirmed'
          AND b.webinar_video_started_at IS NOT NULL
          AND b.webinar_last_heartbeat_at IS NOT NULL
          AND b.webinar_last_heartbeat_at <= ?
          AND b.webinar_completed_at IS NULL
          AND b.webinar_abandoned_at IS NULL
          AND s.starts_at <= ?
        ORDER BY b.webinar_last_heartbeat_at ASC
        LIMIT ?`,
    )
    .bind(cutoff, nowIso, limit)
    .all<AbandonedCandidateRow>();

  let marked = 0;
  let fired = 0;
  let failed = 0;
  for (const row of rows.results ?? []) {
    const claim = await db
      .prepare(
        `UPDATE event_bookings
            SET webinar_abandoned_at = ?, updated_at = ?
          WHERE id = ?
            AND webinar_abandoned_at IS NULL
            AND webinar_completed_at IS NULL`,
      )
      .bind(nowIso, nowIso, row.booking_id)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    marked++;

    try {
      await fireEvent(
        db,
        'webinar_abandoned',
        {
          friendId: row.friend_id,
          eventData: {
            eventId: row.event_id,
            bookingId: row.booking_id,
            positionSeconds: row.webinar_max_position_seconds,
            lastHeartbeatAt: row.webinar_last_heartbeat_at,
            abandonedAfterSeconds,
          },
        },
        row.channel_access_token ?? undefined,
        row.line_account_id,
      );
      fired++;
    } catch (e) {
      failed++;
      console.error('webinar_abandoned fireEvent failed:', e);
    }
  }

  return {
    scanned: rows.results?.length ?? 0,
    marked,
    fired,
    failed,
  };
}
