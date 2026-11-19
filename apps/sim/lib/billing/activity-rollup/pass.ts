import { db, dbReplica } from '@sim/db'
import {
  activityRollupBlocked,
  activityRollupDirty,
  activityRollupInflight,
  activityRollupState,
  workflow,
  workflowActivityHourly,
  workflowExecutionLogs,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { randomFloat } from '@sim/utils/random'
import { and, count, eq, gt, gte, inArray, lt, max, sql } from 'drizzle-orm'
import {
  type ActivityCell,
  aggregateHour,
  boundedTransaction,
  HeavyHourError,
  inflightBackoffMs,
  PassDeadlineError,
  recomputeCell,
  writeHour,
} from '@/lib/billing/activity-rollup/cells'
import {
  captureLateEnds,
  LATE_END_SCAN_MARGIN_MS,
  processDirtyMarks,
} from '@/lib/billing/activity-rollup/marks'
import {
  ACTIVITY_ROLLUP_SETTLE_MS,
  floorHour,
  HOUR_MS,
  type InstantRange,
  msInterval,
  utcTimestamp,
  workflowRunCounters,
  workflowRunsStartedIn,
} from '@/lib/billing/activity-rollup/source'
import {
  ACTIVITY_ROLLUP_VERSION,
  type ActivityRollupState,
  acquireLease,
  extendLease,
  readRollupState,
  refreshHeartbeat,
  releaseLease,
  resetRollup,
  truncateRollupBatch,
  updateLeasedState,
  WORKFLOW_ROLLUP_ID,
} from '@/lib/billing/activity-rollup/state'
import type { DbTransaction } from '@/lib/db/types'

const logger = createLogger('ActivityRollupPass')

/** The lease a heavy-hour retry adds on top of its own budget, for the statements around it. */
const LEASE_MARGIN_MS = 60 * 1000

/** Hours are read on the replica only when it replays the pass's lease within this long. */
const MAX_REPLICA_LAG_MS = 10 * 1000
const REPLICA_POLL_MS = 250

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
  /** Late ends read per statement; smaller only to exercise a scan's batching. */
  lateEndBatchRows?: number
  /** How far behind now the late-end scan stays; shorter only where nothing writes concurrently. */
  lateEndMarginMs?: number
  now?: () => Date
}

