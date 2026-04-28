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
import { webhook as webhookTable, workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { generateId } from '@sim/utils/id'
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
  if (status === 'running' || status === 'completed' || status === 'error') return false

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
        throw new Error(
          `Workflow column "${column.name}" has unknown dependency "${depName}"`
        )
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

    const pendingRuns: RunWorkflowColumnOptions[] = []

    for (const row of rows) {
      for (const { col, idx } of workflowColumns) {
        let eligible = false
        try {
          eligible = isWorkflowColumnEligible(col, idx, row, table.schema)
        } catch (predicateErr) {
          // Malformed dependency config — surface it on the specific cell so the user
          // can see why their column is stuck, then move on to the next row/column.
          const message = predicateErr instanceof Error ? predicateErr.message : String(predicateErr)
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
 * Executes a single workflow for a specific cell and writes the result back via the
 * normal row update path. Both "mark running" and the final write flow through
 * `updateRow`, so the scheduler re-enters naturally and cascades to downstream workflow
 * columns without any bypass plumbing.
 *
 * Service-layer imports are deferred to avoid a require-cycle with the service.
 */
export async function runWorkflowColumn(opts: RunWorkflowColumnOptions): Promise<void> {
  const { tableId, tableName, rowId, columnName, workflowId, workspaceId, executionId } = opts

  const { getTableById, getRowById, updateRow } = await import('@/lib/table/service')
  const { executeWorkflow } = await import('@/lib/workflows/executor/execute-workflow')

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

  try {
    await writeCell({
      executionId,
      workflowId,
      status: 'running',
      output: null,
      error: null,
    })
  } catch (err) {
    logger.error(`Failed to mark cell running (table=${tableId} row=${rowId} col=${columnName}):`, err)
    return
  }

  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, workflowId))
    .limit(1)

  if (!workflowRecord || !workflowRecord.isDeployed) {
    await writeCell({
      executionId,
      workflowId,
      status: 'error',
      output: null,
      error: !workflowRecord ? 'Workflow not found' : 'Workflow is not deployed',
    })
    return
  }

  // Find the manual table-trigger webhook record for this workflow+table. Its `blockId`
  // is the trigger block the executor should enter at — otherwise executeWorkflow falls
  // through to looking for a Start block, which manual-trigger workflows don't have.
  const webhookRecords = await db
    .select({
      blockId: webhookTable.blockId,
      providerConfig: webhookTable.providerConfig,
    })
    .from(webhookTable)
    .where(
      and(
        eq(webhookTable.workflowId, workflowId),
        eq(webhookTable.provider, 'table'),
        eq(webhookTable.isActive, true),
        isNull(webhookTable.archivedAt)
      )
    )

  interface TableWebhookProviderConfig {
    tableId?: string
    tableSelector?: string
    manualTableId?: string
    eventType?: string
  }

  const manualWebhook = webhookRecords.find((w) => {
    const cfg = (w.providerConfig as TableWebhookProviderConfig | null) ?? {}
    const cfgTableId = cfg.tableId ?? cfg.tableSelector ?? cfg.manualTableId
    return cfgTableId === tableId && cfg.eventType === 'manual'
  })

  if (!manualWebhook?.blockId) {
    await writeCell({
      executionId,
      workflowId,
      status: 'error',
      output: null,
      error: 'Workflow is not configured with a manual table trigger for this table',
    })
    return
  }

  const row = await getRowById(tableId, rowId, workspaceId)
  if (!row) {
    logger.warn(`Row ${rowId} vanished before execution`)
    return
  }
  const table = await getTableById(tableId)
  if (!table) {
    logger.warn(`Table ${tableId} vanished before execution`)
    return
  }

  const columnDef = table.schema.columns.find((c) => c.name === columnName)
  const outputPath = columnDef?.workflowConfig?.outputPath

  const inputRow: Record<string, unknown> = {}
  for (const key of Object.keys(row.data)) {
    if (key === columnName) continue
    inputRow[key] = row.data[key]
  }

  const headers = table.schema.columns
    .filter((c) => c.name !== columnName)
    .map((c) => c.name)

  const input = {
    row: inputRow,
    rawRow: inputRow,
    previousRow: null,
    changedColumns: [],
    rowId,
    headers,
    rowNumber: row.position,
    tableId,
    tableName,
    timestamp: new Date().toISOString(),
  }

  try {
    const result = await executeWorkflow(
      {
        id: workflowRecord.id,
        userId: workflowRecord.userId,
        workspaceId: workflowRecord.workspaceId,
        variables: (workflowRecord.variables as Record<string, unknown> | null) ?? {},
      },
      `wfcol-${executionId}`,
      input,
      workflowRecord.userId,
      {
        enabled: true,
        executionMode: 'sync',
        workflowTriggerType: 'table',
        triggerBlockId: manualWebhook.blockId,
      },
      executionId
    )

    if (result.success) {
      const rawOutput = (result.output as unknown) ?? null
      const pickedOutput = outputPath ? pluckByPath(rawOutput, outputPath) : rawOutput
      await writeCell({
        executionId,
        workflowId,
        status: 'completed',
        output: pickedOutput ?? null,
        error: null,
      })
    } else {
      await writeCell({
        executionId,
        workflowId,
        status: 'error',
        output: null,
        error: result.error ?? 'Workflow execution failed',
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(`Workflow column execution failed (table=${tableId} row=${rowId} col=${columnName}):`, err)
    try {
      await writeCell({
        executionId,
        workflowId,
        status: 'error',
        output: null,
        error: message,
      })
    } catch (writeErr) {
      logger.error('Also failed to write error state:', writeErr)
    }
  }
}
