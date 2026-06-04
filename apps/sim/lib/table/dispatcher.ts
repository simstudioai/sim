import { db } from '@sim/db'
import { tableRowExecutions, tableRunDispatches, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, isNotNull, ne, or, type SQL, sql } from 'drizzle-orm'
import { getJobQueue } from '@/lib/core/async-jobs/config'
import { writeWorkflowGroupState } from '@/lib/table/cell-write'
import { isExecCancelledAfter } from '@/lib/table/deps'
import { appendTableEvent } from '@/lib/table/events'
import type { RowExecutionMetadata, RowExecutions, TableRow } from '@/lib/table/types'
import {
  buildEnqueueItems,
  buildPendingRuns,
  TABLE_CONCURRENCY_LIMIT,
  toTableRow,
  type WorkflowGroupCellPayload,
} from './workflow-columns'

const logger = createLogger('TableRunDispatcher')

/** Window size matches the cell-execution concurrency cap so one window
 *  saturates the pool before the next is loaded — yields a row-major
 *  scan-line crawl (rows 1-20 finish before 21-40 start). */
const WINDOW_SIZE = TABLE_CONCURRENCY_LIMIT

const ACTIVE_DISPATCH_STATUSES = ['pending', 'dispatching'] as const

export type DispatchStatus = 'pending' | 'dispatching' | 'complete' | 'cancelled'
export type DispatchMode = 'all' | 'incomplete' | 'new'

export interface DispatchScope {
  groupIds: string[]
  rowIds?: string[]
}

/**
 * Optional cap on how much work a dispatch does before it completes. The
 * discriminated `type` keeps it extensible: only `'rows'` exists today, but a
 * future `'cells'` / `'cost'` / `'duration'` cap can be added by extending the
 * union and teaching `dispatcherStep` how to count that unit — no schema or
 * plumbing change. `max` is the hard ceiling in units of `type`.
 */
export interface DispatchLimit {
  type: 'rows'
  max: number
}

export interface DispatchRow {
  id: string
  tableId: string
  workspaceId: string
  requestId: string
  mode: DispatchMode
  scope: DispatchScope
  status: DispatchStatus
  cursor: number
  /** Cap on work before completion; null = unbounded. */
  limit: DispatchLimit | null
  /** Units of `limit.type` already consumed (eligible rows dispatched). */
  processedCount: number
  isManualRun: boolean
  requestedAt: Date
}

export type DispatcherStepResult = 'continue' | 'done'

/** Eager bulk clear at click time so the user sees every targeted cell go
 *  blank/Pending instantly — without it, only the rows the dispatcher has
 *  reached visibly change, and the rest sit on stale data until the cursor
 *  walks to them. For `mode: 'incomplete'` we skip rows whose outputs are
 *  already filled, mirroring the eligibility predicate. */