export interface ActivityRollupPassResult {
  status: 'ran' | 'leased' | 'newer-version' | 'truncating'
  /** Why the pass started the rollup over, when it did. */
  reset: 'version' | 'coverage' | 'maintenance-gap' | null
  /** Hours being retried with backoff because no read could aggregate them. */
  blockedHours: number
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
 * How long the replica takes to show the lease this pass just committed on the primary, in
 * seconds, or null when it has not within {@link MAX_REPLICA_LAG_MS}. The pass's own commit is the
 * heartbeat, so a quiet primary never reads as lag and a disconnected WAL receiver always does.
 * Without a replica, `dbReplica` is the primary and the lease is visible at once.
 */
async function waitForReplica(owner: string): Promise<number | null> {
  const started = Date.now()
  for (;;) {
    const state = await readRollupState(dbReplica)
    if (state?.leaseOwner === owner) return (Date.now() - started) / 1000
    if (Date.now() - started >= MAX_REPLICA_LAG_MS) return null
    await sleep(REPLICA_POLL_MS)
  }
}

/**
 * Creates the coverage after a reset: empty, ending at the last settled hour. The late-end scan
 * starts a margin back, since every hour is then computed from what the source holds after it.
 */
function startCoverage(
  owner: string,
  settledThrough: Date,
  marginMs: number
): Promise<ActivityRollupState> {
  return updateLeasedState(owner, {
    coverageStart: settledThrough,
    freshThrough: settledThrough,
    lastEndScan: sql`(now() AT TIME ZONE 'UTC') - ${msInterval(marginMs)}`,
    maintainedAt: sql`now()`,
    correctionsAt: sql`now()`,
  })
}

/**
 * Once this many passes in a row have failed (thrown, or died holding the lease), a deferred hour
 * counts as a retry, so a pass that keeps crashing while paging it backs it off instead of starting
 * it again every tick.
 */
const CRASHING_PASSES = 3

/** How long a retry of an hour too heavy to read may page through workspaces. */
const HEAVY_RETRY_MS = 2 * 60 * 1000
/** A retry's budget grows with its attempts up to this, still inside the task's duration. */
const MAX_HEAVY_RETRY_MS = 6 * 60 * 1000

/**
 * Backs off a heavy hour (before each retry, and when a first read finds it too heavy), so passes
 * stop retrying it every tick and their other steps keep running. Each blocked hour keeps its own
 * backoff, so a heavy hour on the finalize side and one on the backfill side never reset each
 * other's delay. Returns the delay.
 */
async function blockHour(hour: Date, attempts: number): Promise<number> {
  const retryInMs = inflightBackoffMs(attempts - 1)
  const retryAt = new Date(Date.now() + retryInMs)
  await db
    .insert(activityRollupBlocked)
    .values({ bucketStart: hour, attempts, retryAt })
    .onConflictDoUpdate({ target: activityRollupBlocked.bucketStart, set: { attempts, retryAt } })
  return retryInMs
}

/**
 * Leaves an hour the pass ran out of budget paging for the next pass to page from the start, with
 * no backoff and no attempt counted: running out of budget says nothing about the hour.
 */
async function deferPaging(hour: Date): Promise<void> {
  logger.warn('Activity rollup hour left for paging by the next pass', { hour: hour.toISOString() })
  await db
    .insert(activityRollupBlocked)
    .values({ bucketStart: hour, attempts: 0, retryAt: sql`now()` })
    .onConflictDoNothing()
}

/**
 * Aggregates and writes `hour` with the progress it completes, or leaves it: still backing off,
 * found too heavy to read, or out of pass budget while paging (left to the next pass). A blocked
 * or deferred hour skips the reads known to time out and pages through workspaces under its own
 * budget (a retry's grows with its attempts; the lease is extended to cover it), and a write that
 * completes it forgets the block in the same transaction.
 */
async function computeHour(
  owner: string,
  failedPasses: number,
  hour: Date,
  deadline: number,
  write: (
    cells: ActivityCell[],
    progress: (
      tx: DbTransaction,
      changes: Parameters<typeof updateLeasedState>[1]
    ) => Promise<ActivityRollupState>
  ) => Promise<ActivityRollupState>
): Promise<{ state: ActivityRollupState | null; runs: number }> {
  const [block] = await db
    .select()
    .from(activityRollupBlocked)
    .where(eq(activityRollupBlocked.bucketStart, hour))
  if (block && block.retryAt.getTime() > Date.now()) return { state: null, runs: 0 }
  /**
   * An hour a pass ran out of budget paging is deferred, not a retry: it is paged from the start
   * under its own budget, with no attempt counted and no backoff, only a hold for that window so a
   * pass that dies paging it does not start it again at once. A deferred hour that runs out of its
   * own budget too is heavy after all, and is backed off from then on.
   */
  const deferred = block?.attempts === 0 && failedPasses < CRASHING_PASSES
  let budgetMs = 0
  let retryInMs: number | undefined
  if (block) {
    if (deferred) {
      budgetMs = HEAVY_RETRY_MS
      await db
        .update(activityRollupBlocked)
        .set({ retryAt: new Date(Date.now() + budgetMs + LEASE_MARGIN_MS) })
        .where(eq(activityRollupBlocked.bucketStart, hour))
    } else {
      /**
       * A retry's backoff is committed before it starts, so a retry that crashes or loses its
       * lease is not tried again until the backoff passes.
       */
      const attempts = block.attempts + 1
      retryInMs = await blockHour(hour, attempts)
      budgetMs = Math.min(MAX_HEAVY_RETRY_MS, HEAVY_RETRY_MS * attempts)
    }
    await extendLease(owner, budgetMs + LEASE_MARGIN_MS)
  }
  let cells: ActivityCell[]
  try {
    cells = await aggregateHour(hour, block ? Date.now() + budgetMs : deadline, {
      byWorkspace: block !== undefined,
    })
  } catch (error) {
    if (error instanceof PassDeadlineError && !block) {
      await deferPaging(hour)
      return { state: null, runs: 0 }
    }
    if (!(error instanceof HeavyHourError || error instanceof PassDeadlineError)) throw error
    const attempts = (block?.attempts ?? 0) + 1
    retryInMs ??= await blockHour(hour, attempts)
    logger.error('Activity rollup hour too heavy to read; backing off', {
      hour: hour.toISOString(),
      attempts,
      retryInMs,
      error: getErrorMessage(error),
    })
    return { state: null, runs: 0 }
  }
  const state = await write(cells, async (tx, changes) => {
    if (block) {
      await tx.delete(activityRollupBlocked).where(eq(activityRollupBlocked.bucketStart, hour))
    }
    return updateLeasedState(owner, changes, tx, { requireCoverage: true })
  })
  return { state, runs: cells.reduce((sum, cell) => sum + cell.runs, 0) }
}

/** Computes the hours that settled since the last pass, oldest first, stopping at a blocked hour. */
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
    const computed = await computeHour(
      owner,
      current.failedPasses,
      hour,
      deadline,
      (cells, progress) =>
        writeHour(hour, cells, (tx) =>
          progress(tx, { freshThrough: new Date(hour.getTime() + HOUR_MS) })
        )
    )
    if (!computed.state) break
    current = computed.state
    result.finalizedHours++
  }
  return current
}

