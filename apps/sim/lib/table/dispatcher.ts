import { db } from '@sim/db'
import { tableRowExecutions, tableRunDispatches, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import { getJobQueue } from '@/lib/core/async-jobs/config'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { writeWorkflowGroupState } from '@/lib/table/cell-write'
import { USER_TABLE_ROWS_SQL_NAME } from '@/lib/table/constants'
import { isExecCancelledAfter } from '@/lib/table/deps'
import { appendTableEvent } from '@/lib/table/events'
import { type DbExecutor, type DbTransaction, withSeqscanOff } from '@/lib/table/planner'
import { updateTableRowsWithDerivedSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { buildFilterClause } from '@/lib/table/sql'
import type {
  Filter,
  RowExecutionMetadata,
  RowExecutions,
  TableDefinition,
  TableRow,
} from '@/lib/table/types'
import {
  buildEnqueueItems,
  buildPendingRuns,
  TABLE_CONCURRENCY_LIMIT,
  toTableRow,
  type WorkflowGroupCellPayload,
} from '@/lib/table/workflow-columns'

const logger = createLogger('TableRunDispatcher')

const ACTIVE_DISPATCH_STATUSES = ['pending', 'dispatching'] as const

/** Concurrent terminal-event writes when the stale sweep reclaims a batch. */
const STALE_DISPATCH_EVENT_CONCURRENCY = 10

/**
 * How long past its stale threshold a dispatch may be spared by cell activity
 * before it is reclaimed anyway. Bounds the one masking case the probe cannot
 * resolve — two table-wide dispatches sharing a group — which continuous
 * activity would otherwise hide forever. Far beyond any single window: the
 * Trigger.dev run ceiling is ninety minutes, and a live dispatch heartbeats
 * between windows no matter what its cells are doing.
 */
const DISPATCH_ABSOLUTE_STALE_MS = 24 * 60 * 60 * 1000

export type DispatchStatus = 'pending' | 'dispatching' | 'complete' | 'cancelled'
export type DispatchMode = 'all' | 'incomplete' | 'new'

export interface DispatchScope {
  groupIds: string[]
  rowIds?: string[]
  /** "Select all matching a filter" — run every row matching this filter (mutually exclusive with
   *  `rowIds`). Lets the action-bar Play/Refresh target a filtered view without materializing ids. */
  filter?: Filter
  /** Select-all scope only: deselected rows the walk skips (mirrors the delete job's exclusion set). */
  excludeRowIds?: string[]
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
  /** User who triggered the run (for usage attribution); null for auto-fire. */
  triggeredByUserId: string | null
  /** Person whose permission group gates this run's cells; null when the run
   *  has no acting person. Deliberately not `triggeredByUserId` — see the
   *  column comment on `table_run_dispatches`. */
  capabilityGovernedUserId: string | null
  requestedAt: Date
  /** Set when the dispatch reached `complete`; null while it is still active. */
  completedAt: Date | null
  /** Set when the dispatch was cancelled; null otherwise. */
  cancelledAt: Date | null
}

async function deleteExecutionRows(trx: DbTransaction, filters: SQL[]): Promise<number> {
  const countRows = await trx.execute<{ count: number | string }>(sql`
    WITH deleted AS (
      DELETE FROM ${tableRowExecutions}
      WHERE ${and(...filters)}
      RETURNING 1
    )
    SELECT count(*)::integer AS count FROM deleted
  `)
  const [countRow] = Array.isArray(countRows) ? countRows : []
  if (!countRow) throw new Error('Workflow cell clearing did not return a deleted count')
  const count = Number(countRow.count)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Workflow cell clearing returned an invalid deleted count')
  }
  return count
}

export type DispatcherStepResult = 'continue' | 'done'

/** Eager bulk clear at click time so the user sees every targeted cell go
 *  blank/Pending instantly — without it, only the rows the dispatcher has
 *  reached visibly change, and the rest sit on stale data until the cursor
 *  walks to them. For `mode: 'incomplete'` we skip rows whose outputs are
 *  already filled, mirroring the eligibility predicate. */
export async function bulkClearWorkflowGroupCells(input: {
  tableId: string
  workspaceId: string
  groups: Array<{ id: string; outputs: Array<{ columnName: string }> }>
  rowIds?: string[]
  /** Select-all scope: deselected rows whose outputs must NOT be wiped. */
  excludeRowIds?: string[]
  mode: DispatchMode
}): Promise<boolean> {
  const { tableId, workspaceId, groups, rowIds, excludeRowIds, mode } = input
  if (groups.length === 0) return false
  // `'new'` mode targets only rows with no prior attempt — nothing to clear.
  // Pre-existing outputs on any other row must not be wiped by an auto-fire.
  if (mode === 'new') return false

  const groupIds = groups.map((g) => g.id)
  const rowScope = rowIds && rowIds.length > 0 ? rowIds : null
  const excluded = !rowScope && excludeRowIds && excludeRowIds.length > 0 ? excludeRowIds : null

  if (mode === 'all') {
    // Run-all re-runs every targeted group: wipe all their output columns +
    // executions for the rows in scope. (Prior in-flight runs were already
    // cancelled by the caller.)
    const outputCols = Array.from(
      new Set(groups.flatMap((g) => g.outputs.map((o) => o.columnName)))
    )
    const filters: SQL[] = [
      eq(userTableRows.tableId, tableId),
      eq(userTableRows.workspaceId, workspaceId),
    ]
    if (rowScope) filters.push(inArray(userTableRows.id, rowScope))
    if (excluded) filters.push(notInArray(userTableRows.id, excluded))

    return db.transaction(async (trx) => {
      const rowWhere = and(...filters)!
      const clearedRows = await updateTableRowsWithDerivedSecretProvenance(trx, {
        rowWhere,
        transformation: { mode: 'remove-columns', columnIds: outputCols },
      })
      const execFilters: SQL[] = [
        eq(tableRowExecutions.tableId, tableId),
        inArray(tableRowExecutions.groupId, groupIds),
        sql`${tableRowExecutions.rowId} IN (
          SELECT ${userTableRows.id}
          FROM ${userTableRows}
          WHERE ${userTableRows.tableId} = ${tableId}
            AND ${userTableRows.workspaceId} = ${workspaceId}
        )`,
      ]
      if (rowScope) execFilters.push(inArray(tableRowExecutions.rowId, rowScope))
      if (excluded) execFilters.push(notInArray(tableRowExecutions.rowId, excluded))
      const deletedExecutions = await deleteExecutionRows(trx, execFilters)
      return clearedRows > 0 || deletedExecutions > 0
    })
  }

  // `incomplete`: clear per-group, not per-row. Only groups that are
  // re-runnable (`error` / `cancelled`) get their output columns + exec wiped;
  // `completed` and in-flight groups are left fully intact. A row-level "all
  // filled" check would otherwise wipe a completed group's data + exec just
  // because a *sibling* group on the same row is incomplete, re-running the
  // completed one. (`never-run` groups have no exec/output to clear — the
  // dispatcher runs them via eligibility.)
  return db.transaction(async (trx) => {
    let rowsChanged = false
    for (const group of groups) {
      const reRunnable = sql`EXISTS (
        SELECT 1 FROM ${tableRowExecutions} re
        WHERE re.row_id = ${userTableRows.id}
          AND re.group_id = ${group.id}
          AND re.status IN ('error', 'cancelled')
      )`
      const filters: SQL[] = [
        eq(userTableRows.tableId, tableId),
        eq(userTableRows.workspaceId, workspaceId),
        reRunnable,
      ]
      if (rowScope) filters.push(inArray(userTableRows.id, rowScope))
      if (excluded) filters.push(notInArray(userTableRows.id, excluded))

      const rowWhere = and(...filters)!
      const clearedRows = await updateTableRowsWithDerivedSecretProvenance(trx, {
        rowWhere,
        transformation: {
          mode: 'remove-columns',
          columnIds: group.outputs.map((output) => output.columnName),
        },
      })

      const execFilters: SQL[] = [
        eq(tableRowExecutions.tableId, tableId),
        eq(tableRowExecutions.groupId, group.id),
        sql`${tableRowExecutions.status} IN ('error', 'cancelled')`,
        sql`${tableRowExecutions.rowId} IN (
          SELECT ${userTableRows.id}
          FROM ${userTableRows}
          WHERE ${userTableRows.tableId} = ${tableId}
            AND ${userTableRows.workspaceId} = ${workspaceId}
        )`,
      ]
      if (rowScope) execFilters.push(inArray(tableRowExecutions.rowId, rowScope))
      if (excluded) execFilters.push(notInArray(tableRowExecutions.rowId, excluded))
      const deletedExecutions = await deleteExecutionRows(trx, execFilters)
      rowsChanged ||= clearedRows > 0 || deletedExecutions > 0
    }
    return rowsChanged
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
  triggeredByUserId?: string | null
  /**
   * The person whose permission group gates this run's cells, or `null` when
   * the run has no acting person (workspace key, schedule, auto-fire).
   *
   * Required with an explicit `null` rather than optional: the only way to get
   * this wrong is to not think about it, and an optional field with a fallback
   * let every producer that had not been taught the distinction silently
   * inherit `triggeredByUserId` — an *attribution* that names the workspace
   * billed account when the credential names no human. Making omission a
   * compile error is what stops the next producer from re-introducing that
   * bystander substitution.
   */
  capabilityGovernedUserId: string | null
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
    triggeredByUserId: input.triggeredByUserId ?? null,
    capabilityGovernedUserId: input.capabilityGovernedUserId,
  })
  return id
}

/** Counts in-flight cells (queued / running / pending) per row across the
 *  entire table — the authoritative source for the "X running" badge and the
 *  per-row gutter Run/Stop button. All three statuses are user-cancellable, so
 *  the gutter must surface Stop whenever any of them are present (else clicking
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
): Promise<{ byRowId: Record<string, number>; hasRunning: boolean }> {
  // `pending` + null-executionId rows are unclaimed pre-stamps. With an active
  // dispatch they're real queued work (include); with none they're abandoned
  // orphans that would pin the badge above zero forever (exclude).
  const excludeOrphanPreStamps = !opts?.includeUnclaimedPreStamps
  const rows = await db
    .select({
      rowId: tableRowExecutions.rowId,
      runningCount: sql<number>`count(*)::int`,
      // Cells actually claimed by a worker — drives the header's
      // "Queueing" vs "N running" label table-wide (the client can only see
      // claims on loaded rows; a long run's active window scrolls past them).
      claimedCount: sql<number>`count(*) FILTER (WHERE ${tableRowExecutions.status} = 'running')::int`,
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
  const byRowId: Record<string, number> = {}
  let hasRunning = false
  for (const r of rows) {
    if (r.runningCount > 0) byRowId[r.rowId] = r.runningCount
    if (r.claimedCount > 0) hasRunning = true
  }
  return { byRowId, hasRunning }
}

/** Read every dispatch on a table whose status is still `pending` or
 *  `dispatching`. Drives the client-side "about to run" overlay: rows in an
 *  active dispatch's scope ahead of its cursor are rendered as queued even
 *  before the dispatcher has reached them, so refresh during a long Run-all
 *  doesn't lose the queued indicators. */
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
    triggeredByUserId: row.triggeredByUserId,
    capabilityGovernedUserId: row.capabilityGovernedUserId,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
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
    triggeredByUserId: row.triggeredByUserId,
    capabilityGovernedUserId: row.capabilityGovernedUserId,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
  }
}

