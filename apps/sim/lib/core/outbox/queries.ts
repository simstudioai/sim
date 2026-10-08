import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { and, eq, exists, lte, or, type SQL, sql } from 'drizzle-orm'

const MAX_READY_EVENT_TYPES = 128
/** How long a `processing` lease may go without a terminal write before the reaper reclaims it. */
export const STUCK_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000

/** A `processing` row whose lease the reaper may reclaim at `now`. */
export function isStuckProcessing(now: Date): SQL | undefined {
  return and(
    eq(outboxEvent.status, 'processing'),
    lte(outboxEvent.lockedAt, new Date(now.getTime() - STUCK_PROCESSING_THRESHOLD_MS))
  )
}

/**
 * Walks the pending index one type at a time, reading only its earliest availability.
 * The time filter belongs AFTER the walk: filtering inside each seek would scan
 * all future rows of a type with no ready events. A strictly increasing type ends
 * the recursion, including unknown types left by rolling deployments.
 *
 * Sort and cap ready heads after discovery so future types cannot hide ready ones,
 * and preserve the scheduler's oldest-first ordering. Database work scales with
 * distinct pending types (plus MVCC visibility checks), not their event counts;
 * at most 128 metadata rows cross into the worker, with no payloads or fan-out.
 */
export function readyEventTypesQuery(now: Date) {
  return sql`
    WITH RECURSIVE pending_heads AS (
      (
        SELECT event_type, available_at
        FROM ${outboxEvent}
        WHERE status = 'pending'
        ORDER BY event_type, available_at
        LIMIT 1
      )
      UNION ALL
      SELECT next_head.event_type, next_head.available_at
      FROM pending_heads
      CROSS JOIN LATERAL (
        SELECT event_type, available_at
        FROM ${outboxEvent}
        WHERE status = 'pending' AND event_type > pending_heads.event_type
        ORDER BY event_type, available_at
        LIMIT 1
      ) next_head
    )
    SELECT event_type AS "eventType"
    FROM pending_heads
    WHERE available_at <= ${now.toISOString()}::timestamp
    ORDER BY available_at, event_type
    LIMIT ${MAX_READY_EVENT_TYPES}
  `
}

/**
 * One row, `due`: whether `processOutboxEvents` would act at `now`. The pending leg is the
 * claim phase's own discovery walk, so it reads only each type's head and cannot be planned as a
 * scan of future or completed rows; the lease leg is the reaper's predicate, over the few rows in
 * `processing`.
 */
export function dueOutboxWorkQuery(now: Date) {
  const staleLease = db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(isStuckProcessing(now))
    .limit(1)
  return sql`SELECT ${or(sql`EXISTS (${readyEventTypesQuery(now)})`, exists(staleLease))} AS due`
}