/**
 * Rechecks cells computed while runs in them were unfinished. A cell with none left is dropped
 * from the queue; one still unfinished is checked again later, backing off to a few hours, since
 * it is usually a paused run waiting on a person.
 */
async function recheckInflightCells(
  deadline: number
): Promise<{ rechecked: number; finished: boolean }> {
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
    if (Date.now() >= deadline) return { rechecked, finished: false }
    const hour = new Date(Number(cell.bucketMs))
    const key = sql`workspace_id = ${cell.workspaceId} AND bucket_start = ${utcTimestamp(hour)}`
    const attempts = Number(cell.attempts) + 1
    const backOff = sql`UPDATE ${activityRollupInflight}
      SET attempts = ${attempts}, next_check_at = now() + ${msInterval(inflightBackoffMs(attempts))}
      WHERE ${key}`
    try {
      await recomputeCell(cell.workspaceId, hour, async (tx, inFlight) => {
        await tx.execute(
          inFlight === 0 ? sql`DELETE FROM ${activityRollupInflight} WHERE ${key}` : backOff
        )
      })
      rechecked++
    } catch (error) {
      /**
       * One cell that cannot be recomputed must not hold up the rest of the queue. Its runs may
       * have finished with an end the late-end scan never sees, so it is also marked dirty: reads
       * serve it live, and the dirty queue retries it with its own backoff.
       */
      logger.error('Activity rollup in-flight cell failed to recompute; backing off', {
        workspaceId: cell.workspaceId,
        hour: hour.toISOString(),
        attempts,
        error: getErrorMessage(error),
      })
      await db.execute(backOff)
      await db.execute(sql`
        INSERT INTO ${activityRollupDirty} (workspace_id, bucket_start, due_at)
        VALUES (${cell.workspaceId}, ${utcTimestamp(hour)}, now() + ${msInterval(inflightBackoffMs(0))})
        ON CONFLICT (workspace_id, bucket_start) DO NOTHING
      `)
    }
  }
  return { rechecked, finished: due.length < INFLIGHT_BATCH }
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
    const computed = await computeHour(
      owner,
      current.failedPasses,
      hour,
      deadline,
      (cells, progress) =>
        writeHour(hour, cells, async (tx) => {
          await tx
            .delete(workflowActivityHourly)
            .where(
              and(
                gte(workflowActivityHourly.bucketStart, new Date(hour.getTime() + HOUR_MS)),
                lt(workflowActivityHourly.bucketStart, coverageStart)
              )
            )
          return progress(tx, { coverageStart: hour })
        })
    )
    if (!computed.state) break
    current = computed.state
    result.backfilledHours++
    const pacedMs = (computed.runs / options.backfillRowsPerSecond) * 1000 - (Date.now() - started)
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
 * Compares one workspace's stored cells in `range` with its source runs, hour by hour, in one
 * statement on the primary, and marks every hour that disagrees. Returns how many it marked.
 *
 * A stored cell's workflow is resolved the way reads resolve it (a deleted workflow's runs read as
 * deleted, as their nulled source rows do), and the cells are summed again after resolving. Hours
 * already marked, or queued for an unfinished-run recheck, are expected to disagree and left to
 * that.
 */
export function markStaleHours(workspaceId: string, range: InstantRange): Promise<number> {
  return boundedTransaction(async (tx) => {
    const marked = await tx.execute(sql`
      WITH source AS (
        SELECT date_trunc('hour', a.started_at) AS hour, a.workflow_id, a.trigger,
          ${workflowRunCounters}
        FROM (${workflowRunsStartedIn(range, [workspaceId])}) a
        GROUP BY 1, 2, 3
      ), stored AS (
        SELECT h.bucket_start AS hour,
          (SELECT f.id FROM ${workflow} f WHERE f.id = nullif(h.workflow_id, '')) AS workflow_id,
          h.trigger, sum(h.runs) AS runs, sum(h.completed) AS completed, sum(h.failed) AS failed,
          sum(h.cancelled) AS cancelled, sum(h.in_flight) AS in_flight,
          sum(h.duration_sum_ms) AS duration_sum_ms, sum(h.duration_count) AS duration_count
        FROM ${workflowActivityHourly} h
        WHERE h.workspace_id = ${workspaceId}
          AND h.bucket_start >= ${utcTimestamp(range.from)} AND h.bucket_start < ${utcTimestamp(range.to)}
        GROUP BY 1, 2, 3
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
      SELECT ${workspaceId}, d.hour, now() FROM differing d
      WHERE NOT EXISTS (
        SELECT 1 FROM ${activityRollupInflight} q
        WHERE q.workspace_id = ${workspaceId} AND q.bucket_start = d.hour
      )
      ORDER BY d.hour
      ON CONFLICT (workspace_id, bucket_start) DO NOTHING
    `)
    return marked.count
  })
}