/** Drive `dispatcherStep` to completion. Shared between the trigger.dev task
 *  wrapper (`tableRunDispatcherTask`) and the in-process inline path so both
 *  runtimes use identical loop semantics + error logging. `concurrency` is the
 *  invoker's plan-resolved window size (see `resolveTableDispatchConcurrency`),
 *  threaded via the task payload; absent on payloads from before the field
 *  existed → legacy cap. */
export async function runDispatcherToCompletion(
  dispatchId: string,
  concurrency?: number
): Promise<void> {
  while ((await dispatcherStep(dispatchId, concurrency)) === 'continue') {}
}

/** Run one window of the dispatcher state machine. Caller re-invokes (via the
 *  trigger.dev task wrapper) until the returned status is `'done'`. */
export async function dispatcherStep(
  dispatchId: string,
  concurrency?: number
): Promise<DispatcherStepResult> {
  const dispatch = await readDispatch(dispatchId)
  if (!dispatch) {
    logger.warn(`[${dispatchId}] dispatch row missing — aborting`)
    return 'done'
  }
  if (dispatch.status === 'cancelled' || dispatch.status === 'complete') return 'done'

  const { getTableById } = await import('@/lib/table/service')
  const table = await getTableById(dispatch.tableId)
  if (!table) {
    logger.warn(`[${dispatchId}] table ${dispatch.tableId} missing — completing dispatch`)
    await completeDispatchIfActive(dispatchId)
    return 'done'
  }

  const allGroups = table.schema.workflowGroups ?? []
  const targetGroups = allGroups.filter((g) => dispatch.scope.groupIds.includes(g.id))
  if (targetGroups.length === 0) {
    await completeDispatchIfActive(dispatchId)
    return 'done'
  }

  // First iteration: just transition pending → dispatching. The bulk clear
  // ran synchronously in `runWorkflowColumn` before this task fired, so the
  // user already saw the column flip to empty/Pending before any cell
  // started enqueueing.
  if (dispatch.status === 'pending') {
    const claimed = await db
      .update(tableRunDispatches)
      // Opens the heartbeat at the instant a holder takes the dispatch, so the
      // cleanup sweep ages it from that rather than from `requested_at`, which
      // was stamped when the run was merely requested.
      .set({ status: 'dispatching', heartbeatAt: new Date() })
      /**
       * Re-asserts the status this step read two awaits ago. `dispatchId` alone
       * would resurrect a dispatch cancelled in that window — a Stop-all, or now
       * the stale-dispatch sweep — back to `dispatching`, and with a fresh
       * heartbeat the sweep would then wait out another full window before
       * reclaiming what it had already given up on.
       */
      .where(
        and(
          eq(tableRunDispatches.id, dispatchId),
          inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES])
        )
      )
      .returning({ id: tableRunDispatches.id })

    /**
     * Losing that race ends the step. Guarding the write without reading its
     * outcome is the worse half of a fix: the row correctly stays `cancelled`,
     * while this step goes on to announce `dispatching`, stamp cells and enqueue
     * a window for it — and an empty window would then call the unguarded
     * completion path and overwrite `cancelled` with `complete`.
     */
    if (claimed.length === 0) {
      logger.info(`[${dispatchId}] dispatch was cancelled before this step claimed it`)
      return 'done'
    }
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

  // Window size = the invoker's plan-resolved parallelism, so one window
  // saturates the cell pool before the next is loaded — yields a row-major
  // scan-line crawl. Payloads without the field fall back to the legacy cap.
  const windowSize = concurrency ?? TABLE_CONCURRENCY_LIMIT

  const filters = [
    eq(userTableRows.tableId, dispatch.tableId),
    gt(userTableRows.position, dispatch.cursor),
  ]
  let hasJsonbFilter = false
  if (dispatch.scope.rowIds && dispatch.scope.rowIds.length > 0) {
    filters.push(inArray(userTableRows.id, dispatch.scope.rowIds))
  } else if (dispatch.scope.filter) {
    // "Select all under a filter": walk only the matching rows. Same cursor/window mechanism —
    // non-matching rows are simply never selected, like mode eligibility.
    const filterClause = buildFilterClause(
      dispatch.scope.filter,
      USER_TABLE_ROWS_SQL_NAME,
      table.schema.columns
    )
    if (filterClause) {
      filters.push(filterClause)
      hasJsonbFilter = true
    }
  }
  if (!dispatch.scope.rowIds?.length && dispatch.scope.excludeRowIds?.length) {
    filters.push(notInArray(userTableRows.id, dispatch.scope.excludeRowIds))
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

  const windowQuery = (executor: DbExecutor) =>
    executor
      .select()
      .from(userTableRows)
      .where(and(...filters))
      .orderBy(asc(userTableRows.position))
      .limit(windowSize)
  // Filtered scopes carry a jsonb predicate the planner can't estimate — left alone it
  // seq-scans the whole shared relation per window; keep it on the tenant's position index.
  const chunk = hasJsonbFilter
    ? await withSeqscanOff(async (trx) => windowQuery(trx))
    : await windowQuery(db)

  if (chunk.length === 0) {
    // Through the shared, guarded completion like the other two exits: this
    // runs after the claim, so a cancel arriving during the window query would
    // otherwise be overwritten with `complete`.
    await completeDispatch(dispatch, dispatch.cursor)
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
  }).map((p) => ({
    ...p,
    dispatchId,
    triggeredByUserId: dispatch.triggeredByUserId ?? undefined,
    capabilityGovernedUserId: dispatch.capabilityGovernedUserId,
  }))

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
    /**
     * Re-read before committing a window, mirroring the check after one.
     *
     * Several round trips separate the claim from here — the window query, the
     * executions prefetch, the tombstone filter — and a Stop-all or the stale
     * sweep landing in that gap would otherwise have this stamp cells and run an
     * entire window for a dispatch already recorded as cancelled.
     *
     * This narrows the gap to a single statement; it does not close it, and no
     * check can. A cancel arriving after this read still races the enqueue. The
     * cell-level `cancellationGuard` and the `isExecCancelledAfter` tombstone
     * filter are what catch that remainder.
     */
    const beforeWindow = await readDispatch(dispatchId)
    if (
      !beforeWindow ||
      beforeWindow.status === 'cancelled' ||
      beforeWindow.status === 'complete'
    ) {
      return 'done'
    }

    await stampQueuedForBatch(windowRuns, table)

    // Backend-agnostic batch dispatch: trigger.dev wraps `batchTriggerAndWait`
    // (CRIU-checkpointed wait); database backend calls the cell-task runner
    // directly via Promise.all (skips async_jobs since we're awaiting in-
    // process anyway). Either way the parent dispatcher blocks until every
    // cell in the window terminates — bounds queue depth at the window size.
    const items = await buildEnqueueItems(windowRuns, windowSize)
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
    .set({
      processedCount: sql`${tableRunDispatches.processedCount} + ${delta}`,
      heartbeatAt: new Date(),
    })
    .where(eq(tableRunDispatches.id, dispatchId))
}

