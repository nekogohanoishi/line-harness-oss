// Cron handler: expire `requested` event bookings only after their slot starts,
// then purge idempotency rows. A staff approval delay must never make a future
// booking disappear from the approval queue.

import { purgeExpiredEventIdempotency } from './event-booking-idempotency.js';

interface StaleRow {
  id: string;
}

export interface RunEventBookingExpirerParams {
  now: Date;
}

export async function runEventBookingExpirer(
  db: D1Database,
  params: RunEventBookingExpirerParams,
): Promise<{ expired: number; idempotencyPurged: number }> {
  const stale = await db
    .prepare(
      `SELECT b.id
         FROM event_bookings b
         JOIN event_slots s ON s.id = b.slot_id
        WHERE b.status = 'requested' AND s.starts_at <= ?
        LIMIT 200`,
    )
    .bind(params.now.toISOString())
    .all<StaleRow>();

  let expired = 0;
  for (const row of stale.results ?? []) {
    // Conditional UPDATE to avoid racing with concurrent admin decide.
    const upd = await db
      .prepare(
        `UPDATE event_bookings
            SET status = 'expired', decided_at = ?, updated_at = ?
          WHERE id = ? AND status = 'requested'`,
      )
      .bind(params.now.toISOString(), params.now.toISOString(), row.id)
      .run();
    if ((upd.meta?.changes ?? 0) === 0) continue;
    await db
      .prepare(
        `UPDATE event_booking_reminders
            SET status = 'cancelled'
          WHERE booking_id = ? AND status IN ('pending','failed')`,
      )
      .bind(row.id)
      .run();
    expired++;
  }

  const idempotencyPurged = await purgeExpiredEventIdempotency(db, params.now);
  return { expired, idempotencyPurged };
}
