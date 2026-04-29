/**
 * Server-side scheduler for "workflow column" auto-execution.
 *
 * When a row is written (insert/update), the service calls `scheduleWorkflowColumnRuns`
 * with the affected rows. The scheduler evaluates each workflow column on each row against
 * an eligibility predicate and, for eligible cells, kicks off the workflow execution.
 *
 * Idempotency lives entirely in the eligibility check — there is no write-path bypass.
 * Both the "mark running" write and the final "mark completed/error" write go through the
 * normal row update service, so the scheduler re-runs after each write. This is what makes
 * cascading workflow columns work: when column B's callback writes its result, the scheduler
 * wakes up, sees B is `completed`, and considers downstream column C whose dependencies may
 * have just become filled.
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { TABLE_LIMITS } from '@/lib/table/constants'
import type {
  ColumnDefinition,
  RowData,
  TableDefinition,
  TableRow,
  WorkflowCellValue,
} from '@/lib/table/types'

const logger = createLogger('WorkflowColumnScheduler')

export { pluckByPath } from './pluck'

/**
 * Returns true when every dependency this workflow column needs is filled.
 * Plain columns are filled when their value is non-empty; upstream workflow
 * columns are filled when their cell status is `completed`. Used both by the
 * scheduler's eligibility check and by the manual "Run column" route, which
 * needs the same gate WITHOUT the in-flight / terminal-state check.
 */
export function areWorkflowColumnDepsSatisfied(
  column: ColumnDefinition,
  columnIndex: number,
  row: TableRow,
  schema: { columns: ColumnDefinition[] }
): boolean {
  if (column.type !== 'workflow') return false
  if (!column.workflowConfig?.workflowId) return false

  const isFilled = (colToCheck: ColumnDefinition, value: unknown): boolean => {
    if (colToCheck.type === 'workflow') {
      const cellVal = value as WorkflowCellValue | null | undefined
      return cellVal?.status === 'completed'
    }
    return value !== null && value !== undefined && value !== ''
  }

  const explicitDeps = column.workflowConfig?.dependencies
  if (explicitDeps && explicitDeps.length > 0) {
    for (const depName of explicitDeps) {
      const depCol = schema.columns.find((c) => c.name === depName)
      if (!depCol) {
        throw new Error(`Workflow column "${column.name}" has unknown dependency "${depName}"`)
      }
      if (!isFilled(depCol, row.data[depName])) return false
    }
    return true
  }

  for (let i = 0; i < columnIndex; i++) {
    const leftCol = schema.columns[i]
    if (!isFilled(leftCol, row.data[leftCol.name])) return false
  }

  return true
}

/**
 * Per-cell eligibility: returns true if the workflow should run for this row × column now.
 *
 * Pluggable: future conditional rules (specific-column watches, expression-based gates,
 * "any of N" dependencies) go here without restructuring callers.
 */
export function isWorkflowColumnEligible(
  column: ColumnDefinition,
  columnIndex: number,
  row: TableRow,
  schema: { columns: ColumnDefinition[] }
): boolean {
  const cell = row.data[column.name] as WorkflowCellValue | null | undefined
  const status = cell?.status
  // `cancelled` must skip too — `cancelWorkflowColumnRuns` writes the cancelled
  // state via `updateRow`, which fires the scheduler again. Without this guard,
  // the scheduler would immediately re-run the column the user just stopped.
  if (
    status === 'running' ||
    status === 'completed' ||
    status === 'error' ||
    status === 'cancelled'
  ) {
    return false
  }

  return areWorkflowColumnDepsSatisfied(column, columnIndex, row, schema)
}

/**
 * Scheduler. Iterates workflow columns × rows and kicks off eligible cell jobs.
 * Safe to call after any row-write operation; errors are logged.
 *
 * Concurrency is enforced at the trigger.dev queue layer (see
 * `apps/sim/background/workflow-column-execution.ts` — `concurrencyLimit: 10`
 * combined with `concurrencyKey: tableId`), so this function just enqueues
 * everything eligible and returns.
 *
 * Actor identity for the downstream workflow is derived from the workflow
 * record itself (same convention as webhook/polling-fired triggers), so the
 * service call site doesn't need to provide a user id.
 *
 * @param table - The table definition with schema.
 * @param rows - Rows that were just written (post-commit state).
 */
