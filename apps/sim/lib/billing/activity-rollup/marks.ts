import { db } from '@sim/db'
import { activityRollupDirty, activityRollupState, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { lt, sql } from 'drizzle-orm'
import {
  boundedTransaction,
  inflightBackoffMs,
  recomputeCell,
} from '@/lib/billing/activity-rollup/cells'
import {
  ACTIVITY_ROLLUP_SETTLE_MS,
  floorHour,
  HOUR_MS,
  msInterval,
  utcTimestamp,
} from '@/lib/billing/activity-rollup/source'
import {
  type ActivityRollupState,
  MAINTENANCE_GAP_MS,
  WORKFLOW_ROLLUP_ID,
} from '@/lib/billing/activity-rollup/state'
import type { DbTransaction } from '@/lib/db/types'

const logger = createLogger('ActivityRollupMarks')

/**
 * How far behind now the late-end scan stays: an end is stamped by the app before its write
 * commits, so the scan only consumes ends old enough that every write stamped with them is
 * visible. Ends younger than this are read by a later pass. A writer whose stamp can trail its
 * commit by longer marks the runs it finishes itself (see {@link markFinishedRunsDirty}).
 */
export const LATE_END_SCAN_MARGIN_MS = 5 * 60 * 1000

/** Late ends read per statement, so a scan that fell behind catches up in bounded steps. */
const LATE_END_BATCH_ROWS = 5_000

const DIRTY_BATCH = 500

/** A source run whose cell must be recomputed. */
interface ChangedRun {
  workspaceId: string
  startedAt: Date
}

/**
 * Marks the rollup cells of `runs` for recomputing, in the caller's transaction so the marks
 * commit exactly when the change does. For changes the rollup pass cannot see on its own:
 * deleted runs, finished runs reopened without an end, and runs whose end committed too late for
 * the late-end scan (see {@link markFinishedRunsDirty}).
 *
 * Runs in a savepoint and never throws: a mark that fails (the table missing mid-deploy) is logged
 * and the caller's change goes ahead, so retention and resumes behave exactly as without the
 * rollup. A missed mark leaves one cell stale until the pass's sampler finds it.
 *
 * Nothing is marked unless a pass completed within {@link MAINTENANCE_GAP_MS}: a deployment that
 * never enabled the rollup, or turned maintenance off, accumulates no marks, and the next pass after
 * such a gap rebuilds the rollup rather than trusting marks it never got. A pass that only takes the
 * lease (idling on a newer version, or failing) does not count.
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
        WHERE EXISTS (
          SELECT 1 FROM ${activityRollupState}
          WHERE maintained_at > now() - ${msInterval(MAINTENANCE_GAP_MS)}
        )
        -- Writers of several marks lock them in key order, so two can never deadlock.
        ORDER BY 1, 2
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

/** Runs younger than this lie in hours not computed yet: the settle lag less an hour of clock margin. */
const FINISHED_RUN_MARK_AGE_MS = ACTIVITY_ROLLUP_SETTLE_MS - HOUR_MS

/**
 * Marks the cells of runs whose final status is being written, in the transaction that writes it,
 * when their hours may already be computed. Their ends were stamped before the write, so it can
 * commit after the late-end scan passed the end, or after the hour was computed without a late end.
 */
export async function markFinishedRunsDirty(tx: DbTransaction, runs: ChangedRun[]): Promise<void> {
  const settled = Date.now() - FINISHED_RUN_MARK_AGE_MS
  await markWorkflowActivityDirty(
    tx,
    runs.filter((run) => run.startedAt.getTime() <= settled)
  )
}

/**
 * Marks the cells of runs that ended at least two hours after they started since the last scan,
 * and moves the scan forward. Their hours were computed before they ended (HITL runs resumed
 * later, cancellations, stale-run sweeps, runs terminalized again, late inserts); a run that ends
 * sooner lands in an hour not yet settled. Marks of hours not yet covered wait until they are (see
 * {@link processDirtyMarks}).
 *
 * The scan consumes ends in order, a bounded batch per statement, so a backlog is caught up in
 * steps: each statement marks every end up to its batch's last one (including ties beyond the
 * batch) and moves the scan there in the same statement. Returns how many cells were marked.
 */
export async function captureLateEnds(
  deadline: number,
  { batchRows = LATE_END_BATCH_ROWS, marginMs = LATE_END_SCAN_MARGIN_MS } = {}
): Promise<number> {
  let marked = 0
  for (;;) {
    const [step] = await boundedTransaction((tx) =>
      tx.execute<{ marked: number; batchFull: number }>(sql`
        WITH scan AS (
          SELECT last_end_scan AS cursor,
            (now() AT TIME ZONE 'UTC') - ${msInterval(marginMs)} AS horizon
          FROM ${activityRollupState} WHERE id = ${WORKFLOW_ROLLUP_ID}
        ), batch AS (
          SELECT l.ended_at FROM ${workflowExecutionLogs} l, scan
          -- Repeats the partial index's predicate literally, so the planner can use the index.
          WHERE l.ended_at >= l.started_at + interval '2 hours'
            AND l.ended_at > scan.cursor AND l.ended_at <= scan.horizon
          ORDER BY l.ended_at
          LIMIT ${batchRows}
        ), bound AS (
          SELECT scan.cursor, b.is_full,
            CASE WHEN b.is_full THEN b.last ELSE scan.horizon END AS boundary
          FROM scan, (
            SELECT count(*) >= ${batchRows} AS is_full, max(ended_at) AS last FROM batch
          ) b
        ), marked AS (
          INSERT INTO ${activityRollupDirty} (workspace_id, bucket_start, due_at)
          SELECT DISTINCT l.workspace_id, date_trunc('hour', l.started_at), now()
          FROM ${workflowExecutionLogs} l, bound
          WHERE l.ended_at >= l.started_at + interval '2 hours'
            AND l.ended_at > bound.cursor AND l.ended_at <= bound.boundary
          ORDER BY 1, 2
          ON CONFLICT (workspace_id, bucket_start) DO NOTHING
          RETURNING 1
        ), moved AS (
          UPDATE ${activityRollupState} SET last_end_scan = greatest(bound.cursor, bound.boundary)
          FROM bound WHERE id = ${WORKFLOW_ROLLUP_ID}
        )
        SELECT (SELECT count(*) FROM marked)::int AS marked, bound.is_full::int AS "batchFull"
        FROM bound
      `)
    )
    marked += Number(step?.marked ?? 0)
    if (Number(step?.batchFull) !== 1 || Date.now() >= deadline) return marked
  }
}

/**
 * Recomputes the cells marked dirty whose hours the rollup covers, oldest due first, each with
 * its mark removed in the same transaction and only at the `due_at` read, so a mark rewritten
 * meanwhile survives for the next pass. Marks of hours not covered yet wait: an hour being
 * finalized or backfilled is read on the replica, which may not have the change yet. Once the
 * backfill is complete, marks older than the coverage are dropped, since no cell holds them.
 * `finished` is whether every due mark was taken: false when the deadline or the batch cut it short.
 */
export async function processDirtyMarks(
  state: ActivityRollupState,
  deadline: number
): Promise<{ processed: number; finished: boolean }> {
  const { coverageStart, freshThrough, backfillCompletedAt } = state
  if (!coverageStart || !freshThrough) return { processed: 0, finished: true }
  if (backfillCompletedAt) {
    await db.delete(activityRollupDirty).where(lt(activityRollupDirty.bucketStart, coverageStart))
  }
  // `due_at` is read as text: a JS `Date` would drop the microseconds the guard compares.
  const marks = await db.execute<{
    workspaceId: string
    bucketMs: number
    seen: string
    attempts: number
  }>(sql`
    SELECT workspace_id AS "workspaceId", (extract(epoch FROM bucket_start) * 1000)::float8 AS "bucketMs",
      due_at::text AS seen, attempts
    FROM ${activityRollupDirty}
    WHERE due_at <= now()
      AND bucket_start >= ${utcTimestamp(coverageStart)} AND bucket_start < ${utcTimestamp(freshThrough)}
    ORDER BY due_at
    LIMIT ${DIRTY_BATCH}
  `)
  let processed = 0
  for (const mark of marks) {
    if (Date.now() >= deadline) return { processed, finished: false }
    const hour = new Date(Number(mark.bucketMs))
    const key = sql`workspace_id = ${mark.workspaceId} AND bucket_start = ${utcTimestamp(hour)}
      AND due_at = ${mark.seen}::timestamptz`
    try {
      await recomputeCell(mark.workspaceId, hour, async (tx) => {
        await tx.execute(sql`DELETE FROM ${activityRollupDirty} WHERE ${key}`)
      })
      processed++
    } catch (error) {
      // Retried with backoff so the rest of the queue proceeds; reads serve the hour live meanwhile.
      const attempts = Number(mark.attempts) + 1
      logger.error('Activity rollup dirty cell failed to recompute; backing off', {
        workspaceId: mark.workspaceId,
        hour: hour.toISOString(),
        attempts,
        error: getErrorMessage(error),
      })
      await db.execute(sql`
        UPDATE ${activityRollupDirty}
        SET attempts = ${attempts}, due_at = now() + ${msInterval(inflightBackoffMs(attempts - 1))}
        WHERE ${key}
      `)
    }
  }
  return { processed, finished: marks.length < DIRTY_BATCH }
}
