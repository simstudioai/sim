import { db, dbReplica } from '@sim/db'
import { activityRollupInflight, workflowActivityHourly } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresCancellationReason } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import {
  HOUR_MS,
  type InstantRange,
  utcTimestamp,
  workflowRunCounters,
  workflowRunsStartedIn,
} from '@/lib/billing/activity-rollup/source'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'

const logger = createLogger('ActivityRollupCells')

/** One stored row of an hour: its key within the hour and its counters. */
export interface ActivityCell {
  workspaceId: string
  /** `''` when the runs' workflow is deleted. */
  workflowId: string
  trigger: string
  runs: number
  completed: number
  failed: number
  cancelled: number
  inFlight: number
  durationSumMs: number
  durationCount: number
}

type CellRow = Record<string, unknown> & {
  workspace_id: string
  workflow_id: string
  trigger: string
  runs: string | number
  completed: string | number
  failed: string | number
  cancelled: string | number
  in_flight: string | number
  duration_sum_ms: string | number
  duration_count: string | number
}

/** How long a whole-hour aggregate may run on the replica before the hour is read in slices. */
const HOUR_STATEMENT_TIMEOUT = '20s'
const SLICES_PER_HOUR = 4

/** Bounds every write so a pass never holds rollup locks for long. */
const WRITE_STATEMENT_TIMEOUT = '15s'
const WRITE_LOCK_TIMEOUT = '2s'

const LOCK_TAG = 'activity_rollup'

/** First recheck of a cell computed with unfinished runs, doubled per attempt up to the cap. */
const INFLIGHT_FIRST_CHECK_MS = 10 * 60 * 1000
const INFLIGHT_MAX_CHECK_MS = 6 * HOUR_MS

/** The aggregate of runs that started in `range`, keyed by workspace, workflow, and trigger. */
async function aggregateRange(
  executor: Pick<DbTransaction, 'execute'>,
  range: InstantRange,
  workspaceId?: string
): Promise<ActivityCell[]> {
  const rows = await executor.execute<CellRow>(sql`
    SELECT a.workspace_id, coalesce(a.workflow_id, '') AS workflow_id, a.trigger,
      ${workflowRunCounters}
    FROM (${workflowRunsStartedIn(range, workspaceId)}) a
    GROUP BY 1, 2, 3
  `)
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    workflowId: row.workflow_id,
    trigger: row.trigger,
    runs: Number(row.runs),
    completed: Number(row.completed),
    failed: Number(row.failed),
    cancelled: Number(row.cancelled),
    inFlight: Number(row.in_flight),
    durationSumMs: Number(row.duration_sum_ms),
    durationCount: Number(row.duration_count),
  }))
}

function cellKey(cell: ActivityCell): string {
  return JSON.stringify([cell.workspaceId, cell.workflowId, cell.trigger])
}

/** Cells of disjoint spans summed into the cells of their union. */
function sumCells(parts: ActivityCell[][]): ActivityCell[] {
  const byKey = new Map<string, ActivityCell>()
  for (const cell of parts.flat()) {
    const existing = byKey.get(cellKey(cell))
    if (!existing) {
      byKey.set(cellKey(cell), { ...cell })
      continue
    }
    existing.runs += cell.runs
    existing.completed += cell.completed
    existing.failed += cell.failed
    existing.cancelled += cell.cancelled
    existing.inFlight += cell.inFlight
    existing.durationSumMs += cell.durationSumMs
    existing.durationCount += cell.durationCount
  }
  return [...byKey.values()]
}

/**
 * Reads one span on the replica in its own read-only transaction, bounded so a heavy hour gives
 * up rather than running until the replica cancels it.
 */