export async function scheduleWorkflowColumnRuns(
  table: TableDefinition,
  rows: TableRow[]
): Promise<void> {
  try {
    const workflowColumns = table.schema.columns
      .map((col, idx) => ({ col, idx }))
      .filter(({ col }) => col.type === 'workflow' && col.workflowConfig?.workflowId)

    if (workflowColumns.length === 0) return
    if (rows.length === 0) return

    // Preserve position order so enqueues fire in the order the user sees them.
    const orderedRows = rows.length <= 1 ? rows : [...rows].sort((a, b) => a.position - b.position)

    const pendingRuns: RunWorkflowColumnOptions[] = []

    for (const row of orderedRows) {
      for (const { col, idx } of workflowColumns) {
        let eligible = false
        try {
          eligible = isWorkflowColumnEligible(col, idx, row, table.schema)
        } catch (predicateErr) {
          const message =
            predicateErr instanceof Error ? predicateErr.message : String(predicateErr)
          logger.error(
            `Eligibility predicate threw for table=${table.id} row=${row.id} col=${col.name}: ${message}`
          )
          void markCellError(table.id, row.id, col.name, col.workflowConfig!.workflowId, message)
          continue
        }
        if (!eligible) continue

        pendingRuns.push({
          tableId: table.id,
          tableName: table.name,
          rowId: row.id,
          columnName: col.name,
          workflowId: col.workflowConfig!.workflowId,
          workspaceId: table.workspaceId,
          executionId: generateId(),
        })
      }
    }

    if (pendingRuns.length === 0) return

    logger.info(
      `Scheduling ${pendingRuns.length} workflow column run(s) for table=${table.id}`
    )

    await Promise.allSettled(pendingRuns.map((opts) => runWorkflowColumn(opts)))
  } catch (err) {
    logger.error('scheduleWorkflowColumnRuns failed:', err)
  }
}

/**
 * Write a config-error cell directly via the service layer. Used when the eligibility
 * predicate throws (e.g. dependency refers to a nonexistent column).
 */
async function markCellError(
  tableId: string,
  rowId: string,
  columnName: string,
  workflowId: string,
  message: string
): Promise<void> {
  try {
    const { getTableById, getRowById, updateRow } = await import('@/lib/table/service')
    const table = await getTableById(tableId)
    if (!table) return
    const row = await getRowById(tableId, rowId, table.workspaceId)
    if (!row) return
    const errorCell: WorkflowCellValue = {
      executionId: null,
      workflowId,
      status: 'error',
      output: null,
      error: message,
    }
    await updateRow(
      {
        tableId,
        rowId,
        data: { ...row.data, [columnName]: errorCell as unknown as RowData[string] },
        workspaceId: table.workspaceId,
      },
      table,
      `wfcol-config-error-${rowId}-${columnName}`
    )
  } catch (err) {
    logger.error('markCellError failed:', err)
  }
}

interface RunWorkflowColumnOptions {
  tableId: string
  tableName: string
  rowId: string
  columnName: string
  workflowId: string
  workspaceId: string
  executionId: string
}

/**
 * Enqueues a workflow-column run as a `workflow-column-execution` async job
 * (trigger.dev in prod; the DB queue fallback elsewhere). Writes the cell to
 * `running` and persists the returned async-job id on the cell so the cancel
 * API can call `backend.cancelJob(jobId)` from any pod.
 *
 * The actual workflow execution + terminal cell write (completed/error) happens
 * in the background task `apps/sim/background/workflow-column-execution.ts`.
 * Cancellation writes `cancelled` authoritatively from `cancelWorkflowColumnRuns`
 * — see that function for why.
 */
