import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateRequestId } from '@/lib/core/utils/request'
import { getTableById, restoreTable, TableConflictError } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'

const logger = createLogger('TableOrchestration')

export type TableOrchestrationErrorCode = 'not_found' | 'validation' | 'conflict' | 'internal'

export interface PerformRestoreTableParams {
  tableId: string
  userId: string
  requestId?: string
}

export interface PerformRestoreTableResult {
  success: boolean
  error?: string
  errorCode?: TableOrchestrationErrorCode
  table?: TableDefinition
}

export async function performRestoreTable(
  params: PerformRestoreTableParams
): Promise<PerformRestoreTableResult> {
  const { tableId, userId } = params
  const requestId = params.requestId ?? generateRequestId()

  const archivedTable = await getTableById(tableId, { includeArchived: true })
  if (!archivedTable) {
    return { success: false, error: 'Table not found', errorCode: 'not_found' }
  }

  try {
    await restoreTable(tableId, requestId)
    const table = (await getTableById(tableId)) ?? archivedTable

    logger.info(`[${requestId}] Restored table ${tableId}`)

    recordAudit({
      workspaceId: archivedTable.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_RESTORED,
      resourceType: AuditResourceType.TABLE,
      resourceId: tableId,
      resourceName: table.name,
      description: `Restored table "${table.name}"`,
      metadata: {
        tableName: table.name,
        workspaceId: table.workspaceId,
      },
    })

    return { success: true, table }
  } catch (error) {
    logger.error(`[${requestId}] Failed to restore table ${tableId}`, { error })
    if (error instanceof TableConflictError) {
      return { success: false, error: error.message, errorCode: 'conflict' }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}
