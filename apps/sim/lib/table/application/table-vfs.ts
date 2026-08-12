import { AuditAction, AuditResourceType } from '@sim/audit'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { notifyWorkspaceTablesChanged } from '@/lib/realtime/notify'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveTableWorkspaceContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { deleteTable, findActiveTablesByExactName, renameTable } from '@/lib/table/service'
import type { TableDefinition } from '@/lib/table/types'

interface TableVfsReferenceInput {
  workspaceId: string
  sourceName: string
}

export interface RenameTableByVfsPathInput extends TableVfsReferenceInput {
  newName: string
}

export type DeleteTableByVfsPathInput = TableVfsReferenceInput

async function resolveTableByVfsName(
  workspaceId: string,
  sourceName: string
): Promise<TableDefinition> {
  const matches = await findActiveTablesByExactName(workspaceId, sourceName)
  if (matches.length > 1) {
    throw new OrchestrationError('conflict', `Table path is ambiguous: tables/${sourceName}`)
  }
  const table = matches[0]
  if (!table) throw new OrchestrationError('not_found', `Table not found at tables/${sourceName}`)
  return table
}

export const renameTableByVfsPath = defineAuthorizedTableUseCase({
  operation: tableOperations.renameByVfsPath,
  resolveContext: ({ input }: { input: RenameTableByVfsPathInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    const table = await resolveTableByVfsName(context.workspaceId, input.sourceName)
    const renamed = await renameTable(table.id, input.newName, generateRequestId(), {
      expectedWorkspaceId: context.workspaceId,
      skipNotify: true,
    })
    return {
      id: renamed.id,
      name: renamed.name,
      previousName: table.name,
      workspaceId: context.workspaceId,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.TABLE_UPDATED,
    resourceType: AuditResourceType.TABLE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Renamed table to "${result.name}"`,
    metadata: { op: 'rename', previousName: result.previousName, source: 'copilot_vfs' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceTablesChanged(context.workspaceId),
})

export const deleteTableByVfsPath = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteByVfsPath,
  resolveContext: ({ input }: { input: DeleteTableByVfsPathInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ input, context }) {
    const table = await resolveTableByVfsName(context.workspaceId, input.sourceName)
    const { archived } = await deleteTable(table.id, generateRequestId(), {
      expectedWorkspaceId: context.workspaceId,
      skipNotify: true,
    })
    if (!archived)
      throw new OrchestrationError('not_found', `Table not found at tables/${input.sourceName}`)
    return {
      id: table.id,
      name: archived.name,
      workspaceId: context.workspaceId,
      deleted: true as const,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.TABLE_DELETED,
    resourceType: AuditResourceType.TABLE,
    resourceId: result.id,
    resourceName: result.name,
    description: `Archived table "${result.name}"`,
    metadata: { source: 'copilot_vfs' },
  }),
  afterSuccess: ({ context }) => notifyWorkspaceTablesChanged(context.workspaceId),
})
