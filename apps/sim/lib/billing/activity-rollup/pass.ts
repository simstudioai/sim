import { db, dbReplica } from '@sim/db'
import {
  activityRollupDirty,
  activityRollupInflight,
  workflowActivityHourly,
  workflowExecutionLogs,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { randomFloat } from '@sim/utils/random'
import { and, gte, inArray, lt, max, sql } from 'drizzle-orm'
import {
  aggregateHour,
  boundedTransaction,
  inflightBackoffMs,
  recomputeCell,
  writeHour,
} from '@/lib/billing/activity-rollup/cells'
import { captureLateEnds, processDirtyMarks } from '@/lib/billing/activity-rollup/marks'
import {
  floorHour,
  HOUR_MS,
  utcTimestamp,
  workflowRunCounters,
  workflowRunsStartedIn,
} from '@/lib/billing/activity-rollup/source'
import {
  ACTIVITY_ROLLUP_VERSION,
  type ActivityRollupState,
  acquireLease,
  releaseLease,
  resetToCurrentVersion,
  truncateRollupBatch,
  updateLeasedState,
} from '@/lib/billing/activity-rollup/state'

const logger = createLogger('ActivityRollupPass')

/**
 * How long after an hour ends before it is computed. A run that ends within two hours of its start
 * (the predicate of `workflow_execution_logs_late_end_idx`) has ended, and its write committed, by
 * then; one that ends later is found by its late end. The hour of margin covers commit and replica
 * lag, so this must stay at least an hour above that threshold.
 */
const ACTIVITY_ROLLUP_SETTLE_MS = 3 * HOUR_MS

/** Hours are read on the replica only while it is this close to the primary. */
const MAX_REPLICA_LAG_SECONDS = 30

const INFLIGHT_BATCH = 500
const SAMPLED_WORKSPACE_DAYS = 5
const HOUSEKEEPING_INTERVAL_MS = HOUR_MS
const GC_WORKSPACE_LIMIT = 100

export interface ActivityRollupPassOptions {
  /** How long the pass starts new work; a statement started before it runs to completion. */
  budgetMs: number
  /** Source rows the backfill reads per second, paced by sleeping between hours. */
  backfillRowsPerSecond: number
  /** The least sleep between two backfilled hours. */
  backfillMinGapMs: number
  now?: () => Date
}

export interface ActivityRollupPassResult {
  status: 'ran' | 'leased' | 'newer-version' | 'truncating'
  finalizedHours: number
  backfilledHours: number
  lateEndMarks: number
  dirtyRecomputed: number
  inflightRechecked: number
  samplerMismatches: number
  collectedWorkspaces: number
  replicaLagSeconds: number | null
  coverageStart: string | null
  freshThrough: string | null
  backfillComplete: boolean
}

/**
 * The replica's replay lag in seconds: the age of the last transaction it replayed. Read right
 * after the pass commits its lease, so a replica that is streaming has just replayed that commit,
 * while one whose WAL receiver is disconnected shows its real age however its LSNs compare. A
 * primary (no replica configured) has none; a replica that has replayed nothing counts as stale.
 */
async function readReplicaLagSeconds(): Promise<number> {
  const [row] = await dbReplica.execute<{ lag: number }>(sql`
    SELECT CASE
      WHEN NOT pg_is_in_recovery() THEN 0
      ELSE coalesce(extract(epoch FROM now() - pg_last_xact_replay_timestamp()), 'Infinity')
    END::float8 AS lag
  `)
  return Number(row?.lag ?? 0)
}

/** Creates the coverage on the first pass of a version: empty, ending at the last settled hour. */
function startCoverage(owner: string, settledThrough: Date): Promise<ActivityRollupState> {
  return updateLeasedState(owner, {
    coverageStart: settledThrough,
    freshThrough: settledThrough,
    lastEndScan: sql`(now() AT TIME ZONE 'UTC')`,
  })
}

/** Computes every hour that has settled since the last pass, oldest first. */
async function finalizeSettledHours(
  owner: string,
  state: ActivityRollupState,
  settledThrough: Date,
  deadline: number,
  result: ActivityRollupPassResult
): Promise<ActivityRollupState> {
  let current = state
  while (current.freshThrough && current.freshThrough < settledThrough && Date.now() < deadline) {
    const hour = current.freshThrough
    const cells = await aggregateHour(hour)
    current = await writeHour(hour, cells, (tx) =>
      updateLeasedState(owner, { freshThrough: new Date(hour.getTime() + HOUR_MS) }, tx)
    )
    result.finalizedHours++
  }
  return current
}

/**
 * Rechecks cells computed while runs in them were unfinished. A cell with none left is dropped
 * from the queue; one still unfinished is checked again later, backing off to a few hours, since
 * it is usually a paused run waiting on a person.
 */
async function recheckInflightCells(deadline: number): Promise<number> {
  const due = await db.execute<{ workspaceId: string; bucketMs: number; attempts: number }>(sql`
    SELECT workspace_id AS "workspaceId", (extract(epoch FROM bucket_start) * 1000)::float8 AS "bucketMs",
      attempts
    FROM ${activityRollupInflight}
    WHERE next_check_at <= now()
    ORDER BY next_check_at
    LIMIT ${INFLIGHT_BATCH}
  `)
  let rechecked = 0
  for (const cell of due) {
    if (Date.now() >= deadline) break
    const hour = new Date(Number(cell.bucketMs))
    const key = sql`workspace_id = ${cell.workspaceId} AND bucket_start = ${utcTimestamp(hour)}`
    await recomputeCell(cell.workspaceId, hour, async (tx, inFlight) => {
      if (inFlight === 0) {
        await tx.execute(sql`DELETE FROM ${activityRollupInflight} WHERE ${key}`)
        return
      }
      const attempts = Number(cell.attempts) + 1
      await tx.execute(sql`
        UPDATE ${activityRollupInflight}
        SET attempts = ${attempts},
          next_check_at = now() + ${`${inflightBackoffMs(attempts)} milliseconds`}::interval
        WHERE ${key}
      `)
    })
    rechecked++
  }
  return rechecked
}

/**
 * Extends the coverage back one populated hour at a time, newest first, so recent windows are
 * served from the rollup within minutes of the start. Empty hours are skipped in one step. Each
 * hour is read on the replica and written, with the coverage moved, in one primary transaction,
 * so a crash between the two leaves the hour to the next pass. Paced to a row budget so the
 * backfill never competes with the requests it exists to speed up.
 */
async function backfill(
  owner: string,
  state: ActivityRollupState,
  options: ActivityRollupPassOptions,
  deadline: number,
  result: ActivityRollupPassResult
): Promise<ActivityRollupState> {
  let current = state
  while (current.coverageStart && !current.backfillCompletedAt && Date.now() < deadline) {
    const coverageStart = current.coverageStart
    const [latest] = await dbReplica
      .select({ startedAt: max(workflowExecutionLogs.startedAt) })
      .from(workflowExecutionLogs)
      .where(lt(workflowExecutionLogs.startedAt, coverageStart))
    if (!latest?.startedAt) {
      current = await updateLeasedState(owner, { backfillCompletedAt: sql`now()` })
      break
    }
    const hour = floorHour(latest.startedAt)
    const started = Date.now()
    const cells = await aggregateHour(hour)
    current = await writeHour(hour, cells, async (tx) => {
      await tx
        .delete(workflowActivityHourly)
        .where(
          and(
            gte(workflowActivityHourly.bucketStart, new Date(hour.getTime() + HOUR_MS)),
            lt(workflowActivityHourly.bucketStart, coverageStart)
          )
        )
      return updateLeasedState(owner, { coverageStart: hour }, tx)
    })
    result.backfilledHours++
    const rows = cells.reduce((sum, cell) => sum + cell.runs, 0)
    const pacedMs = (rows / options.backfillRowsPerSecond) * 1000 - (Date.now() - started)
    const gapMs = Math.max(options.backfillMinGapMs, pacedMs)
    if (gapMs > 0) await sleep(Math.min(gapMs, Math.max(0, deadline - Date.now())))
  }
  return current
}

/**
 * Deletes the cells of workspaces that no longer exist. Reads never return them (they join
 * `workspace`), so this only reclaims space. Distinct workspaces are found by skipping through
 * the primary key rather than scanning every cell.
 */
async function collectDeletedWorkspaces(): Promise<number> {
  return boundedTransaction(async (tx) => {
    const gone = await tx.execute<{ workspaceId: string }>(sql`
    WITH RECURSIVE ids AS (
      (SELECT workspace_id FROM ${workflowActivityHourly} ORDER BY workspace_id LIMIT 1)
      UNION ALL
      SELECT (
        SELECT h.workspace_id FROM ${workflowActivityHourly} h
        WHERE h.workspace_id > ids.workspace_id ORDER BY h.workspace_id LIMIT 1
      ) FROM ids WHERE ids.workspace_id IS NOT NULL
    )
    SELECT ids.workspace_id AS "workspaceId" FROM ids
    WHERE ids.workspace_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${workspace} w WHERE w.id = ids.workspace_id)
    LIMIT ${GC_WORKSPACE_LIMIT}
  `)
    if (gone.length > 0) {
      await tx.delete(workflowActivityHourly).where(
        inArray(
          workflowActivityHourly.workspaceId,
          gone.map(({ workspaceId }) => workspaceId)
        )
      )
    }
    return gone.length
  })
}

/**
 * The backstop for changes nothing marked: compares the stored cells of a few random workspace
 * days with the source runs, hour by hour, in one statement on the primary, and marks every hour
 * that disagrees. Hours whose unfinished runs are queued for a recheck are expected to disagree
 * and are left to that.
 */
async function sampleStoredDays(state: ActivityRollupState, deadline: number): Promise<number> {
  const { coverageStart, freshThrough } = state
  if (!coverageStart || !freshThrough || freshThrough <= coverageStart) return 0
  let mismatches = 0
  for (let sample = 0; sample < SAMPLED_WORKSPACE_DAYS && Date.now() < deadline; sample++) {
    const span = freshThrough.getTime() - coverageStart.getTime()
    const hour = floorHour(new Date(coverageStart.getTime() + randomFloat() * span))
    mismatches += await boundedTransaction(async (tx) => {
      const [picked] = await tx.execute<{ workspaceId: string }>(sql`
      SELECT workspace_id AS "workspaceId" FROM ${workflowActivityHourly}
      WHERE bucket_start = ${utcTimestamp(hour)}
      ORDER BY random() LIMIT 1
    `)
      if (!picked) return 0
      const dayStart = new Date(Math.max(coverageStart.getTime(), hour.getTime() - 12 * HOUR_MS))
      const dayEnd = new Date(Math.min(freshThrough.getTime(), hour.getTime() + 12 * HOUR_MS))
      const differing = await tx.execute(sql`
      WITH source AS (
        SELECT date_trunc('hour', a.started_at) AS hour, a.workflow_id, a.trigger,
          ${workflowRunCounters}
        FROM (${workflowRunsStartedIn({ from: dayStart, to: dayEnd }, picked.workspaceId)}) a
        GROUP BY 1, 2, 3
      ), stored AS (
        SELECT h.bucket_start AS hour, nullif(h.workflow_id, '') AS workflow_id, h.trigger,
          h.runs, h.completed, h.failed, h.cancelled, h.in_flight, h.duration_sum_ms,
          h.duration_count
        FROM ${workflowActivityHourly} h
        WHERE h.workspace_id = ${picked.workspaceId}
          AND h.bucket_start >= ${utcTimestamp(dayStart)} AND h.bucket_start < ${utcTimestamp(dayEnd)}
      ), differing AS (
        SELECT DISTINCT coalesce(s.hour, t.hour) AS hour
        FROM source s FULL JOIN stored t
          ON t.hour = s.hour AND t.trigger = s.trigger
            AND t.workflow_id IS NOT DISTINCT FROM s.workflow_id
        WHERE (s.runs, s.completed, s.failed, s.cancelled, s.in_flight, s.duration_sum_ms,
            s.duration_count)
          IS DISTINCT FROM (t.runs, t.completed, t.failed, t.cancelled, t.in_flight,
            t.duration_sum_ms, t.duration_count)
      )
      INSERT INTO ${activityRollupDirty} (workspace_id, bucket_start, due_at)
      SELECT ${picked.workspaceId}, d.hour, now() FROM differing d
      WHERE NOT EXISTS (
        SELECT 1 FROM ${activityRollupInflight} q
        WHERE q.workspace_id = ${picked.workspaceId} AND q.bucket_start = d.hour
      )
      ON CONFLICT (workspace_id, bucket_start) DO UPDATE SET due_at = excluded.due_at
    `)
      return differing.count
    })
  }
  if (mismatches > 0) logger.warn('Activity rollup sampler found stale cells', { mismatches })
  return mismatches
}

/**
 * One maintenance pass over the workflow activity rollup. Idempotent and safe to stop anywhere:
 * every hour is recomputed whole from the source and written with the progress it completes.
 *
 * 1. Marks the cells of runs that ended late since the last pass.
 * 2. Computes the hours that settled since the last pass (on the replica).
 * 3. Recomputes cells marked dirty (deletes, reopened runs, late ends) and cells rechecked for
 *    runs that were unfinished (on the primary).
 * 4. Extends the backfill toward the oldest run (on the replica, paced).
 * 5. Hourly, reclaims deleted workspaces' cells and samples stored days against the source.
 *
 * A pass on code older than the stored version does nothing; one on newer code first resets the
 * rollup to its version.
 */
export async function runActivityRollupPass(
  options: ActivityRollupPassOptions
): Promise<ActivityRollupPassResult> {
  const now = options.now ?? (() => new Date())
  const deadline = Date.now() + options.budgetMs
  const result: ActivityRollupPassResult = {
    status: 'ran',
    finalizedHours: 0,
    backfilledHours: 0,
    lateEndMarks: 0,
    dirtyRecomputed: 0,
    inflightRechecked: 0,
    samplerMismatches: 0,
    collectedWorkspaces: 0,
    replicaLagSeconds: null,
    coverageStart: null,
    freshThrough: null,
    backfillComplete: false,
  }
  const owner = generateId()
  let state = await acquireLease(owner)
  if (!state) return { ...result, status: 'leased' }
  try {
    if (state.version > ACTIVITY_ROLLUP_VERSION) return { ...result, status: 'newer-version' }
    if (state.version < ACTIVITY_ROLLUP_VERSION) state = await resetToCurrentVersion(owner)

    const settledThrough = new Date(floorHour(now()).getTime() - ACTIVITY_ROLLUP_SETTLE_MS)
    if (!state.freshThrough) {
      while (await truncateRollupBatch()) {
        if (Date.now() >= deadline) return { ...result, status: 'truncating' }
      }
      state = await startCoverage(owner, settledThrough)
    }

    result.lateEndMarks = await captureLateEnds()
    result.replicaLagSeconds = await readReplicaLagSeconds()
    const replicaCurrent = result.replicaLagSeconds <= MAX_REPLICA_LAG_SECONDS
    if (replicaCurrent) {
      state = await finalizeSettledHours(owner, state, settledThrough, deadline, result)
    } else {
      logger.warn('Activity rollup skipped replica reads for lag', {
        replicaLagSeconds: result.replicaLagSeconds,
      })
    }
    result.dirtyRecomputed = await processDirtyMarks(state, deadline)
    result.inflightRechecked = await recheckInflightCells(deadline)
    if (replicaCurrent) state = await backfill(owner, state, options, deadline, result)

    const housekeepingDue =
      !state.housekeepingAt ||
      Date.now() - state.housekeepingAt.getTime() >= HOUSEKEEPING_INTERVAL_MS
    if (housekeepingDue && Date.now() < deadline) {
      result.collectedWorkspaces = await collectDeletedWorkspaces()
      result.samplerMismatches = await sampleStoredDays(state, deadline)
      state = await updateLeasedState(owner, { housekeepingAt: sql`now()` })
    }

    result.coverageStart = state.coverageStart?.toISOString() ?? null
    result.freshThrough = state.freshThrough?.toISOString() ?? null
    result.backfillComplete = Boolean(state.backfillCompletedAt)
    logger.info('Activity rollup pass finished', { ...result })
    return result
  } finally {
    await releaseLease(owner)
  }
}
