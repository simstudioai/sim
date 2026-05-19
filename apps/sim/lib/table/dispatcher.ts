import { db } from '@sim/db'
import { tableRunDispatches, userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, eq, gt, inArray, type SQL, sql } from 'drizzle-orm'
import { writeWorkflowGroupState } from '@/lib/table/cell-write'
import { appendTableEvent } from '@/lib/table/events'
import type { TableRow } from '@/lib/table/types'
import {
  buildPendingRuns,
  cellTagsFor,
  type WorkflowGroupCellPayload,
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
    status: 'pending',
    // -1 = "haven't started." First window's filter `position > -1` matches
    // position 0; subsequent iterations advance to `lastPosition` which then
    // correctly excludes already-processed rows.
    cursor: -1,
    isManualRun: input.isManualRun,
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
    isManualRun: row.isManualRun,
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

  // First iteration: just transition pending → dispatching. The bulk clear
  // ran synchronously in `runWorkflowColumn` before this task fired, so the
  // user already saw the column flip to empty/Pending before any cell
  // started enqueueing.
  if (dispatch.status === 'pending') {
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

  // Strip rows the user cancelled mid-cascade (post-dispatch tombstones)
  // before running the shared eligibility filter — `buildPendingRuns`
  // doesn't know about the per-dispatch cancel tombstone.
  const tombstoneFiltered: TableRow[] = []
  for (const r of chunk) {
    const tableRow = toTableRow(r)
    const tombstoned = dispatch.scope.groupIds.some((gid) => {
      const exec = tableRow.executions?.[gid]
      if (!exec?.cancelledAt) return false
      const cancelledAtMs = Date.parse(exec.cancelledAt)
      return Number.isFinite(cancelledAtMs) && cancelledAtMs > dispatch.requestedAt.getTime()
    })
    if (!tombstoned) tombstoneFiltered.push(tableRow)
  }

  const pendingRuns = buildPendingRuns(table, tombstoneFiltered, {
    isManualRun: dispatch.isManualRun,
    groupIds: dispatch.scope.groupIds,
    mode: dispatch.mode,
  })

  // Cursor advances to the last position in this chunk regardless of
  // eligibility — otherwise a window full of skipped cells loops forever.
  const lastPosition = chunk[chunk.length - 1].position

  if (pendingRuns.length > 0) {
    await stampQueuedForBatch(pendingRuns)

    // `batchTriggerAndWait` blocks the parent dispatcher until every cell
    // terminates (success / fail / cancel). Trigger.dev checkpoints the
    // parent during the wait via CRIU, so we don't pay compute. Bounds the
    // queue depth at WINDOW_SIZE per dispatch — no flooding trigger.dev.
    const items = pendingRuns.map((runOpts) => ({
      payload: runOpts,
      options: {
        concurrencyKey: runOpts.tableId,
        tags: cellTagsFor(runOpts),
      },
    }))
    try {
      await tasks.batchTriggerAndWait('workflow-group-cell', items)
    } catch (err) {
      logger.error(`[${dispatchId}] batchTriggerAndWait failed`, {
        error: toError(err).message,
      })
      // Don't bail the dispatch — terminal states are already in the DB
      // (workers wrote them) or will be reconciled on the next user click.
    }
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