/**
 * The backstop for changes nothing marked: compares a few random workspace days with the source
 * (see {@link markStaleHours}).
 */
async function sampleStoredDays(state: ActivityRollupState, deadline: number): Promise<number> {
  const { coverageStart, freshThrough } = state
  if (!coverageStart || !freshThrough || freshThrough <= coverageStart) return 0
  let mismatches = 0
  for (let sample = 0; sample < SAMPLED_WORKSPACE_DAYS && Date.now() < deadline; sample++) {
    const span = freshThrough.getTime() - coverageStart.getTime()
    const hour = floorHour(new Date(coverageStart.getTime() + randomFloat() * span))
    const [picked] = await dbReplica.execute<{ workspaceId: string }>(sql`
      SELECT workspace_id AS "workspaceId" FROM ${workflowActivityHourly}
      WHERE bucket_start = ${utcTimestamp(hour)}
      ORDER BY random() LIMIT 1
    `)
    if (!picked) continue
    mismatches += await markStaleHours(picked.workspaceId, {
      from: new Date(Math.max(coverageStart.getTime(), hour.getTime() - 12 * HOUR_MS)),
      to: new Date(Math.min(freshThrough.getTime(), hour.getTime() + 12 * HOUR_MS)),
    })
  }
  if (mismatches > 0) logger.warn('Activity rollup sampler found stale cells', { mismatches })
  return mismatches
}

/**
 * Reclaims deleted workspaces' cells and samples stored days, each in its own error boundary, so
 * neither can fail the pass or keep the other from running.
 */
async function runHousekeeping(
  state: ActivityRollupState,
  deadline: number,
  result: ActivityRollupPassResult
): Promise<void> {
  try {
    result.collectedWorkspaces = await collectDeletedWorkspaces()
  } catch (error) {
    logger.error('Activity rollup workspace collection failed', { error: getErrorMessage(error) })
  }
  try {
    result.samplerMismatches = await sampleStoredDays(state, deadline)
  } catch (error) {
    logger.error('Activity rollup sampler failed', { error: getErrorMessage(error) })
  }
}

/**
 * Why the rollup must start over regardless of its heartbeat, or null: a pass on newer code, or
 * coverage with an end missing (cleared by hand to force a rebuild, or never started). A maintenance
 * gap (see {@link refreshHeartbeat}) is the third reason. Read from the state alone, so a pass that
 * fails before its reset commits leaves the next pass the same reason.
 */
function resetReason(state: ActivityRollupState): ActivityRollupPassResult['reset'] {
  if (state.version < ACTIVITY_ROLLUP_VERSION) return 'version'
  if (!state.coverageStart || !state.freshThrough) return 'coverage'
  return null
}

/**
 * One maintenance pass over the workflow activity rollup. Idempotent and safe to stop anywhere:
 * every hour is recomputed whole from the source and written with the progress it completes.
 *
 * 1. Marks the cells of runs that ended late since the last pass.
 * 2. Computes the hours that settled since the last pass (on the replica). An hour no read can
 *    aggregate is backed off, holding finalize/backfill progress at it while the other steps run.
 * 3. Recomputes cells marked dirty (deletes, reopened runs, late ends) and cells rechecked for
 *    runs that were unfinished (on the primary).
 * 4. Extends the backfill toward the oldest run (on the replica, paced).
 * 5. Hourly, reclaims deleted workspaces' cells and samples stored days against the source.
 *
 * A pass on code older than the stored version does nothing. A pass starts the rollup over (see
 * {@link resetRollup}) on newer code, when either end of the coverage is missing, or after a
 * maintenance gap.
 */