/** Mark a dispatch complete and emit the terminal SSE so the client overlay
 *  clears. Shared by the row-cap exhaustion path. */
async function completeDispatch(dispatch: DispatchRow, cursor: number): Promise<void> {
  /**
   * Guarded, because both callers run AFTER the window's wait. A Stop-all or the
   * stale sweep landing during that wait leaves the row `cancelled`, and the
   * unguarded write would overwrite it with `complete` and publish a completion
   * event after the cancellation one. The claim guard at the top of the step
   * cannot cover this — the cancel arrives long after the claim.
   */
  if (!(await completeDispatchIfActive(dispatch.id))) return

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
async function stampQueuedForBatch(
  pendingRuns: WorkflowGroupCellPayload[],
  table: TableDefinition
): Promise<void> {
  await Promise.allSettled(
    pendingRuns.map((runOpts) =>
      writeWorkflowGroupState(
        { ...runOpts, table },
        {
          executionState: {
            status: 'pending',
            executionId: null,
            jobId: null,
            workflowId: runOpts.workflowId,
            error: null,
          },
        }
      )
    )
  )
}

async function advanceCursor(dispatchId: string, newCursor: number): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ cursor: newCursor, heartbeatAt: new Date() })
    .where(eq(tableRunDispatches.id, dispatchId))
}

