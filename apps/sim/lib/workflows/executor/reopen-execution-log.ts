import { pausedExecutions, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { markWorkflowActivityDirty } from '@/lib/billing/activity-rollup/marks'
import type { DbTransaction } from '@/lib/db/types'

/**
 * The terminal columns a `workflow_execution_logs` row keeps when a partial
 * resume moves it back to `pending`.
 *
 * The revival claim excludes only `cancelled`, so it also matches a row
 * `markResumeFailed` already ended: one context's resume fails, a sibling
 * context resumes successfully afterwards, and the run becomes live again
 * carrying the end timestamp and duration of the attempt that failed. A live row
 * must not carry a terminal stamp — and because `elapsedDurationMsSql` preserves
 * a `pending` row's `total_duration_ms` as its pause checkpoint, leaving it
 * there also hands the next terminal write a duration frozen at the failed
 * resume rather than one it recomputes.
 *
 * A row revived from a non-terminal status is the opposite case: its columns are
 * the checkpoint `completeWithPause` banked, which is precisely what that
 * preservation rule exists to keep, so they survive untouched. The row's own
 * status decides, read — like every expression in the same `SET` — against the
 * pre-update row.
 */
const revivedExecutionLogStamp = {
  endedAt: sql<Date | null>`CASE WHEN ${workflowExecutionLogs.status} IN ('failed', 'completed') THEN NULL ELSE ${workflowExecutionLogs.endedAt} END`,
  totalDurationMs: sql<
    number | null
  >`CASE WHEN ${workflowExecutionLogs.status} IN ('failed', 'completed') THEN NULL ELSE ${workflowExecutionLogs.totalDurationMs} END`,
}

/**
 * Moves a parent run's log back to `pending` after one of several pause contexts resumed, unless
 * the run was cancelled or is being cancelled. A run that had already ended goes back to unfinished
 * without an end, which the activity rollup cannot find by itself, so its cell is marked for
 * recomputing in the same transaction.
 */
export async function reopenExecutionLogForNextPause(
  tx: DbTransaction,
  parentExecutionId: string
): Promise<void> {
  const reopened = await tx
    .update(workflowExecutionLogs)
    .set({ status: 'pending', executionDeadlineAt: null, ...revivedExecutionLogStamp })
    .where(
      and(
        eq(workflowExecutionLogs.executionId, parentExecutionId),
        sql`${workflowExecutionLogs.status} != 'cancelled'`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${pausedExecutions}
          WHERE ${pausedExecutions.executionId} = ${parentExecutionId}
            AND ${pausedExecutions.status} = 'cancelling'
        )`
      )
    )
    .returning({
      workspaceId: workflowExecutionLogs.workspaceId,
      startedAt: workflowExecutionLogs.startedAt,
    })
  await markWorkflowActivityDirty(tx, reopened)
}
