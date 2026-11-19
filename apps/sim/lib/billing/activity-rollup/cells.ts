import { db, dbReplica } from '@sim/db'
import { activityRollupInflight, workflowActivityHourly, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresCancellationReason } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import {
  HOUR_MS,
  type InstantRange,
  msInterval,
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

/** Bounds every hour read on the replica; a read that hits it is retried at a finer grain. */
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
  workspaceIds?: string[]
): Promise<ActivityCell[]> {
  const rows = await executor.execute<CellRow>(sql`
    SELECT a.workspace_id, coalesce(a.workflow_id, '') AS workflow_id, a.trigger,
      ${workflowRunCounters}
    FROM (${workflowRunsStartedIn(range, workspaceIds)}) a
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

/** Workspaces read per statement once a slice is too heavy to read at once. */
const WORKSPACE_PAGE = 500

/** Reads of an hour's runs, from the whole span down to one page of workspaces at a time. */
export interface HourReaders {
  span: (range: InstantRange) => Promise<ActivityCell[]>
  /** The cells of up to a page of workspaces after `after` (by id), and the last one read. */
  workspacePage: (
    range: InstantRange,
    after: string | null
  ) => Promise<{ cells: ActivityCell[]; last: string | null }>
}

/** An hour that could not be read within the statement bounds, even a page of workspaces at a time. */
export class HeavyHourError extends Error {
  constructor(hour: Date, options: { cause: unknown }) {
    super(`Activity rollup hour ${hour.toISOString()} is too heavy to read`, options)
    this.name = 'HeavyHourError'
  }
}

/** Whether a read gave up on its own statement bound, or the replica cancelled it for recovery. */
function isBoundedCancellation(error: unknown): boolean {
  const reason = getPostgresCancellationReason(error)
  return reason === 'statement_timeout' || reason === 'recovery_conflict'
}

/** Runs `read` on the replica in a read-only transaction bounded like every hour read. */
function onReplica<T>(read: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return dbReplica.transaction(
    async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${HOUR_STATEMENT_TIMEOUT}, true)`)
      return read(tx)
    },
    { accessMode: 'read only' }
  )
}

const replicaReaders: HourReaders = {
  span: (range) => onReplica((tx) => aggregateRange(tx, range)),
  workspacePage: (range, after) =>
    onReplica(async (tx) => {
      const page = await tx.execute<{ id: string }>(sql`
        SELECT id FROM ${workspace} ${after === null ? sql`` : sql`WHERE id > ${after}`}
        ORDER BY id LIMIT ${WORKSPACE_PAGE}
      `)
      const ids = page.map(({ id }) => id)
      if (ids.length === 0) return { cells: [], last: null }
      const cells = await aggregateRange(tx, range, ids)
      return { cells, last: ids.length < WORKSPACE_PAGE ? null : (ids.at(-1) ?? null) }
    }),
}

/**
 * Every cell of one UTC hour, read on the replica, at the coarsest grain that fits the statement
 * bounds. A span that times out (or that the replica cancels for recovery) is read again in
 * quarter-hour slices, and a slice that still does is read a page of workspaces at a time, each on
 * the workspace activity index. All of these count exactly the same runs, so their cells are
 * summed. Throws {@link HeavyHourError} when even a page of workspaces cannot be read, or the
 * pass's `deadline` passes while paging.
 */
export async function aggregateHour(
  hour: Date,
  deadline: number,
  {
    readers = replicaReaders,
    byWorkspace: startByWorkspace = false,
  }: {
    readers?: HourReaders
    /** Skips straight to workspace pages: a retry of an hour already known to be too heavy. */
    byWorkspace?: boolean
  } = {}
): Promise<ActivityCell[]> {
  if (!startByWorkspace) {
    try {
      return await readers.span({ from: hour, to: new Date(hour.getTime() + HOUR_MS) })
    } catch (error) {
      if (!isBoundedCancellation(error)) throw error
      logger.warn('Activity rollup hour read in slices', {
        hour: hour.toISOString(),
        reason: getPostgresCancellationReason(error),
      })
    }
  }
  const sliceMs = HOUR_MS / SLICES_PER_HOUR
  const parts: ActivityCell[][] = []
  // Once one slice needs workspace pages, later slices skip the span read bound to fail.
  let byWorkspace = startByWorkspace
  for (let slice = 0; slice < SLICES_PER_HOUR; slice++) {
    const from = new Date(hour.getTime() + slice * sliceMs)
    const range = { from, to: new Date(from.getTime() + sliceMs) }
    if (!byWorkspace) {
      try {
        parts.push(await readers.span(range))
        continue
      } catch (error) {
        if (!isBoundedCancellation(error)) throw error
        logger.warn('Activity rollup slice read by workspace', {
          from: from.toISOString(),
          reason: getPostgresCancellationReason(error),
        })
        byWorkspace = true
      }
    }
    parts.push(await readByWorkspace(hour, range, deadline, readers))
  }
  return sumCells(parts)
}

/**
 * Reads a slice a page of workspaces at a time. Gives the hour up as too heavy when a page still
 * times out, or when the pass's budget runs out first, so a heavy hour never outlives the lease.
 */
async function readByWorkspace(
  hour: Date,
  range: InstantRange,
  deadline: number,
  readers: HourReaders
): Promise<ActivityCell[]> {
  const parts: ActivityCell[][] = []
  let after: string | null = null
  for (;;) {
    if (Date.now() >= deadline) {
      throw new HeavyHourError(hour, { cause: new Error('Pass budget ran out') })
    }
    try {
      const page = await readers.workspacePage(range, after)
      parts.push(page.cells)
      if (page.last === null) return sumCells(parts)
      after = page.last
    } catch (error) {
      throw isBoundedCancellation(error) ? new HeavyHourError(hour, { cause: error }) : error
    }
  }
}

/**
 * Runs `work` in a primary transaction whose statements and lock waits are bounded, so no rollup
 * statement outlives the pass's budget and lease by much.
 */
export function boundedTransaction<T>(work: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('statement_timeout', ${WRITE_STATEMENT_TIMEOUT}, true),
      set_config('lock_timeout', ${WRITE_LOCK_TIMEOUT}, true)`)
    return work(tx)
  })
}

/** Holds the hour's lock until the bounded write that takes it commits. */
async function lockHour(tx: DbTransaction, hour: Date): Promise<void> {
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
      SELECT ws, ${bucket}, now() + ${msInterval(INFLIGHT_FIRST_CHECK_MS)}, 0
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
  return boundedTransaction(async (tx) => {
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
  await boundedTransaction(async (tx) => {
    await lockHour(tx, hour)
    const cells = await aggregateRange(tx, { from: hour, to: new Date(hour.getTime() + HOUR_MS) }, [
      workspaceId,
    ])
    const inFlight = await writeCells(tx, hour, cells, workspaceId)
    await settle(tx, inFlight)
  })
}

/** The delay before the next recheck of a cell that has been rechecked `attempts` times. */
export function inflightBackoffMs(attempts: number): number {
  return Math.min(INFLIGHT_MAX_CHECK_MS, INFLIGHT_FIRST_CHECK_MS * 2 ** attempts)
}