export async function bulkClearWorkflowGroupCells(input: {
  tableId: string
  groups: Array<{ id: string; outputs: Array<{ columnName: string }> }>
  rowIds?: string[]
  mode: DispatchMode
}): Promise<void> {
  const { tableId, groups, rowIds, mode } = input
  if (groups.length === 0) return
  // `'new'` mode targets only rows with no prior attempt — nothing to clear.
  // Pre-existing outputs on any other row must not be wiped by an auto-fire.
  if (mode === 'new') return

  const groupIds = groups.map((g) => g.id)
  const rowScope = rowIds && rowIds.length > 0 ? rowIds : null

  if (mode === 'all') {
    // Run-all re-runs every targeted group: wipe all their output columns +
    // executions for the rows in scope. (Prior in-flight runs were already
    // cancelled by the caller.)
    const outputCols = Array.from(
      new Set(groups.flatMap((g) => g.outputs.map((o) => o.columnName)))
    )
    let dataExpr: SQL = sql`coalesce(${userTableRows.data}, '{}'::jsonb)`
    for (const col of outputCols) dataExpr = sql`(${dataExpr}) - ${col}::text`
    const filters: SQL[] = [eq(userTableRows.tableId, tableId)]
    if (rowScope) filters.push(inArray(userTableRows.id, rowScope))

    await db.transaction(async (trx) => {
      await trx
        .update(userTableRows)
        .set({ data: dataExpr, updatedAt: new Date() })
        .where(and(...filters))
      const execFilters: SQL[] = [
        eq(tableRowExecutions.tableId, tableId),
        inArray(tableRowExecutions.groupId, groupIds),
      ]
      if (rowScope) execFilters.push(inArray(tableRowExecutions.rowId, rowScope))
      await trx.delete(tableRowExecutions).where(and(...execFilters))
    })
    return
  }

  // `incomplete`: clear per-group, not per-row. Only groups that are
  // re-runnable (`error` / `cancelled`) get their output columns + exec wiped;
  // `completed` and in-flight groups are left fully intact. A row-level "all
  // filled" check would otherwise wipe a completed group's data + exec just
  // because a *sibling* group on the same row is incomplete, re-running the
  // completed one. (`never-run` groups have no exec/output to clear — the
  // dispatcher runs them via eligibility.)
  await db.transaction(async (trx) => {
    for (const group of groups) {
      const reRunnable = sql`EXISTS (
        SELECT 1 FROM ${tableRowExecutions} re
        WHERE re.row_id = ${userTableRows.id}
          AND re.group_id = ${group.id}
          AND re.status IN ('error', 'cancelled')
      )`
      const filters: SQL[] = [eq(userTableRows.tableId, tableId), reRunnable]
      if (rowScope) filters.push(inArray(userTableRows.id, rowScope))

      let dataExpr: SQL = sql`coalesce(${userTableRows.data}, '{}'::jsonb)`
      for (const out of group.outputs) dataExpr = sql`(${dataExpr}) - ${out.columnName}::text`
      await trx
        .update(userTableRows)
        .set({ data: dataExpr, updatedAt: new Date() })
        .where(and(...filters))

      const execFilters: SQL[] = [
        eq(tableRowExecutions.tableId, tableId),
        eq(tableRowExecutions.groupId, group.id),
        sql`${tableRowExecutions.status} IN ('error', 'cancelled')`,
      ]
      if (rowScope) execFilters.push(inArray(tableRowExecutions.rowId, rowScope))
      await trx.delete(tableRowExecutions).where(and(...execFilters))
    }
  })
}

export async function insertDispatch(input: {
  tableId: string
  workspaceId: string
  requestId: string
  mode: DispatchMode
  scope: DispatchScope
  limit?: DispatchLimit | null
  isManualRun: boolean
}): Promise<string> {
  const id = `tdsp_${generateId().replace(/-/g, '')}`
  await db.insert(tableRunDispatches).values({
    id,
    tableId: input.tableId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
    mode: input.mode,
    scope: input.scope,
    limit: input.limit ?? null,
    status: 'pending',
    // -1 = "haven't started." First window's filter `position > -1` matches
    // position 0; subsequent iterations advance to `lastPosition` which then
    // correctly excludes already-processed rows.
    cursor: -1,
    isManualRun: input.isManualRun,
  })
  return id
}

/** Read every dispatch on a table whose status is still `pending` or
 *  `dispatching`. Drives the client-side "about to run" overlay: rows in an
 *  active dispatch's scope ahead of its cursor are rendered as queued even
 *  before the dispatcher has reached them, so refresh during a long Run-all
 *  doesn't lose the queued indicators. */
/** Counts in-flight cells (queued / running / pending) across the entire
 *  table — the authoritative source for the "X running" badge and the per-row
 *  gutter Run/Stop button. All three statuses are user-cancellable, so the
 *  gutter must surface Stop whenever any of them are present (else clicking
 *  Play during the queued window would re-run an already-queued cell).
 *
 *  Excludes orphan pre-stamps — `pending` rows with no `executionId` — which
 *  are dead placeholders left when a dispatcher loop wrote the stamp but no
 *  cell-task ever picked it up (lock contention, queue failure, crash). The
 *  cell already shows its prior value and `classifyEligibility` treats these as
 *  claimable, so counting them stuck the "X running" badge above zero forever
 *  even though nothing was running. Same `executionId == null` test used by
 *  {@link classifyEligibility} / {@link pickNextEligibleGroupForRow}.
 *
 *  Hits the `(table_id, status)` partial index on table_row_executions. */
