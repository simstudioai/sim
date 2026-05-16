import { db } from '@sim/db'
import { tableRunDispatches, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, type SQL, sql } from 'drizzle-orm'
import { appendTableEvent } from '@/lib/table/events'
import type { TableRow } from '@/lib/table/types'
import {
  isGroupEligible,
  scheduleRunsForRows,
  type ScheduleOpts,
  TABLE_CONCURRENCY_LIMIT,
  toTableRow,
} from './workflow-columns'

const logger = createLogger('TableRunDispatcher')

/** Window size matches the cell-execution concurrency cap so one window
 *  saturates the pool before the next is loaded — yields a row-major
 *  scan-line crawl (rows 1-20 finish before 21-40 start). */
const WINDOW_SIZE = TABLE_CONCURRENCY_LIMIT

const ACTIVE_DISPATCH_STATUSES = ['pending', 'dispatching'] as const

export type DispatchStatus = 'pending' | 'dispatching' | 'complete' | 'cancelled'
export type DispatchMode = 'all' | 'incomplete'

export interface DispatchScope {
  groupIds: string[]
  rowIds?: string[]
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

  const outputCols = Array.from(new Set(groups.flatMap((g) => g.outputs.map((o) => o.columnName))))
  const groupIds = groups.map((g) => g.id)

  // Build `data - 'col1' - 'col2' - ...` and `executions - 'gid1' - 'gid2' - ...`.
  let dataExpr: SQL = sql`coalesce(${userTableRows.data}, '{}'::jsonb)`
  for (const col of outputCols) dataExpr = sql`(${dataExpr}) - ${col}::text`
  let execExpr: SQL = sql`coalesce(${userTableRows.executions}, '{}'::jsonb)`
  for (const gid of groupIds) execExpr = sql`(${execExpr}) - ${gid}::text`

  const filters: SQL[] = [eq(userTableRows.tableId, tableId)]
  if (rowIds && rowIds.length > 0) {
    filters.push(inArray(userTableRows.id, rowIds))
  }
  if (mode === 'incomplete') {
    // Skip rows where all output columns across all targeted groups already
    // have a non-empty value — those are "completed-and-filled" and the
    // eligibility predicate would skip them anyway.
    const filledChecks = outputCols.map(
      (col) => sql`coalesce(${userTableRows.data} ->> ${col}, '') != ''`
    )
    const allFilled = filledChecks.reduce((acc, expr) => sql`${acc} AND ${expr}`)
    filters.push(sql`NOT (${allFilled})`)
    // Also skip rows where ANY targeted group has an in-flight exec from
    // another dispatch — clobbering its `executions[gid]` would race with
    // the in-flight worker. An `incomplete` run by definition shouldn't
    // touch rows another dispatch is actively working on.
    const inFlightChecks = groupIds.map(
      (gid) =>
        sql`${userTableRows.executions} -> ${gid}::text ->> 'status' IN ('queued', 'running', 'pending')`
    )
    const anyInFlight = inFlightChecks.reduce((acc, expr) => sql`${acc} OR ${expr}`)
    filters.push(sql`NOT (${anyInFlight})`)
  }

  await db
    .update(userTableRows)
    .set({ data: dataExpr, executions: execExpr, updatedAt: new Date() })
    .where(and(...filters))
}

export async function insertDispatch(input: {
  tableId: string
  workspaceId: string
  requestId: string
  mode: DispatchMode
  scope: DispatchScope
}): Promise<string> {
  const id = `tdsp_${generateId().replace(/-/g, '')}`
  await db.insert(tableRunDispatches).values({
    id,
    tableId: input.tableId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
    mode: input.mode,
    scope: input.scope,
    status: 'pending',
    cursor: 0,
  })
  return id
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
    requestedAt: row.requestedAt,
  }
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

  // First iteration: wipe every targeted cell across the whole table so the
  // user sees the column flip to empty/Pending immediately. The cancel
  // tombstone is preserved because the clear runs before any per-row cancels
  // could have landed (cancel routes write cells after dispatch insertion).
  if (dispatch.status === 'pending') {
    await bulkClearWorkflowGroupCells({
      tableId: dispatch.tableId,
      groups: targetGroups.map((g) => ({ id: g.id, outputs: g.outputs })),
      rowIds: dispatch.scope.rowIds,
      mode: dispatch.mode,
    })
    await db
      .update(tableRunDispatches)
      .set({ status: 'dispatching' })
      .where(eq(tableRunDispatches.id, dispatchId))
  }

  const filters = [
    eq(userTableRows.tableId, dispatch.tableId),
    gt(userTableRows.position, dispatch.cursor),
  ]
  if (dispatch.scope.rowIds && dispatch.scope.rowIds.length > 0) {
    filters.push(inArray(userTableRows.id, dispatch.scope.rowIds))
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
    })
    return 'done'
  }

  // Rows were bulk-cleared at click time, so the chunk is ready to enqueue
  // as-is. We only filter out cells the user cancelled mid-cascade (the
  // tombstone) and cells whose deps still aren't satisfied.
  const eligibleRows: TableRow[] = []
  for (const r of chunk) {
    const tableRow = toTableRow(r)
    const anyEligible = targetGroups.some((g) => {
      const exec = tableRow.executions?.[g.id]
      if (exec?.cancelledAt) {
        const cancelledAtMs = Date.parse(exec.cancelledAt)
        if (Number.isFinite(cancelledAtMs) && cancelledAtMs > dispatch.requestedAt.getTime()) {
          return false
        }
      }
      return isGroupEligible(g, tableRow, { isManualRun: true, mode: dispatch.mode })
    })
    if (anyEligible) eligibleRows.push(tableRow)
  }

  // Cursor advances to the last position in this chunk regardless of
  // eligibility — otherwise a window full of skipped cells loops forever.
  const lastPosition = chunk[chunk.length - 1].position

  if (eligibleRows.length > 0) {
    const scheduleOpts: ScheduleOpts = {
      isManualRun: true,
      groupIds: dispatch.scope.groupIds,
      mode: dispatch.mode,
    }
    await scheduleRunsForRows(table, eligibleRows, scheduleOpts)
  }

  await Promise.all([
    advanceCursor(dispatchId, lastPosition),
    appendTableEvent({
      kind: 'dispatch',
      tableId: dispatch.tableId,
      dispatchId,
      status: 'dispatching',
    }),
  ])

  return 'continue'
}

async function advanceCursor(dispatchId: string, newCursor: number): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ cursor: newCursor })
    .where(eq(tableRunDispatches.id, dispatchId))
}

async function markDispatchComplete(dispatchId: string): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ status: 'complete', completedAt: new Date() })
    .where(eq(tableRunDispatches.id, dispatchId))
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
 *  UPDATE so the dispatcher's next iteration observes the cancel. */
export async function markActiveDispatchesCancelled(tableId: string): Promise<void> {
  await db
    .update(tableRunDispatches)
    .set({ status: 'cancelled', cancelledAt: new Date() })
    .where(
      and(
        eq(tableRunDispatches.tableId, tableId),
        inArray(tableRunDispatches.status, [...ACTIVE_DISPATCH_STATUSES])
      )
    )
}