export async function runWorkflowColumn(opts: RunWorkflowColumnOptions): Promise<void> {
  const { tableId, tableName, rowId, columnName, workflowId, workspaceId, executionId } = opts

  const { getTableById, getRowById, updateRow } = await import('@/lib/table/service')
  const { getJobQueue, shouldExecuteInline } = await import('@/lib/core/async-jobs/config')

  /**
   * Writes the cell unless `cancelWorkflowColumnRuns` already wrote `cancelled`
   * for this run. Without this check, a cancel that lands while the scheduler
   * is mid-enqueue (e.g. between `writeCell({running, no jobId})` and the
   * post-enqueue `writeCell({running, jobId})`) gets clobbered back to running.
   * That manifests as "stop didn't stick".
   */
  const writeCell = async (value: WorkflowCellValue): Promise<'wrote' | 'cancelled'> => {
    const table = await getTableById(tableId)
    if (!table) {
      logger.warn(`Table ${tableId} vanished before cell write`)
      return 'wrote'
    }
    const row = await getRowById(tableId, rowId, workspaceId)
    if (!row) {
      logger.warn(`Row ${rowId} vanished before cell write`)
      return 'wrote'
    }
    const currentCell = row.data[columnName] as WorkflowCellValue | null | undefined
    if (
      currentCell?.status === 'cancelled' &&
      currentCell.executionId === executionId &&
      value.status !== 'cancelled'
    ) {
      logger.info(
        `Skipping cell write — cancelled (table=${tableId} row=${rowId} col=${columnName} executionId=${executionId})`
      )
      return 'cancelled'
    }
    const mergedData: RowData = { ...row.data, [columnName]: value as unknown as RowData[string] }
    await updateRow(
      { tableId, rowId, data: mergedData, workspaceId },
      table,
      `wfcol-${executionId}`
    )
    return 'wrote'
  }

  // 1) Flip the cell to `running` immediately so the UI reflects state regardless
  //    of how long the queue takes to dispatch.
  let writeResult: 'wrote' | 'cancelled' = 'wrote'
  try {
    writeResult = await writeCell({
      executionId,
      jobId: null,
      workflowId,
      status: 'running',
      output: null,
      error: null,
    })
  } catch (err) {
    logger.error(
      `Failed to mark cell running (table=${tableId} row=${rowId} col=${columnName}):`,
      err
    )
    return
  }
  // If cancel landed first, abort the dispatch entirely — no enqueue, no
  // jobId stamp. The cancelled state stays sticky.
  if (writeResult === 'cancelled') return

  // 2) Enqueue and capture the async-job id. The task body fetches workflow +
  //    webhook + row, runs `executeWorkflow`, and writes the terminal state.
  const taskPayload = {
    tableId,
    tableName,
    rowId,
    columnName,
    workflowId,
    workspaceId,
    executionId,
  }
  let jobId: string
  let queue: Awaited<ReturnType<typeof getJobQueue>>
  try {
    queue = await getJobQueue()
    jobId = await queue.enqueue('workflow-column-execution', taskPayload, {
      metadata: {
        workflowId,
        workspaceId,
        correlation: {
          executionId,
          requestId: `wfcol-${executionId}`,
          source: 'workflow',
          workflowId,
          triggerType: 'table',
        },
      },
      // Per-table sub-queue: combined with the task's `queue.concurrencyLimit`
      // this throttles parallelism within a table while letting different
      // tables run independently.
      concurrencyKey: tableId,
      tags: [`tableId:${tableId}`, `rowId:${rowId}`, `column:${columnName}`],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `Failed to enqueue workflow-column-execution (table=${tableId} row=${rowId} col=${columnName}):`,
      err
    )
    await writeCell({
      executionId,
      jobId: null,
      workflowId,
      status: 'error',
      output: null,
      error: message,
    })
    return
  }

  // 3) Stamp the jobId onto the cell so cancel can find it. If cancel landed
  //    between enqueue and now, the writeCell guard will skip the write AND
  //    return 'cancelled' — at which point we abort the trigger.dev job too,
  //    since the cell-task wouldn't have a jobId to read on its own otherwise.
  let stampResult: 'wrote' | 'cancelled' = 'wrote'
  try {
    stampResult = await writeCell({
      executionId,
      jobId,
      workflowId,
      status: 'running',
      output: null,
      error: null,
    })
  } catch (err) {
    logger.error(
      `Failed to persist jobId on cell (table=${tableId} row=${rowId} col=${columnName}):`,
      err
    )
  }
  if (stampResult === 'cancelled') {
    try {
      await queue.cancelJob(jobId)
    } catch (cancelErr) {
      logger.error(
        `Failed to cancel orphaned workflow-column-execution job (jobId=${jobId}):`,
        cancelErr
      )
    }
    return
  }

  // 4) When trigger.dev is disabled the DB queue just records the row — nothing
  //    pulls it. Run the task body inline ourselves, mirroring the pattern in
  //    `app/api/workflows/[id]/execute/route.ts` for `workflow-execution`.
  if (shouldExecuteInline()) {
    const { registerInlineAbort, unregisterInlineAbort } = await import(
      '@/lib/core/async-jobs/inline-abort'
    )
    const abortController = new AbortController()
    registerInlineAbort(jobId, abortController)

    void (async () => {
      try {
        const { executeWorkflowColumnJob } = await import('@/background/workflow-column-execution')
        await queue.startJob(jobId)
        await executeWorkflowColumnJob(taskPayload, abortController.signal)
        await queue.completeJob(jobId, null)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(
          `Inline workflow-column-execution failed (jobId=${jobId} table=${tableId} row=${rowId} col=${columnName}):`,
          err
        )
        try {
          await queue.markJobFailed(jobId, message)
        } catch (markErr) {
          logger.error('Also failed to mark job as failed:', markErr)
        }
      } finally {
        unregisterInlineAbort(jobId)
      }
    })()
  }
}

/**
 * Cancels in-flight workflow-column runs for a table (all rows or a specific row).
 *
 * Scans every workflow cell in scope, calls `backend.cancelJob(jobId)` for each
 * `running` cell with a non-null `jobId`, and authoritatively writes
 * `status: 'cancelled'` to the cell. The cell write is independent of whether
 * the cancel reaches the worker in time — `runs.cancel` may kill the task mid-
 * flight before it can write its own terminal state, so we don't depend on it.
 *
 * Cascade behavior is preserved automatically: downstream columns only fire on
 * `status === 'completed'`, so cancelling upstream halts the chain.
 */
export async function cancelWorkflowColumnRuns(tableId: string, rowId?: string): Promise<number> {
  const { getTableById, updateRow } = await import('@/lib/table/service')
  const { getJobQueue } = await import('@/lib/core/async-jobs/config')

  const table = await getTableById(tableId)
  if (!table) {
    logger.warn(`cancelWorkflowColumnRuns: table ${tableId} not found`)
    return 0
  }

  const workflowColumnNames = table.schema.columns
    .filter((c) => c.type === 'workflow' && c.workflowConfig?.workflowId)
    .map((c) => c.name)
  if (workflowColumnNames.length === 0) return 0

  const rowQuery = rowId
    ? db.select().from(userTableRows).where(eq(userTableRows.id, rowId))
    : db.select().from(userTableRows).where(eq(userTableRows.tableId, tableId))
  const rows = await rowQuery

  const queue = await getJobQueue()
  let cancelled = 0

  for (const row of rows) {
    if (row.tableId !== tableId) continue
    const data = row.data as RowData
    let mutated = false
    const nextData: RowData = { ...data }
    for (const name of workflowColumnNames) {
      const cell = data[name] as WorkflowCellValue | null | undefined
      // Cancel both `running` (in-flight task) and `pending` (post-reset,
      // pre-dispatch) cells. Without the pending case, a stop click landing
      // between the run-column reset and the scheduler picking up the cell
      // would leave it pending → eventually executed.
      if (!cell || (cell.status !== 'running' && cell.status !== 'pending')) continue

      if (cell.jobId) {
        try {
          await queue.cancelJob(cell.jobId)
        } catch (err) {
          logger.error(`Failed to cancel job ${cell.jobId} for ${tableId}/${row.id}/${name}:`, err)
          // Continue — we still want to write the cancelled cell state below.
        }
      }

      const cancelledCell: WorkflowCellValue = {
        executionId: cell.executionId ?? null,
        jobId: null,
        workflowId: cell.workflowId,
        status: 'cancelled',
        output: null,
        error: 'Cancelled',
      }
      nextData[name] = cancelledCell as unknown as RowData[string]
      mutated = true
      cancelled++
    }
    if (mutated) {
      try {
        await updateRow(
          { tableId, rowId: row.id, data: nextData, workspaceId: table.workspaceId },
          table,
          `wfcol-cancel-${row.id}`
        )
      } catch (err) {
        logger.error(`Failed to write cancelled state for row ${row.id}:`, err)
      }
    }
  }

  return cancelled
}