export async function countRunningCells(
  tableId: string,
  opts?: { includeUnclaimedPreStamps?: boolean }
): Promise<{ total: number; byRowId: Record<string, number> }> {
  // `pending` + null-executionId rows are unclaimed pre-stamps. With an active
  // dispatch they're real queued work (include); with none they're abandoned
  // orphans that would pin the badge above zero forever (exclude).
  const excludeOrphanPreStamps = !opts?.includeUnclaimedPreStamps
  const rows = await db
    .select({
      rowId: tableRowExecutions.rowId,
      runningCount: sql<number>`count(*)::int`,
    })
    .from(tableRowExecutions)
    .where(
      and(
        eq(tableRowExecutions.tableId, tableId),
        inArray(tableRowExecutions.status, ['queued', 'running', 'pending']),
        excludeOrphanPreStamps
          ? or(ne(tableRowExecutions.status, 'pending'), isNotNull(tableRowExecutions.executionId))
          : undefined
      )
    )
    .groupBy(tableRowExecutions.rowId)
  let total = 0
  const byRowId: Record<string, number> = {}
  for (const r of rows) {
    if (r.runningCount > 0) {
      byRowId[r.rowId] = r.runningCount
      total += r.runningCount
    }
  }
  return { total, byRowId }
}

/** Authoritative "cells queued or running" count for the table, derived from
 *  active dispatches so it survives reload and matches the live count. For each
 *  active dispatch every row in scope ahead of the cursor still has to run each
 *  targeted group, so remaining work = (rows ahead of cursor) × |groupIds|.
 *  Exact for Run-all; an upper bound for incomplete/new (rows the eligibility
 *  filter later skips are still counted). Falls back to the sidecar in-flight
 *  count when no dispatch is active (orphan stragglers). `byRowId` stays
 *  sidecar-based — the client overlay renders queued rows ahead of the cursor. */
export async function countActiveRunCells(
  tableId: string,
  dispatches?: DispatchRow[]
): Promise<{ total: number; byRowId: Record<string, number> }> {
  const active = dispatches ?? (await listActiveDispatches(tableId))
  if (active.length === 0) return countRunningCells(tableId)

  const countRowsAhead = async (d: DispatchRow): Promise<number> => {
    const groupCount = d.scope.groupIds.length
    if (groupCount === 0) return 0
    const filters = [eq(userTableRows.tableId, tableId), gt(userTableRows.position, d.cursor)]
    if (d.scope.rowIds && d.scope.rowIds.length > 0) {
      filters.push(inArray(userTableRows.id, d.scope.rowIds))
    }
    const [row] = await db
      .select({ rowsAhead: sql<number>`count(*)::int` })
      .from(userTableRows)
      .where(and(...filters))
    let rowsAhead = row?.rowsAhead ?? 0
    // A `rows` cap means at most `max - processed` more rows will run, even if
    // many more sit ahead of the cursor — clamp so the badge doesn't over-count.
    if (d.limit?.type === 'rows') {
      rowsAhead = Math.min(rowsAhead, Math.max(0, d.limit.max - d.processedCount))
    }
    return rowsAhead * groupCount
  }

  // Include pre-stamps so `byRowId` matches the live SSE count (which counts
  // `pending`); otherwise the badge flickers 20→0 on each refetch.
  const [sidecar, perDispatch] = await Promise.all([
    countRunningCells(tableId, { includeUnclaimedPreStamps: true }),
    Promise.all(active.map(countRowsAhead)),
  ])
  const total = perDispatch.reduce((sum, n) => sum + n, 0)
  return { total, byRowId: sidecar.byRowId }
}

export async function listActiveDispatches(tableId: string): Promise<DispatchRow[]> {
  const rows = await db
    .select()
    .from(tableRunDispatches)
    .where(
      and(
        eq(tableRunDispatches.tableId, tableId),
        inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES])
      )
    )
  return rows.map((row) => ({
    id: row.id,
    tableId: row.tableId,
    workspaceId: row.workspaceId,
    requestId: row.requestId,
    mode: row.mode as DispatchMode,
    scope: row.scope as DispatchScope,
    status: row.status as DispatchStatus,
    cursor: row.cursor,
    limit: (row.limit as DispatchLimit | null) ?? null,
    processedCount: row.processedCount,
    isManualRun: row.isManualRun,
    requestedAt: row.requestedAt,
  }))
}

