import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { captureServerEvent } from '@/lib/posthog/server'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { deleteRow } from '@/lib/table/rows/service'
import { deleteTable } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'

const logger = createLogger('TableOrchestration')

export interface PerformDeleteTableParams {
  table: TableDefinition
  userId: string
  requestId?: string
}

export interface PerformDeleteTableResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
}

/**
 * Archives a table on behalf of `userId`.
 *
 * `deleteTable` records the audit itself, but only when a row was actually
 * archived AND an actor is supplied — omitting the actor is how the rollback
 * callers opt out. Passing it here is what keeps a no-op delete of an
 * already-archived table from emitting a `TABLE_DELETED` event, which is
 * exactly what the callers that hand-rolled their own audit used to do.
 */
export async function performDeleteTable(
  params: PerformDeleteTableParams
): Promise<PerformDeleteTableResult> {
  const { table, userId } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    await deleteTable(table.id, requestId, userId)
  } catch (error) {
    if (error instanceof TableLockedError) {
      return { success: false, error: error.message, errorCode: 'locked' }
    }
    logger.error(`[${requestId}] Failed to delete table ${table.id}`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }

  captureServerEvent(
    userId,
    'table_deleted',
    { table_id: table.id, workspace_id: table.workspaceId },
    { groups: { workspace: table.workspaceId } }
  )

  return { success: true }
}

export interface PerformDeleteTableRowParams {
  table: TableDefinition
  rowId: string
  requestId?: string
}

export interface PerformDeleteTableRowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
}

/**
 * Deletes a single row through the row service, so the delete lock is enforced
 * and the row-count and ordering bookkeeping runs. A raw `db.delete` skips both
 * and returns success on a locked table.
 */
export async function performDeleteTableRow(
  params: PerformDeleteTableRowParams
): Promise<PerformDeleteTableRowResult> {
  const { table, rowId } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    await deleteRow(table, rowId, requestId)
    return { success: true }
  } catch (error) {
    if (error instanceof TableLockedError) {
      return { success: false, error: error.message, errorCode: 'locked' }
    }
    if (error instanceof Error && error.message === 'Row not found') {
      return { success: false, error: 'Row not found', errorCode: 'not_found' }
    }
    logger.error(`[${requestId}] Failed to delete row ${rowId} from table ${table.id}`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}