function aggregateOnReplica(range: InstantRange): Promise<ActivityCell[]> {
  return dbReplica.transaction(
    async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${HOUR_STATEMENT_TIMEOUT}, true)`)
      return aggregateRange(tx, range)
    },
    { accessMode: 'read only' }
  )
}

/**
 * Every cell of one UTC hour, read on the replica. An hour too heavy for one statement (it timed
 * out, or the replica cancelled it for recovery) is read again in slices whose cells are summed,
 * which counts exactly the same runs. `read` is the span reader, replaceable to exercise a heavy
 * hour.
 */
export async function aggregateHour(
  hour: Date,
  read: (range: InstantRange) => Promise<ActivityCell[]> = aggregateOnReplica
): Promise<ActivityCell[]> {
  try {
    return await read({ from: hour, to: new Date(hour.getTime() + HOUR_MS) })
  } catch (error) {
    const reason = getPostgresCancellationReason(error)
    if (reason !== 'statement_timeout' && reason !== 'recovery_conflict') throw error
    logger.warn('Activity rollup hour read in slices', { hour: hour.toISOString(), reason })
    const sliceMs = HOUR_MS / SLICES_PER_HOUR
    const parts: ActivityCell[][] = []
    for (let slice = 0; slice < SLICES_PER_HOUR; slice++) {
      const from = new Date(hour.getTime() + slice * sliceMs)
      parts.push(await read({ from, to: new Date(from.getTime() + sliceMs) }))
    }
    return sumCells(parts)
  }
}

/** Opens a bounded write on the primary that holds the hour's lock until it commits. */
async function lockHour(tx: DbTransaction, hour: Date): Promise<void> {
  await tx.execute(sql`SELECT set_config('statement_timeout', ${WRITE_STATEMENT_TIMEOUT}, true),
    set_config('lock_timeout', ${WRITE_LOCK_TIMEOUT}, true)`)
  await acquireAdvisoryXactLock(tx, LOCK_TAG, `workflow:${hour.toISOString()}`)
}

/**
 * Makes the stored cells of `hour` (or of one workspace's part of it) exactly `cells`: rows that
 * differ are rewritten, missing ones inserted, and stored keys the aggregate no longer has are
 * deleted. Unchanged rows are not touched, so `computed_at` is when a cell last changed. Cells
 * that still hold unfinished runs are queued for a recheck. Returns how many runs in the written
 * cells are unfinished.
 */
async function writeCells(
  tx: DbTransaction,
  hour: Date,
  cells: ActivityCell[],
  workspaceId?: string
): Promise<number> {
  const bucket = utcTimestamp(hour)
  const incoming = sql`jsonb_to_recordset(${JSON.stringify(cells)}::jsonb) AS i(
    "workspaceId" text, "workflowId" text, trigger text, runs integer, completed integer,
    failed integer, cancelled integer, "inFlight" integer, "durationSumMs" bigint,
    "durationCount" integer)`
  await tx.execute(sql`
    DELETE FROM ${workflowActivityHourly} t
    WHERE t.bucket_start = ${bucket}
      ${workspaceId ? sql`AND t.workspace_id = ${workspaceId}` : sql``}
      AND NOT EXISTS (
        SELECT 1 FROM ${incoming}
        WHERE i."workspaceId" = t.workspace_id AND i."workflowId" = t.workflow_id
          AND i.trigger = t.trigger
      )
  `)
  if (cells.length > 0) {
    await tx.execute(sql`
      INSERT INTO ${workflowActivityHourly} AS t (workspace_id, bucket_start, workflow_id, trigger,
        runs, completed, failed, cancelled, in_flight, duration_sum_ms, duration_count, computed_at)
      SELECT i."workspaceId", ${bucket}, i."workflowId", i.trigger, i.runs, i.completed, i.failed,
        i.cancelled, i."inFlight", i."durationSumMs", i."durationCount", now()
      FROM ${incoming}
      ON CONFLICT (workspace_id, bucket_start, workflow_id, trigger) DO UPDATE SET
        runs = excluded.runs, completed = excluded.completed, failed = excluded.failed,
        cancelled = excluded.cancelled, in_flight = excluded.in_flight,
        duration_sum_ms = excluded.duration_sum_ms, duration_count = excluded.duration_count,
        computed_at = excluded.computed_at
      WHERE (t.runs, t.completed, t.failed, t.cancelled, t.in_flight, t.duration_sum_ms,
          t.duration_count)
        IS DISTINCT FROM (excluded.runs, excluded.completed, excluded.failed, excluded.cancelled,
          excluded.in_flight, excluded.duration_sum_ms, excluded.duration_count)
    `)
  }
  const unfinished = [
    ...new Set(cells.filter((cell) => cell.inFlight > 0).map((cell) => cell.workspaceId)),
  ]
  if (unfinished.length > 0) {
    await tx.execute(sql`
      INSERT INTO ${activityRollupInflight} (workspace_id, bucket_start, next_check_at, attempts)
      SELECT ws, ${bucket}, now() + ${`${INFLIGHT_FIRST_CHECK_MS} milliseconds`}::interval, 0
      FROM jsonb_array_elements_text(${JSON.stringify(unfinished)}::jsonb) AS ws
      ON CONFLICT (workspace_id, bucket_start) DO NOTHING
    `)
  }
  return cells.reduce((sum, cell) => sum + cell.inFlight, 0)
}

/**
 * Writes a whole hour read beforehand, then runs `advance` (the state move the hour completes) in
 * the same transaction, so progress never claims an hour that was not written.
 */
export async function writeHour<T>(
  hour: Date,
  cells: ActivityCell[],
  advance: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockHour(tx, hour)
    await writeCells(tx, hour, cells)
    return advance(tx)
  })
}

/**
 * Recomputes one workspace's cells of one hour from the primary, under the hour's lock, and runs
 * `settle` in the same transaction with the number of runs still unfinished.
 */
export async function recomputeCell(
  workspaceId: string,
  hour: Date,
  settle: (tx: DbTransaction, inFlight: number) => Promise<void>
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockHour(tx, hour)
    const cells = await aggregateRange(
      tx,
      { from: hour, to: new Date(hour.getTime() + HOUR_MS) },
      workspaceId
    )
    const inFlight = await writeCells(tx, hour, cells, workspaceId)
    await settle(tx, inFlight)
  })
}

/** The delay before the next recheck of a cell that has been rechecked `attempts` times. */
export function inflightBackoffMs(attempts: number): number {
  return Math.min(INFLIGHT_MAX_CHECK_MS, INFLIGHT_FIRST_CHECK_MS * 2 ** attempts)
}