export async function readDispatch(dispatchId: string): Promise<DispatchRow | null> {
  const [row] = await db
    .select()
    .from(tableRunDispatches)
    .where(eq(tableRunDispatches.id, dispatchId))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    tableId: row.tableId,
    workspaceId: row.workspaceId,
    requestId: row.requestId,
    mode: row.mode as DispatchMode,
    scope: row.scope as DispatchScope,
    status: row.status as DispatchStatus,
    cursor: row.cursor,
    limit: (row.limit as DispatchLimit | null) ?? null,
    processedCount: row.processedCount,
    isManualRun: row.isManualRun,
    requestedAt: row.requestedAt,
  }
}

/** Drive `dispatcherStep` to completion. Shared between the trigger.dev task
 *  wrapper (`tableRunDispatcherTask`) and the in-process inline path so both
 *  runtimes use identical loop semantics + error logging. */
export async function runDispatcherToCompletion(dispatchId: string): Promise<void> {
  while ((await dispatcherStep(dispatchId)) === 'continue') {}
}

/** Run one window of the dispatcher state machine. Caller re-invokes (via the
 *  trigger.dev task wrapper) until the returned status is `'done'`. */
export async function dispatcherStep(dispatchId: string): Promise<DispatcherStepResult> {
  const dispatch = await readDispatch(dispatchId)
  if (!dispatch) {
    logger.warn(`[${dispatchId}] dispatch row missing — aborting`)
    return 'done'
  }
  if (dispatch.status === 'cancelled' || dispatch.status === 'complete') return 'done'

  const { getTableById } = await import('./service')
  const table = await getTableById(dispatch.tableId)
  if (!table) {
    logger.warn(`[${dispatchId}] table ${dispatch.tableId} missing — completing dispatch`)
    await markDispatchComplete(dispatchId)
    return 'done'
  }

  const allGroups = table.schema.workflowGroups ?? []
  const targetGroups = allGroups.filter((g) => dispatch.scope.groupIds.includes(g.id))
  if (targetGroups.length === 0) {
    await markDispatchComplete(dispatchId)
    return 'done'
  }

  // First iteration: just transition pending → dispatching. The bulk clear
  // ran synchronously in `runWorkflowColumn` before this task fired, so the
  // user already saw the column flip to empty/Pending before any cell
  // started enqueueing.
  if (dispatch.status === 'pending') {
    await db
      .update(tableRunDispatches)
      .set({ status: 'dispatching' })
      .where(eq(tableRunDispatches.id, dispatchId))
    // Announce the dispatch the moment it starts — before the first window's
    // cells finish. Without this, auto-fired and capped dispatches (no client-
    // side optimistic seed) emit their first `dispatch` event only after window
    // 1 completes, so the "X running" / Stop-all control stays hidden while a
    // long first window runs. The client refetches the run-state count on this.
    await appendTableEvent({
      kind: 'dispatch',
      tableId: dispatch.tableId,
      dispatchId,
      status: 'dispatching',
      scope: dispatch.scope,
      cursor: dispatch.cursor,
      mode: dispatch.mode,
      isManualRun: dispatch.isManualRun,
      ...(dispatch.limit ? { limit: dispatch.limit } : {}),
    })
  }

  const filters = [
    eq(userTableRows.tableId, dispatch.tableId),
    gt(userTableRows.position, dispatch.cursor),
  ]
  if (dispatch.scope.rowIds && dispatch.scope.rowIds.length > 0) {
    filters.push(inArray(userTableRows.id, dispatch.scope.rowIds))
  }
  // `'new'` mode targets only rows whose targeted groups haven't been
  // attempted. Exclude a row only when EVERY targeted group already has a
  // sidecar entry — if any one is missing, the row still has work to do
  // and per-group JS filtering in `classifyEligibility` handles the rest.
  if (dispatch.mode === 'new' && dispatch.scope.groupIds.length > 0) {
    const gids = dispatch.scope.groupIds
    filters.push(
      sql`NOT EXISTS (
        SELECT 1 FROM ${tableRowExecutions} re
        WHERE re.row_id = ${userTableRows.id}
          AND re.group_id = ANY(ARRAY[${sql.join(
            gids.map((gid) => sql`${gid}`),
            sql`, `
          )}]::text[])
        GROUP BY re.row_id
        HAVING count(DISTINCT re.group_id) = ${gids.length}
      )`
    )
  }

  const chunk = await db
    .select()
    .from(userTableRows)
    .where(and(...filters))
    .orderBy(asc(userTableRows.position))
    .limit(WINDOW_SIZE)

  if (chunk.length === 0) {
    await markDispatchComplete(dispatchId)
    await appendTableEvent({
      kind: 'dispatch',
      tableId: dispatch.tableId,
      dispatchId,
      status: 'complete',
      scope: dispatch.scope,
      cursor: dispatch.cursor,
      mode: dispatch.mode,
      isManualRun: dispatch.isManualRun,
    })
    return 'done'
  }

  // Pre-fetch executions for the chunk so per-row eligibility doesn't fan
  // out into one query per row. Returns `Map<rowId, RowExecutions>`.
  const chunkRowIds = chunk.map((r) => r.id)
  const execRows = await db
    .select()
    .from(tableRowExecutions)
    .where(inArray(tableRowExecutions.rowId, chunkRowIds))
  const executionsByRow = new Map<string, RowExecutions>()
  for (const r of execRows) {
    const existing = executionsByRow.get(r.rowId) ?? {}
    const meta: RowExecutionMetadata = {
      status: r.status as RowExecutionMetadata['status'],
      executionId: r.executionId ?? null,
      jobId: r.jobId ?? null,
      workflowId: r.workflowId,
      error: r.error ?? null,
      ...(r.runningBlockIds && r.runningBlockIds.length > 0
        ? { runningBlockIds: r.runningBlockIds }
        : {}),
      ...(r.blockErrors && Object.keys(r.blockErrors as Record<string, string>).length > 0
        ? { blockErrors: r.blockErrors as Record<string, string> }
        : {}),
      ...(r.cancelledAt ? { cancelledAt: r.cancelledAt.toISOString() } : {}),
    }
    existing[r.groupId] = meta
    executionsByRow.set(r.rowId, existing)
  }

  // Strip rows the user cancelled mid-cascade (post-dispatch tombstones)
  // before running the shared eligibility filter — `buildPendingRuns`
  // doesn't know about the per-dispatch cancel tombstone.
  const tombstoneFiltered: TableRow[] = []
  for (const r of chunk) {
    const tableRow = toTableRow(r, executionsByRow.get(r.id) ?? {})
    const tombstoned = dispatch.scope.groupIds.some((gid) =>
      isExecCancelledAfter(tableRow.executions?.[gid], dispatch.requestedAt)
    )
    if (!tombstoned) tombstoneFiltered.push(tableRow)
  }

  const pendingRuns = buildPendingRuns(table, tombstoneFiltered, {
    isManualRun: dispatch.isManualRun,
    groupIds: dispatch.scope.groupIds,
    mode: dispatch.mode,
  }).map((p) => ({ ...p, dispatchId }))

  // Cursor advances to the last position in this chunk regardless of
  // eligibility — otherwise a window full of skipped cells loops forever.
  const lastPosition = chunk[chunk.length - 1].position

  // Apply the dispatch's row cap. With a `rows` limit, only the first
  // `remaining` distinct eligible rows in this window are dispatched and the
  // dispatch completes once the budget is spent. buildPendingRuns emits each
  // row's groups consecutively in ascending position, so collecting distinct
  // rowIds until the budget fills picks the lowest-position rows.
  let windowRuns = pendingRuns
  let dispatchedRows = 0
  let budgetExhausted = false
  if (dispatch.limit?.type === 'rows') {
    const remaining = dispatch.limit.max - dispatch.processedCount
    if (remaining <= 0) {
      await completeDispatch(dispatch, lastPosition)
      return 'done'
    }
    const allowedRowIds = new Set<string>()
    for (const p of pendingRuns) {
      if (allowedRowIds.has(p.rowId)) continue
      if (allowedRowIds.size >= remaining) break
      allowedRowIds.add(p.rowId)
    }
    windowRuns = pendingRuns.filter((p) => allowedRowIds.has(p.rowId))
    dispatchedRows = allowedRowIds.size
    budgetExhausted = dispatch.processedCount + dispatchedRows >= dispatch.limit.max
  }

  if (windowRuns.length > 0) {
    await stampQueuedForBatch(windowRuns)

    // Backend-agnostic batch dispatch: trigger.dev wraps `batchTriggerAndWait`
    // (CRIU-checkpointed wait); database backend calls the cell-task runner
    // directly via Promise.all (skips async_jobs since we're awaiting in-
    // process anyway). Either way the parent dispatcher blocks until every
    // cell in the window terminates — bounds queue depth at WINDOW_SIZE.
    const items = await buildEnqueueItems(windowRuns)
    const queue = await getJobQueue()
    try {
      await queue.batchEnqueueAndWait('workflow-group-cell', items)
    } catch (err) {
      logger.error(`[${dispatchId}] batch dispatch failed`, {
        error: toError(err).message,
      })
      // These rows never actually ran, so they must not consume the row cap —
      // otherwise a transient failure on the only window of a `max: N` run would
      // exhaust the budget and complete the dispatch with zero rows started.
      // The cursor still advances past the window (cells are flipped to a
      // re-runnable `error` below), so later windows fulfill the remaining cap.
      dispatchedRows = 0
      budgetExhausted = false
      // Cursor advances past this window, so flip the un-claimed pre-stamps to
      // terminal `error` (+ SSE) — visible, not stuck pending, re-runnable.
      const failedAt = new Date()
      await Promise.allSettled(
        windowRuns.map(async (p) => {
          const updated = await db
            .update(tableRowExecutions)
            .set({ status: 'error', error: 'Failed to enqueue run', updatedAt: failedAt })
            .where(
              and(
                eq(tableRowExecutions.rowId, p.rowId),
                eq(tableRowExecutions.groupId, p.groupId),
                eq(tableRowExecutions.status, 'pending'),
                sql`${tableRowExecutions.executionId} IS NULL`
              )
            )
            .returning({ rowId: tableRowExecutions.rowId })
          if (updated.length === 0) return
          await appendTableEvent({
            kind: 'cell',
            tableId: dispatch.tableId,
            rowId: p.rowId,
            groupId: p.groupId,
            status: 'error',
            executionId: null,
            jobId: null,
            error: 'Failed to enqueue run',
          })
        })
      )
    }
  }

  if (dispatchedRows > 0) await incrementProcessedCount(dispatchId, dispatchedRows)

  // Budget spent → complete now rather than crawling the rest of the table.
  if (budgetExhausted) {
    await completeDispatch(dispatch, lastPosition)
    return 'done'
  }

  // A cell may have halted the dispatch mid-window (e.g. usage limit calls
  // completeDispatchIfActive). Re-read before emitting the per-window
  // `dispatching` event — otherwise that stale event arrives after the client
  // already dropped the dispatch and re-adds it, flickering "X running" back.
  const current = await readDispatch(dispatchId)
  if (!current || current.status === 'cancelled' || current.status === 'complete') return 'done'

  await Promise.all([
    advanceCursor(dispatchId, lastPosition),
    appendTableEvent({
      kind: 'dispatch',
      tableId: dispatch.tableId,
      dispatchId,
      status: 'dispatching',
      scope: dispatch.scope,
      cursor: lastPosition,
      mode: dispatch.mode,
      isManualRun: dispatch.isManualRun,
      ...(dispatch.limit ? { limit: dispatch.limit } : {}),
    }),
  ])

  return 'continue'
}

