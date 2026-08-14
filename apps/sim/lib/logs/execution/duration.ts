import { workflowExecutionLogs } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Elapsed run time for a terminal write that does not go through
 * `completeWorkflowExecution`, expressed against the row's own `started_at`.
 *
 * Cancellation writes the log row directly rather than through the completion
 * path, so it has no in-memory duration to store. Deriving it in the same
 * statement keeps `ended_at` and `total_duration_ms` describing one instant,
 * and keeps a cancelled run visible to the duration filters on
 * `GET /api/v2/logs` — a null there reads as "no duration recorded" and drops
 * the run out of every `minDurationMs`/`maxDurationMs` query.
 *
 * `ended_at` is bound as an explicit `timestamp` rather than a `Date`, because
 * `started_at` is `timestamp without time zone` holding a UTC wall clock: an
 * ISO string casts to the same naive reading, while a driver-bound `Date`
 * would infer `timestamptz` and make the interval depend on the session zone.
 *
 * Floored at 1ms to match `completeWorkflowExecution`, so a cancellation that
 * lands inside the same millisecond as the start still records that it ran.
 */
export function elapsedDurationMsSql(endedAt: Date): SQL<number> {
  return sql<number>`GREATEST(1, ROUND(EXTRACT(EPOCH FROM (${endedAt.toISOString()}::timestamp - ${workflowExecutionLogs.startedAt})) * 1000))::integer`
}