/** Cancel one dispatch by id (if still active) and emit the terminal SSE so
 *  the client overlay clears. Used when `runWorkflowColumn` fails between
 *  inserting its dispatch row and firing the dispatcher — without this the
 *  orphaned `pending` row would pin the "about to run" overlay forever. */
export async function cancelDispatchById(dispatchId: string): Promise<void> {
  const [row] = await db
    .update(tableRunDispatches)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(
      and(
        eq(tableRunDispatches.id, dispatchId),
        inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES])
      )
    )
    .returning()
  if (!row) return
  await appendTableEvent({
    kind: 'dispatch',
    tableId: row.tableId,
    dispatchId: row.id,
    status: 'cancelled',
    scope: row.scope as DispatchScope,
    cursor: row.cursor,
    mode: row.mode as DispatchMode,
    isManualRun: row.isManualRun,
  })
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

/**
 * Whether any cell inside a dispatch's own scope has reported since `since`.
 *
 * Scoped to the dispatch's groups, and to its rows when it names any, because
 * `table_row_executions` carries no dispatch column. Left table-wide, a live
 * dispatch's cells read as evidence that an abandoned dispatch beside it was
 * still working — and auto-fired and row-scoped runs do NOT cancel overlapping
 * dispatches (`cancelPriorRuns` requires `isManualRun`, and the per-row path is
 * a no-op for dispatch cancellation), so sharing a group is ordinary rather than
 * exceptional.
 *
 * Two table-wide dispatches over the same groups can still vouch for each other,
 * since nothing in the row execution says whose work it is. Closing that needs a
 * `dispatch_id` on `table_row_executions`, threaded through every cell-write
 * site. Until then the residue is a delay, not a permanent mask: the live
 * dispatch's cells stop reporting when it finishes.
 *
 * The row bypass uses `IS DISTINCT FROM`, not `<>`: a table-wide dispatch has no
 * `rowIds`, so the extraction is SQL NULL and `jsonb_typeof` returns NULL.
 * `NULL <> 'array'` is UNKNOWN rather than TRUE, so the bypass never fired and no
 * live cell could satisfy the probe — reclaiming exactly the long-running
 * table-wide dispatches the row filter was added to protect.
 *
 * Rides the partial `(table_id, status)` index, which covers exactly these three
 * statuses.
 */