/** Bump the processed-row counter so a row cap survives across the
 *  checkpointed waits between windows. */
async function incrementProcessedCount(dispatchId: string, delta: number): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ processedCount: sql`${tableRunDispatches.processedCount} + ${delta}` })
    .where(eq(tableRunDispatches.id, dispatchId))
}

/** Mark a dispatch complete and emit the terminal SSE so the client overlay
 *  clears. Shared by the row-cap exhaustion path. */
async function completeDispatch(dispatch: DispatchRow, cursor: number): Promise<void> {
  await markDispatchComplete(dispatch.id)
  await appendTableEvent({
    kind: 'dispatch',
    tableId: dispatch.tableId,
    dispatchId: dispatch.id,
    status: 'complete',
    scope: dispatch.scope,
    cursor,
    mode: dispatch.mode,
    isManualRun: dispatch.isManualRun,
    ...(dispatch.limit ? { limit: dispatch.limit } : {}),
  })
}

/** Pre-batch stamp: write each targeted cell as `pending` (no executionId)
 *  before firing the batch so the renderer shows the cell as in-flight
 *  immediately. The cell-task overwrites with `running` (and its own
 *  executionId) once it acquires the row's cascade lock — if another
 *  cell-task already holds the lock, this task bails and the pending stamp
 *  is later reconciled by whoever owns the cascade. */
