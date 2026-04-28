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

/**
 * Walk a dot-and-bracket path into a value (e.g. `a.b[0].c` or `result.items.0`).
 * Returns undefined for any missing segment. Used by workflow columns that specify
 * an `outputPath` to pick one field out of a workflow's full output.
 */
function pluckByPath(source: unknown, path: string): unknown {
  if (source === null || source === undefined || !path) return source
  const segments = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cursor: unknown = source
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
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
  if (column.type !== 'workflow') return false
  if (!column.workflowConfig?.workflowId) return false

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

  const isFilled = (colToCheck: ColumnDefinition, value: unknown): boolean => {
    if (colToCheck.type === 'workflow') {
      const cellVal = value as WorkflowCellValue | null | undefined
      return cellVal?.status === 'completed'
    }
    return value !== null && value !== undefined && value !== ''
  }

  const explicitDeps = column.workflowConfig?.dependencies
  if (explicitDeps && explicitDeps.length > 0) {
    // Explicit dependency list: check only the named columns. Fail fast on unknown
    // names — malformed config is a bug, not a silent skip.
    for (const depName of explicitDeps) {
      const depCol = schema.columns.find((c) => c.name === depName)
      if (!depCol) {
        throw new Error(`Workflow column "${column.name}" has unknown dependency "${depName}"`)
      }
      if (!isFilled(depCol, row.data[depName])) return false
    }
    return true
  }

  // Default predicate: every column to the left must be filled. Plain columns need a
  // non-null/non-empty value; upstream workflow columns need status === 'completed'
  // (this is what makes cascading work).
  for (let i = 0; i < columnIndex; i++) {
    const leftCol = schema.columns[i]
    if (!isFilled(leftCol, row.data[leftCol.name])) return false
  }

  return true
}

/** Upper bound on workflow-column run concurrency exposed to the user. */
const WORKFLOW_COLUMN_BATCH_SIZE_MAX = 100

interface ScheduleWorkflowColumnRunsOptions {
  /**
   * Maximum number of workflow-column runs to execute concurrently. When unset, the
   * per-table value at `table.metadata.workflowColumnBatchSize` is used, falling back
   * to `TABLE_LIMITS.WORKFLOW_COLUMN_BATCH_SIZE`. Clamped to 1..100.
   */
  batchSize?: number
}

/**
 * Scheduler. Iterates workflow columns × rows and kicks off eligible executions in
 * bounded-concurrency batches. Safe to call after any row-write operation; errors are
 * logged. Callers typically invoke this with `void` — the function awaits internally to
 * limit concurrency, but resolves once all scheduled runs complete.
 *
 * Actor identity for the downstream workflow is derived from the workflow record itself
 * (same convention as webhook/polling-fired triggers), so the service call site doesn't
 * need to provide a user id.
 *
 * @param table - The table definition with schema.
 * @param rows - Rows that were just written (post-commit state).
 * @param options - Optional batching/concurrency controls.
 */
export async function scheduleWorkflowColumnRuns(
  table: TableDefinition,
  rows: TableRow[],
  options?: ScheduleWorkflowColumnRunsOptions
): Promise<void> {
  try {
    const workflowColumns = table.schema.columns
      .map((col, idx) => ({ col, idx }))
      .filter(({ col }) => col.type === 'workflow' && col.workflowConfig?.workflowId)

    if (workflowColumns.length === 0) return
    if (rows.length === 0) return

    const requestedBatchSize =
      options?.batchSize ??
      table.metadata?.workflowColumnBatchSize ??
      TABLE_LIMITS.WORKFLOW_COLUMN_BATCH_SIZE
    const batchSize = Math.min(
      WORKFLOW_COLUMN_BATCH_SIZE_MAX,
      Math.max(1, Math.floor(requestedBatchSize))
    )

    // Preserve position order so batches fire in the order the user sees them in the UI.
    // Skip the sort on single-row calls (the common row-write path).
    const orderedRows = rows.length <= 1 ? rows : [...rows].sort((a, b) => a.position - b.position)

    const pendingRuns: RunWorkflowColumnOptions[] = []

    for (const row of orderedRows) {
      for (const { col, idx } of workflowColumns) {
        let eligible = false
        try {
          eligible = isWorkflowColumnEligible(col, idx, row, table.schema)
        } catch (predicateErr) {
          // Malformed dependency config — surface it on the specific cell so the user
          // can see why their column is stuck, then move on to the next row/column.
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
      `Scheduling ${pendingRuns.length} workflow column run(s) for table=${table.id} in batches of ${batchSize}`
    )

    for (let i = 0; i < pendingRuns.length; i += batchSize) {
      const batch = pendingRuns.slice(i, i + batchSize)
      await Promise.allSettled(batch.map((opts) => runWorkflowColumn(opts)))
    }
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

  const writeCell = async (value: WorkflowCellValue) => {
    const table = await getTableById(tableId)
    if (!table) {
      logger.warn(`Table ${tableId} vanished before cell write`)
      return
    }
    const row = await getRowById(tableId, rowId, workspaceId)
    if (!row) {
      logger.warn(`Row ${rowId} vanished before cell write`)
      return
    }
    const mergedData: RowData = { ...row.data, [columnName]: value as unknown as RowData[string] }
    await updateRow(
      { tableId, rowId, data: mergedData, workspaceId },
      table,
      `wfcol-${executionId}`
    )
  }

  // 1) Flip the cell to `running` immediately so the UI reflects state regardless
  //    of how long the queue takes to dispatch.
  try {
    await writeCell({
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

  // 3) Stamp the jobId onto the cell so cancel can find it.
  try {
    await writeCell({
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
    // Don't fail the run — the task will still complete; cancel just won't be able
    // to abort this specific cell until the task writes the terminal state.
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
      if (!cell || cell.status !== 'running') continue

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
