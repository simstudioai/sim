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
import { generateId } from '@/lib/core/utils/uuid'
import type {
  ColumnDefinition,
  RowData,
  TableDefinition,
  TableRow,
  WorkflowCellValue,
} from '@/lib/table/types'

const logger = createLogger('WorkflowColumnScheduler')

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

  // Default predicate: every column to the left must be filled.
  // For plain columns, "filled" means a non-null / non-empty value.
  // For upstream workflow columns, "filled" means the cell has status === 'completed'
  // — this is what makes cascading work: a downstream workflow only runs after the
  // upstream workflow finishes.
  for (let i = 0; i < columnIndex; i++) {
    const leftCol = schema.columns[i]
    const value = row.data[leftCol.name]
    if (leftCol.type === 'workflow') {
      const leftCell = value as WorkflowCellValue | null | undefined
      if (leftCell?.status !== 'completed') return false
      continue
    }
    if (value === null || value === undefined || value === '') return false
  }

  return true
}

/**
 * Fire-and-forget scheduler. Iterates workflow columns × rows and kicks off eligible
 * executions. Safe to call after any row-write operation; errors are logged.
 *
 * Actor identity for the downstream workflow is derived from the workflow record itself
 * (same convention as webhook/polling-fired triggers), so the service call site doesn't
 * need to provide a user id.
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

    for (const row of rows) {
      for (const { col, idx } of workflowColumns) {
        if (!isWorkflowColumnEligible(col, idx, row, table.schema)) continue

        const workflowId = col.workflowConfig!.workflowId
        const executionId = generateId()

        logger.info(
          `Scheduling workflow column run: table=${table.id} row=${row.id} col=${col.name} workflow=${workflowId}`
        )

        void runWorkflowColumn({
          tableId: table.id,
          tableName: table.name,
          rowId: row.id,
          columnName: col.name,
          workflowId,
          workspaceId: table.workspaceId,
          executionId,
        })
      }
    }
  } catch (err) {
    logger.error('scheduleWorkflowColumnRuns failed:', err)
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
      await writeCell({
        executionId,
        workflowId,
        status: 'completed',
        output: (result.output as unknown) ?? null,
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