async function stampQueuedForBatch(pendingRuns: WorkflowGroupCellPayload[]): Promise<void> {
  await Promise.allSettled(
    pendingRuns.map((runOpts) =>
      writeWorkflowGroupState(runOpts, {
        executionState: {
          status: 'pending',
          executionId: null,
          jobId: null,
          workflowId: runOpts.workflowId,
          error: null,
        },
      })
    )
  )
}

async function advanceCursor(dispatchId: string, newCursor: number): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ cursor: newCursor })
    .where(eq(tableRunDispatches.id, dispatchId))
}

export async function markDispatchComplete(dispatchId: string): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ status: 'complete', completedAt: new Date() })
    .where(eq(tableRunDispatches.id, dispatchId))
}

/** Complete a dispatch only if it's still active, returning whether THIS call
 *  performed the transition. Lets concurrent cells that all hit a hard stop
 *  (e.g. usage limit) elect a single owner — only the winner emits the
 *  user-facing event, instead of one toast per in-flight cell. */
export async function completeDispatchIfActive(dispatchId: string): Promise<boolean> {
  const transitioned = await db
    .update(tableRunDispatches)
    .set({ status: 'complete', completedAt: new Date() })
    .where(
      and(
        eq(tableRunDispatches.id, dispatchId),
        inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES])
      )
    )
    .returning({ id: tableRunDispatches.id })
  return transitioned.length > 0
}

