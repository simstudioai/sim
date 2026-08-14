import { workflowExecutionLogs } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'

const INT4_MAX_MS = 2_147_483_647

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
 * `ended_at` is bound through `started_at`'s own column mapper and cast to
 * `timestamp`, because that column is `timestamp without time zone` holding a
 * UTC wall clock. The cast is what pins the reading: the mapper emits a UTC ISO
 * instant, and casting it drops the offset to the same naive wall clock the
 * column stores. Left uncast the interval would depend on Postgres resolving
 * the subtraction to the `timestamp` overload rather than `timestamptz`, and
 * getting that wrong yields a duration in the wrong zone rather than an error.
 *
 * Floored at 1ms to match the `Math.max(1, durationMs)` the completion path
 * applies, so a cancellation landing inside the same millisecond as the start
 * still records that it ran. The floor doubles as the guard against a negative
 * interval, which is otherwise reachable whenever the clock that stamped
 * `started_at` runs ahead of the one cancelling.
 *
 * Saturated at the column's own ceiling rather than left to overflow. The
 * column is `integer`, so an untimed run cancelled after ~24.8 days would
 * otherwise raise `numeric_value_out_of_range` — which costs more than the
 * duration it was recording: the direct write is caught and logged, leaving
 * the row `running` with no end timestamp at all, and the workflow-group write
 * fails its transaction and takes the whole cancellation with it. A saturated
 * duration is wrong in the last digit; a failed terminal write is wrong about
 * whether the run ended.
 *
 * A duration a *paused* run already recorded wins, and only that one. Pausing
 * writes the run's active duration at the checkpoint, which elapsed wall clock
 * through a later cancel would redefine to include the time it sat waiting.
 *
 * The status is what distinguishes it, not merely the column being populated:
 * resuming flips the row back to `running` and leaves that checkpoint value
 * behind, so a resumed run carries a stale duration while it is once again
 * accruing time. Keeping it there would freeze a cancelled run at its
 * pre-resume reading and disagree with the resume completion path, which
 * measures wall clock. A `running` row therefore always recomputes; only a
 * `pending` one — paused, and not accruing — keeps what it has.
 */
export function elapsedDurationMsSql(endedAt: Date): SQL<number> {
  const endedAtParam = sql.param(endedAt, workflowExecutionLogs.startedAt)
  const elapsed = sql`LEAST(${INT4_MAX_MS}, GREATEST(1, ROUND(EXTRACT(EPOCH FROM (${endedAtParam}::timestamp - ${workflowExecutionLogs.startedAt})) * 1000)))::integer`
  return sql<number>`COALESCE(CASE WHEN ${workflowExecutionLogs.status} = 'pending' THEN ${workflowExecutionLogs.totalDurationMs} END, ${elapsed})`
}
