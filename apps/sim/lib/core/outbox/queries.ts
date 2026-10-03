import { outboxEvent } from '@sim/db/schema'
import { sql } from 'drizzle-orm'

const MAX_READY_EVENT_TYPES = 128

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