export async function markDispatchCancelled(dispatchId: string): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(
      and(
        eq(tableRunDispatches.id, dispatchId),
        inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES])
      )
    )
}

/** Mark every active dispatch on this table as cancelled. Single atomic
 *  UPDATE so the dispatcher's next iteration observes the cancel. Returns the
 *  dispatches that were cancelled so the caller can emit per-dispatch SSE
 *  events — without those the client's overlay would hang on "queued" until
 *  the next refresh. */
export async function markActiveDispatchesCancelled(tableId: string): Promise<DispatchRow[]> {
  const cancelled = await db
    .update(tableRunDispatches)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(
      and(
        eq(tableRunDispatches.tableId, tableId),
        inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES])
      )
    )
    .returning()
  const dispatches = cancelled.map((row) => ({
    id: row.id,
    tableId: row.tableId,
    workspaceId: row.workspaceId,
    requestId: row.requestId,
    mode: row.mode as DispatchMode,
    scope: row.scope as DispatchScope,
    status: 'cancelled' as DispatchStatus,
    cursor: row.cursor,
    limit: (row.limit as DispatchLimit | null) ?? null,
    processedCount: row.processedCount,
    isManualRun: row.isManualRun,
    requestedAt: row.requestedAt,
  }))
  await Promise.all(
    dispatches.map((d) =>
      appendTableEvent({
        kind: 'dispatch',
        tableId: d.tableId,
        dispatchId: d.id,
        status: 'cancelled',
        scope: d.scope,
        cursor: d.cursor,
        mode: d.mode,
        isManualRun: d.isManualRun,
      })
    )
  )
  return dispatches
}
