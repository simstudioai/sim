import { db } from '@sim/db'
import { tableRunDispatches, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { appendTableEvent } from '@/lib/table/events'
import type { RowData, TableRow } from '@/lib/table/types'
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

  if (dispatch.status === 'pending') {
    await db
      .update(tableRunDispatches)
      .set({ status: 'dispatching' })
      .where(eq(tableRunDispatches.id, dispatchId))
  }

  const { getTableById, batchUpdateRows } = await import('./service')
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

  type Update = {
    rowId: string
    data: RowData
    executionsPatch: Record<string, null>
  }
  const updates: Update[] = []
  const clearedRows: TableRow[] = []
  for (const r of chunk) {
    const tableRow = toTableRow(r)
    const eligibleGroups = targetGroups.filter((g) => {
      // Skip cells the user explicitly cancelled after this dispatch
      // started — a per-row cancel mid-cascade must stick even under
      // isManualRun, otherwise the dispatcher resurrects the row.
      const exec = tableRow.executions?.[g.id]
      if (exec?.cancelledAt) {
        const cancelledAtMs = Date.parse(exec.cancelledAt)
        if (Number.isFinite(cancelledAtMs) && cancelledAtMs > dispatch.requestedAt.getTime()) {
          return false
        }
      }
      return isGroupEligible(g, tableRow, { isManualRun: true, mode: dispatch.mode })
    })
    if (eligibleGroups.length === 0) continue

    const clearedData: RowData = {}
    const executionsPatch: Record<string, null> = {}
    for (const g of eligibleGroups) {
      for (const o of g.outputs) clearedData[o.columnName] = null
      executionsPatch[g.id] = null
    }
    updates.push({ rowId: r.id, data: clearedData, executionsPatch })

    const remainingExec = { ...tableRow.executions }
    for (const g of eligibleGroups) delete remainingExec[g.id]
    clearedRows.push({
      ...tableRow,
      data: { ...tableRow.data, ...clearedData },
      executions: remainingExec,
    })
  }

  // Cursor advances to the last position in this chunk regardless of
  // eligibility — otherwise a window full of completed cells loops forever.
  const lastPosition = chunk[chunk.length - 1].position

  if (updates.length > 0) {
    await batchUpdateRows(
      {
        tableId: dispatch.tableId,
        updates,
        workspaceId: dispatch.workspaceId,
        skipScheduler: true,
      },
      table,
      dispatch.requestId
    )

    const scheduleOpts: ScheduleOpts = {
      isManualRun: true,
      groupIds: dispatch.scope.groupIds,
      mode: dispatch.mode,
    }
    await scheduleRunsForRows(table, clearedRows, scheduleOpts)
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
