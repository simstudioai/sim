import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { resolvePrincipalAuditAttribution } from '@sim/auth/principal'
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
}

export interface DeleteCopilotTablesResult {
  deleted: string[]
  failed: string[]
}

/** Owns Copilot's ordered, best-effort multi-table archive operation. */
export const deleteCopilotTables = defineAuthorizedTableUseCase({
  operation: tableOperations.delete,
  resolveContext: ({ input }: { input: DeleteCopilotTablesInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context, request }): Promise<DeleteCopilotTablesResult> {
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

    const deleted: string[] = []
    const failed: string[] = []
    const auditAttribution = resolvePrincipalAuditAttribution(principal)

    for (const tableId of input.tableIds) {
      try {
        const tableContext = await resolveActiveTableContext({
          tableId,
          assertedWorkspaceId: context.workspaceId,
        })
        const { archived } = await deleteTable(tableContext.tableId, generateRequestId(), {
          expectedWorkspaceId: context.workspaceId,
        })
        if (!archived) {
          failed.push(tableId)
          continue
        }

        deleted.push(tableId)
        recordAudit({
          workspaceId: context.workspaceId,
          actorId: auditAttribution.actorId,
          actorName: auditAttribution.actorName,
          action: AuditAction.TABLE_DELETED,
          resourceType: AuditResourceType.TABLE,
          resourceId: tableId,
          resourceName: archived.name,
          description: `Archived table "${archived.name}"`,
          metadata: {
            operation: tableOperations.delete.id,
            actor: auditAttribution.actor,
          },
          request,
        })
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
})
