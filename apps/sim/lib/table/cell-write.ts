/**
 * Shared cell-write primitives for workflow-column execution paths.
 *
 * Both the scheduler (`runWorkflowColumn`) and the cell task body
 * (`executeWorkflowColumnJob`) need to write cells while honoring the
 * `cancelled` state written by `cancelWorkflowColumnRuns` — without the guard,
 * a stop click that lands mid-enqueue or mid-execution gets clobbered when the
 * pre-existing in-flight code path proceeds to its next cell write. The single
 * helper here keeps that race-protection consistent across both callers.
 */

import { createLogger } from '@sim/logger'
import type { RowData, WorkflowCellValue } from '@/lib/table/types'

const logger = createLogger('WorkflowCellWrite')

export interface WriteWorkflowCellContext {
  tableId: string
  rowId: string
  columnName: string
  workspaceId: string
  executionId: string
  /** Used as the `requestId` passed to `updateRow` for log correlation. */
  requestId?: string
}

/**
 * Writes the cell unless cancellation has already won the race for this run.
 * Returns `'cancelled'` so callers can short-circuit any follow-up writes/jobs.
 */
export async function writeWorkflowCell(
  ctx: WriteWorkflowCellContext,
  value: WorkflowCellValue
): Promise<'wrote' | 'cancelled'> {
  const { tableId, rowId, columnName, workspaceId, executionId } = ctx
  const requestId = ctx.requestId ?? `wfcol-${executionId}`
  const { getTableById, getRowById, updateRow } = await import('@/lib/table/service')

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
  await updateRow({ tableId, rowId, data: mergedData, workspaceId }, table, requestId)
  return 'wrote'
}

/** Builds the canonical `cancelled` cell shape used by every cancel path. */
export function buildCancelledCell(
  prev: Pick<WorkflowCellValue, 'executionId' | 'workflowId'>
): WorkflowCellValue {
  return {
    executionId: prev.executionId ?? null,
    jobId: null,
    workflowId: prev.workflowId,
    status: 'cancelled',
    output: null,
    error: 'Cancelled',
  }
}
