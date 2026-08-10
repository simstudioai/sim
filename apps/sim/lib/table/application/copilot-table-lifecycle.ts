import { AuditAction, AuditResourceType } from '@sim/audit'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { deleteTable, TABLE_LIMITS } from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'

export interface DeleteCopilotTablesInput {
  workspaceId: string
  tableIds: string[]
  assertNotAborted: () => void
}

export interface ArchivedCopilotTable {
  id: string
  name: string
}

export interface DeleteCopilotTablesResult {
  deleted: ArchivedCopilotTable[]
  failed: string[]
}

/** Owns Copilot's ordered, best-effort multi-table archive operation. */
export const deleteCopilotTables = defineAuthorizedTableUseCase({
  operation: tableOperations.delete,
  resolveContext: ({ input }: { input: DeleteCopilotTablesInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }): Promise<DeleteCopilotTablesResult> {
    if (
      input.tableIds.length < 1 ||
      input.tableIds.length > TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE
    ) {
      throw new OrchestrationError(
        'validation',
        `Table ID count must be between 1 and ${TABLE_LIMITS.MAX_TABLES_PER_WORKSPACE}`
      )
    }
    if (input.tableIds.some((tableId) => typeof tableId !== 'string' || !tableId.trim())) {
      throw new OrchestrationError('validation', 'Each table ID must be a non-empty string')
    }

    const deleted: ArchivedCopilotTable[] = []
    const failed: string[] = []

    for (const tableId of input.tableIds) {
      try {
        const tableContext = await resolveActiveTableContext({
          tableId,
          assertedWorkspaceId: context.workspaceId,
        })
        input.assertNotAborted()
        const { archived } = await deleteTable(tableContext.tableId, generateRequestId(), {
          expectedWorkspaceId: context.workspaceId,
        })
        if (!archived) {
          failed.push(tableId)
          continue
        }

        deleted.push({ id: tableId, name: archived.name })
      } catch (error) {
        if (asOrchestrationError(error)?.code === 'not_found') {
          failed.push(tableId)
          continue
        }
        throw error
      }
    }

    return { deleted, failed }
  },
  projectAudit: ({ result }) =>
    result.deleted.map((table) => ({
      action: AuditAction.TABLE_DELETED,
      resourceType: AuditResourceType.TABLE,
      resourceId: table.id,
      resourceName: table.name,
      description: `Archived table "${table.name}"`,
    })),
})
