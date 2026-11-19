import { db } from '@sim/db'
import { activityRollupDirty, activityRollupState, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq, lt, sql } from 'drizzle-orm'
import { boundedTransaction, recomputeCell } from '@/lib/billing/activity-rollup/cells'
import { floorHour, utcTimestamp } from '@/lib/billing/activity-rollup/source'
import { type ActivityRollupState, WORKFLOW_ROLLUP_ID } from '@/lib/billing/activity-rollup/state'
import type { DbTransaction } from '@/lib/db/types'

const logger = createLogger('ActivityRollupMarks')

/**
 * How far before the last scan the next one starts again: an end is stamped by the app before its
 * write commits, so a run can become visible with an end slightly older than the scan that missed
 * it. Covers the replica lag the pass tolerates too.
 */
const LATE_END_SCAN_MARGIN = '5 minutes'

const DIRTY_BATCH = 500

/** A source run whose cell must be recomputed. */
interface ChangedRun {
  workspaceId: string
  startedAt: Date
}

/**
 * Marks the rollup cells of `runs` for recomputing, in the caller's transaction so the marks
 * commit exactly when the change does. For changes the rollup pass cannot see on its own:
 * deleted runs, and finished runs reopened without an end.
 *
 * Runs in a savepoint and never throws: a mark that fails (the table missing mid-deploy) is logged
 * and the caller's change goes ahead, so retention and resumes behave exactly as without the
 * rollup. A missed mark leaves one cell stale until the pass's sampler finds it. Nothing is marked
 * before the rollup has ever run, so a deployment that never enables it accumulates no marks.
 */
export async function markWorkflowActivityDirty(
  tx: DbTransaction,
  runs: ChangedRun[]
): Promise<void> {
  if (runs.length === 0) return
  try {
    const cells = new Map<string, [string, string]>()
    for (const run of runs) {
      const cell: [string, string] = [run.workspaceId, floorHour(run.startedAt).toISOString()]
      cells.set(cell.join(' '), cell)
    }
    await tx.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        INSERT INTO ${activityRollupDirty} (workspace_id, bucket_start, due_at)
        SELECT c.cell ->> 0, ((c.cell ->> 1)::timestamptz AT TIME ZONE 'UTC'), now()
        FROM jsonb_array_elements(${JSON.stringify([...cells.values()])}::jsonb) AS c(cell)
        WHERE EXISTS (SELECT 1 FROM ${activityRollupState})
        ON CONFLICT (workspace_id, bucket_start) DO UPDATE SET due_at = excluded.due_at
      `)
    })
  } catch (error) {
    logger.error('Failed to mark activity rollup cells for recomputing', {
      runs: runs.length,
      error: getErrorMessage(error),
    })
  }
}

/**
 * Marks the cells of runs that ended at least two hours after they started since the last scan,
 * and moves the scan forward, in one transaction. Their hours were computed before they ended
 * (HITL runs resumed later, cancellations, stale-run sweeps, runs terminalized again, late
 * inserts). A run that ends sooner lands in an hour not yet settled. Marks of hours not yet
 * covered wait until they are (see {@link processDirtyMarks}). Returns how many cells were marked.
 */
export async function captureLateEnds(): Promise<number> {
  return boundedTransaction(async (tx) => {
    const marked = await tx.execute(sql`
      INSERT INTO ${activityRollupDirty} (workspace_id, bucket_start, due_at)
      SELECT DISTINCT l.workspace_id, date_trunc('hour', l.started_at), now()
      FROM ${workflowExecutionLogs} l
      CROSS JOIN (
        SELECT last_end_scan FROM ${activityRollupState} WHERE id = ${WORKFLOW_ROLLUP_ID}
      ) scan
      -- Repeats the partial index's predicate literally, so the planner can use the index.
      WHERE l.ended_at >= l.started_at + interval '2 hours'
        AND l.ended_at > scan.last_end_scan - ${LATE_END_SCAN_MARGIN}::interval
      ON CONFLICT (workspace_id, bucket_start) DO NOTHING
    `)
    await tx
      .update(activityRollupState)
      .set({ lastEndScan: sql`(now() AT TIME ZONE 'UTC')` })
      .where(eq(activityRollupState.id, WORKFLOW_ROLLUP_ID))
    return marked.count
  })
}

/**
 * Recomputes the cells marked dirty whose hours the rollup covers, oldest due first, each with
 * its mark removed in the same transaction and only at the `due_at` read, so a mark rewritten
 * meanwhile survives for the next pass. Marks of hours not covered yet wait: an hour being
 * finalized or backfilled is read on the replica, which may not have the change yet. Once the
 * backfill is complete, marks older than the coverage are dropped, since no cell holds them.
 */
export async function processDirtyMarks(
  state: ActivityRollupState,
  deadline: number
): Promise<number> {
  const { coverageStart, freshThrough, backfillCompletedAt } = state
  if (!coverageStart || !freshThrough) return 0
  if (backfillCompletedAt) {
    await db.delete(activityRollupDirty).where(lt(activityRollupDirty.bucketStart, coverageStart))
  }
  // `due_at` is read as text: a JS `Date` would drop the microseconds the guard compares.
  const marks = await db.execute<{ workspaceId: string; bucketMs: number; seen: string }>(sql`
    SELECT workspace_id AS "workspaceId", (extract(epoch FROM bucket_start) * 1000)::float8 AS "bucketMs",
      due_at::text AS seen
    FROM ${activityRollupDirty}
    WHERE due_at <= now()
      AND bucket_start >= ${utcTimestamp(coverageStart)} AND bucket_start < ${utcTimestamp(freshThrough)}
    ORDER BY due_at
    LIMIT ${DIRTY_BATCH}
  `)
  let processed = 0
  for (const mark of marks) {
    if (Date.now() >= deadline) break
    const hour = new Date(Number(mark.bucketMs))
    await recomputeCell(mark.workspaceId, hour, async (tx) => {
      await tx.execute(sql`
        DELETE FROM ${activityRollupDirty}
        WHERE workspace_id = ${mark.workspaceId} AND bucket_start = ${utcTimestamp(hour)}
          AND due_at = ${mark.seen}::timestamptz
      `)
    })
    processed++
  }
  return processed
}