function hasRecentCellActivity(since: Date): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${tableRowExecutions}
    WHERE ${tableRowExecutions.tableId} = ${tableRunDispatches.tableId}
      AND ${tableRowExecutions.groupId} IN (
        SELECT jsonb_array_elements_text(${tableRunDispatches.scope} -> 'groupIds')
      )
      AND (
        jsonb_typeof(${tableRunDispatches.scope} -> 'rowIds') IS DISTINCT FROM 'array'
        OR ${tableRowExecutions.rowId} IN (
          SELECT jsonb_array_elements_text(${tableRunDispatches.scope} -> 'rowIds')
        )
      )
      AND ${tableRowExecutions.status} IN ('queued', 'running', 'pending')
      AND ${tableRowExecutions.updatedAt} >= ${sql.param(since, tableRowExecutions.updatedAt)}
  )`
}

/**
 * Cancels dispatches whose holder died without reaching a terminal state.
 *
 * `table_run_dispatches` had no reaper: the only paths to a terminal status are
 * user- or flow-initiated ({@link cancelDispatchById},
 * {@link completeDispatchIfActive}, {@link markActiveDispatchesCancelled}), so a
 * dispatcher killed mid-loop left its row `dispatching` forever — pinning the
 * client's "X running" overlay and blocking re-runs of that table. Four rows
 * were stranded this way by a single afternoon of OOM kills, and nothing in the
 * product could clear them. The `table_run_dispatches_watchdog_idx` index has
 * existed since the table was created for exactly this sweep, unused.
 *
 * Liveness comes from `heartbeatAt`, which the per-window `advanceCursor` and
 * `incrementProcessedCount` writes stamp, so a slow-but-live dispatch is spared
 * however long it runs. That matters because the in-process path
 * (`isTriggerDevEnabled === false`) has no duration ceiling at all — ageing from
 * `requestedAt` would reclaim live self-hosted work. `COALESCE` keeps rows
 * written before the column existed reclaimable rather than NULL-false forever.
 *
 * Cancelled rather than completed: the dispatch did not finish its scope, and
 * reporting it complete would tell the user work happened that did not. The
 * cursor is left in place, so a re-run resumes rather than replays.
 */
export async function cancelStaleDispatches(
  staleBefore: Date,
  limit: number
): Promise<DispatchRow[]> {
  /**
   * Dead means nothing about the dispatch has moved — neither the loop nor the
   * work it is waiting on.
   *
   * The dispatch's own heartbeat is stamped between windows, not during them,
   * and `batchTriggerAndWait` checkpoints the loop for the whole window, so a
   * long window leaves the heartbeat untouched while the dispatch is plainly
   * alive. A lease needs its heartbeat interval to sit well under its TTL; this
   * one cannot promise that, because the window is bounded by the cells' own
   * timeouts and the in-process path has no ceiling at all.
   *
   * Its cells carry the signal the checkpointed parent cannot: `updatedAt` on
   * every in-flight row execution, written by the cell tasks themselves. Both
   * must be stale before a dispatch is reclaimed, so a slow window is spared for
   * as long as its cells keep reporting, and a genuinely dead run — nothing
   * beating, nothing executing — is still collected. The subquery rides the
   * partial `(table_id, status)` index that already covers exactly these three
   * statuses.
   *
   * Narrowed to the dispatch's own scope — its groups, and its rows when it
   * names any — because `table_row_executions` has no dispatch column. Left
   * table-scoped, a live dispatch's cells read as evidence that an abandoned
   * dispatch beside it was still working, and the abandoned one is never
   * reclaimed: the stuck overlay this sweep exists to clear, made permanent.
   *
   * The row filter is what covers the auto-fired and row-scoped runs, which do
   * NOT cancel overlapping dispatches — `cancelPriorRuns` in `workflow-columns`
   * requires `isManualRun`, and the per-row path is a no-op for dispatch
   * cancellation — so same-group coexistence is ordinary, not exceptional.
   *
   * What remains is two table-wide dispatches over the same groups, where
   * nothing in the row execution distinguishes whose work it is. Closing that
   * needs a `dispatch_id` on `table_row_executions`, threaded through six write
   * sites including the shared cell-write path. Until then the residue is a
   * delay rather than a permanent mask: the live dispatch's cells stop updating
   * when it finishes, and the next sweep after a quiet window reclaims the
   * abandoned row.
   */
  const abandonedBefore = new Date(staleBefore.getTime() - DISPATCH_ABSOLUTE_STALE_MS)
  /** Last proof of life from the loop itself, or when it was requested. */
  const lastBeat = sql`COALESCE(${tableRunDispatches.heartbeatAt}, ${tableRunDispatches.requestedAt})`
  const notBeatingSince = (cutoff: Date) =>
    sql`${lastBeat} < ${sql.param(cutoff, tableRunDispatches.heartbeatAt)}`

  const isStale = () =>
    and(
      inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES]),
      notBeatingSince(staleBefore),
      /**
       * Cell activity spares a dispatch, but only up to a ceiling.
       *
       * The probe cannot tell whose cells it is looking at when two table-wide
       * dispatches share a group — `table_row_executions` has no dispatch
       * column — so an abandoned one is vouched for by its neighbour's work. On
       * a quiet table that is a delay, since the neighbour eventually finishes;
       * on a busy one, continuous auto-fired activity can keep it masked
       * indefinitely.
       *
       * The ceiling bounds it a day past the stale threshold. A live dispatch stamps its heartbeat between
       * windows regardless of what its cells are doing, so only a single window
       * outliving the ceiling would be reclaimed wrongly — and no window lasts a
       * day, on any path. The right fix is a `dispatch_id` on the executions
       * row; this keeps the gap bounded until that lands.
       */
      sql`(NOT ${hasRecentCellActivity(staleBefore)} OR ${notBeatingSince(abandonedBefore)})`
    )

  // Claimed as explicit ids first, then updated by id, so the bound is evaluated
  // exactly once — the pattern every other bulk cleanup in this codebase uses.
  // The update re-asserts staleness, so a dispatch that finished in between is
  // left alone rather than cancelled out from under its own terminal write.
  const claimed = await db
    .select({ id: tableRunDispatches.id })
    .from(tableRunDispatches)
    .where(isStale())
    .limit(limit)
  if (claimed.length === 0) return []

  const cancelled = await db
    .update(tableRunDispatches)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(
      and(
        isStale(),
        inArray(
          tableRunDispatches.id,
          claimed.map(({ id }) => id)
        )
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
    triggeredByUserId: row.triggeredByUserId,
    capabilityGovernedUserId: row.capabilityGovernedUserId,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
  }))

  /**
   * Same terminal event every other cancel path emits — without it the row goes
   * terminal in the database while the client overlay stays stuck, which is the
   * symptom this function exists to clear.
   *
   * Bounded rather than a bare `Promise.all`: the sibling cancel paths fan out
   * over one table's dispatches, while this sweep can carry a whole tick's worth
   * across many tables, and each event is its own write.
   */
  await mapWithConcurrency(dispatches, STALE_DISPATCH_EVENT_CONCURRENCY, (d) =>
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

  return dispatches
}

/** Mark every active dispatch on this table as cancelled. Single atomic
 *  UPDATE so the dispatcher's next iteration observes the cancel. Returns the
 *  dispatches that were cancelled so the caller can emit per-dispatch SSE
 *  events — without those the client's overlay would hang on "queued" until
 *  the next refresh. Pass `scopeFilter` to cancel only dispatches whose scope
 *  is that exact filter (a filtered "select all" Stop must not halt
 *  whole-table or differently-filtered runs). Pass `spareExcludedRowIds`
 *  (select-all-minus-deselections Stop) to spare row-scoped dispatches whose
 *  rows are ALL deselected — that work wasn't in the stopped selection. Pass
 *  `spareDispatchId` when the caller is a manual run cancelling *prior* work:
 *  its own dispatch row is already inserted (so a concurrent Stop-all has
 *  something to cancel) and must not cancel itself. */
export async function markActiveDispatchesCancelled(
  tableId: string,
  opts?: { scopeFilter?: Filter; spareExcludedRowIds?: string[]; spareDispatchId?: string }
): Promise<DispatchRow[]> {
  const { scopeFilter, spareExcludedRowIds, spareDispatchId } = opts ?? {}
  const cancelled = await db
    .update(tableRunDispatches)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(
      and(
        eq(tableRunDispatches.tableId, tableId),
        inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES]),
        spareDispatchId ? ne(tableRunDispatches.id, spareDispatchId) : undefined,
        scopeFilter
          ? sql`${tableRunDispatches.scope}->'filter' = ${JSON.stringify(scopeFilter)}::jsonb`
          : undefined,
        // coalesce(false): table-wide dispatches have no scope.rowIds (NULL <@ x
        // is NULL) and must still cancel.
        spareExcludedRowIds && spareExcludedRowIds.length > 0
          ? sql`NOT coalesce(
              ${tableRunDispatches.scope}->'rowIds' <@ ${JSON.stringify(spareExcludedRowIds)}::jsonb
                AND jsonb_array_length(${tableRunDispatches.scope}->'rowIds') > 0,
              false
            )`
          : undefined
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
    triggeredByUserId: row.triggeredByUserId,
    capabilityGovernedUserId: row.capabilityGovernedUserId,
    requestedAt: row.requestedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
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
