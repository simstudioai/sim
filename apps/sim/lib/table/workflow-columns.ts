/**
 * Server-side scheduler for workflow-column auto-execution. The cascade is
 * driven entirely by the eligibility predicate: each row-write fires the
 * scheduler, which considers any newly-eligible cells (deps just filled,
 * upstream workflow column just `completed`) and enqueues per-cell jobs.
 */

import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { toError } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { buildCancelledCell, writeWorkflowCell } from '@/lib/table/cell-write'
import type {
  ColumnDefinition,
  RowData,
  TableDefinition,
  TableRow,
  WorkflowCellValue,
} from '@/lib/table/types'

const logger = createLogger('WorkflowColumnScheduler')

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
 * Iterates workflow columns × rows and enqueues eligible cell jobs. Safe to
 * call after any row-write; errors are logged. Concurrency is bounded by the
 * trigger.dev queue (`concurrencyKey: tableId`), so this just enqueues.
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
          const message = toError(predicateErr).message
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
 * and writes `running` (with the returned `jobId`) onto the cell. The actual
 * workflow execution and terminal `completed`/`error` write happen inside the
 * cell task body. Cancellation is authoritative via `cancelWorkflowColumnRuns`.
 */
export async function runWorkflowColumn(opts: RunWorkflowColumnOptions): Promise<void> {
  const { tableId, tableName, rowId, columnName, workflowId, workspaceId, executionId } = opts

  const { getJobQueue, shouldExecuteInline } = await import('@/lib/core/async-jobs/config')
  const cellCtx = { tableId, rowId, columnName, workspaceId, executionId }

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
      // Per-table sub-queue throttles cells within a table without blocking other tables.
      concurrencyKey: tableId,
      tags: [`tableId:${tableId}`, `rowId:${rowId}`, `column:${columnName}`],
    })
  } catch (err) {
    const message = toError(err).message
    logger.error(
      `Failed to enqueue workflow-column-execution (table=${tableId} row=${rowId} col=${columnName}):`,
      err
    )
    await writeWorkflowCell(cellCtx, {
      executionId,
      jobId: null,
      workflowId,
      status: 'error',
      output: null,
      error: message,
    })
    return
  }

  // Single post-enqueue write: stamps `running` + jobId so the cancel API can
  // reach this run from any pod. If cancel won the race the helper bails and
  // we abort the just-enqueued job.
  let stampResult: 'wrote' | 'skipped' = 'wrote'
  try {
    stampResult = await writeWorkflowCell(cellCtx, {
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
  if (stampResult === 'skipped') {
    // Cell already terminal (cancelled by user, or some other race) — abort
    // the trigger.dev job we just enqueued so it never picks up this row.
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

  // Trigger.dev disabled — execute the task body inline (DB queue records
  // rows but doesn't dispatch), mirroring `workflow-execution`.
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
        const message = toError(err).message
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
 * Cancels in-flight workflow-column runs for a table or single row. Writes
 * `cancelled` authoritatively for any `running` or `pending` cell — the
 * client-side write is the source of truth, independent of whether the
 * trigger.dev cancel reaches the worker before its terminal write.
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

  type RowMutation = { rowId: string; nextData: RowData; jobIds: string[]; cancelledCount: number }
  const mutations: RowMutation[] = []

  for (const row of rows) {
    if (row.tableId !== tableId) continue
    const data = row.data as RowData
    const nextData: RowData = { ...data }
    const jobIds: string[] = []
    let cancelledCount = 0
    for (const name of workflowColumnNames) {
      const cell = data[name] as WorkflowCellValue | null | undefined
      // `pending` covers the post-reset, pre-dispatch window — a stop click
      // there must still stick once the scheduler picks the cell up.
      if (!cell || (cell.status !== 'running' && cell.status !== 'pending')) continue
      if (cell.jobId) jobIds.push(cell.jobId)
      nextData[name] = buildCancelledCell(cell) as unknown as RowData[string]
      cancelledCount++
    }
    if (cancelledCount > 0) {
      mutations.push({ rowId: row.id, nextData, jobIds, cancelledCount })
    }
  }

  // Cancel jobs and write cells in parallel — no ordering dependency, so
  // serializing dozens-to-hundreds of cells per stop click is pure latency.
  await Promise.allSettled(
    mutations.flatMap((m) =>
      m.jobIds.map((jobId) =>
        queue.cancelJob(jobId).catch((err) => {
          logger.error(`Failed to cancel job ${jobId} for ${tableId}/${m.rowId}:`, err)
        })
      )
    )
  )
  await Promise.allSettled(
    mutations.map((m) =>
      updateRow(
        { tableId, rowId: m.rowId, data: m.nextData, workspaceId: table.workspaceId },
        table,
        `wfcol-cancel-${m.rowId}`
      ).catch((err) => {
        logger.error(`Failed to write cancelled state for row ${m.rowId}:`, err)
      })
    )
  )

  return mutations.reduce((sum, m) => sum + m.cancelledCount, 0)
}