export async function runActivityRollupPass(
  options: ActivityRollupPassOptions
): Promise<ActivityRollupPassResult> {
  const now = options.now ?? (() => new Date())
  const lateEndMarginMs = options.lateEndMarginMs ?? LATE_END_SCAN_MARGIN_MS
  const deadline = Date.now() + options.budgetMs
  const result: ActivityRollupPassResult = {
    status: 'ran',
    reset: null,
    blockedHours: 0,
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

    const settledThrough = new Date(floorHour(now()).getTime() - ACTIVITY_ROLLUP_SETTLE_MS)
    result.reset = resetReason(state)
    if (!result.reset) {
      /**
       * A pass at this version that got past its reset decision is maintaining the rollup: marks
       * written from now on will be consumed by it or the next. A step failing later loses no mark
       * (marks persist until a recompute removes them), so the heartbeat does not wait on the
       * steps, and a failure is counted and logged instead of forcing rebuilds every gap. The
       * heartbeat is renewed only if it has not expired by the database's clock, which writers
       * mark by; an expired one means marks may have been skipped, so the rollup is rebuilt.
       */
      const refreshed = await refreshHeartbeat(owner)
      if (refreshed) state = refreshed
      else result.reset = 'maintenance-gap'
    }
    if (result.reset) {
      if (state.coverageStart || result.reset !== 'coverage') {
        logger.warn('Activity rollup starting over', { reason: result.reset })
      }
      state = await resetRollup(owner)
      while (await truncateRollupBatch()) {
        if (Date.now() >= deadline) return { ...result, status: 'truncating' }
      }
      state = await startCoverage(owner, settledThrough, lateEndMarginMs)
    }

    result.lateEndMarks = await captureLateEnds(deadline, {
      batchRows: options.lateEndBatchRows,
      marginMs: lateEndMarginMs,
    })
    result.replicaLagSeconds = await waitForReplica(owner)
    const replicaCurrent = result.replicaLagSeconds !== null
    if (replicaCurrent) {
      state = await finalizeSettledHours(owner, state, settledThrough, deadline, result)
    } else {
      logger.warn('Activity rollup skipped replica reads for lag', {
        maxLagMs: MAX_REPLICA_LAG_MS,
      })
    }
    const marks = await processDirtyMarks(state, deadline)
    const inflight = await recheckInflightCells(deadline)
    result.dirtyRecomputed = marks.processed
    result.inflightRechecked = inflight.rechecked
    /** Only a pass that got through every due item of both queues vouches for the cells. */
    if (marks.finished && inflight.finished) {
      state = await updateLeasedState(owner, { correctionsAt: sql`now()` })
    }
    if (replicaCurrent) state = await backfill(owner, state, options, deadline, result)

    const housekeepingDue =
      !state.housekeepingAt ||
      Date.now() - state.housekeepingAt.getTime() >= HOUSEKEEPING_INTERVAL_MS
    const housekeeping = housekeepingDue && Date.now() < deadline
    if (housekeeping) await runHousekeeping(state, deadline, result)
    state = await updateLeasedState(owner, {
      failedPasses: 0,
      ...(housekeeping ? { housekeepingAt: sql`now()` } : {}),
    })
    const [blocked] = await db
      .select({ count: count() })
      .from(activityRollupBlocked)
      .where(gt(activityRollupBlocked.attempts, 0))
    result.blockedHours = Number(blocked?.count ?? 0)

    result.coverageStart = state.coverageStart?.toISOString() ?? null
    result.freshThrough = state.freshThrough?.toISOString() ?? null
    result.backfillComplete = Boolean(state.backfillCompletedAt)
    logger.info('Activity rollup pass finished', { ...result })
    return result
  } catch (error) {
    await recordFailedPass(owner, error)
    throw error
  } finally {
    await releaseLease(owner)
  }
}

/**
 * Counts a pass that failed after taking the lease and releases the lease in the same update, so a
 * takeover never counts the failure again; logs the run of failures loudly. Matched on the owner
 * alone, so a pass that overran its lease is still counted; one whose lease another pass took over
 * was already counted by that takeover, and matches nothing.
 */
async function recordFailedPass(owner: string, error: unknown): Promise<void> {
  try {
    const [state] = await db
      .update(activityRollupState)
      .set({
        failedPasses: sql`${activityRollupState.failedPasses} + 1`,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(activityRollupState.id, WORKFLOW_ROLLUP_ID),
          eq(activityRollupState.leaseOwner, owner)
        )
      )
      .returning({ failedPasses: activityRollupState.failedPasses })
    logger.error('Activity rollup pass failed', {
      consecutiveFailures: state?.failedPasses ?? null,
      error: getErrorMessage(error),
    })
  } catch (countError) {
    logger.error('Activity rollup pass failed and could not be counted', {
      error: getErrorMessage(error),
      countError: getErrorMessage(countError),
    })
  }
}
