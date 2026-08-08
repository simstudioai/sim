import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  assertWorkspaceFileItemsBelongToWorkspace,
  bulkArchiveWorkspaceFileItems,
} from '@/lib/uploads/contexts/workspace'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { authorizeWorkspaceFileOperation } from '@/lib/workspace-files/application/workspace-operation-context'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'

const logger = createLogger('ArchiveWorkspaceFileItems')

export interface ArchiveWorkspaceFileItemsInput {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
}

export interface ArchiveWorkspaceFileItemsResult {
  deletedItems: { files: number; folders: number }
}

async function executeArchiveWorkspaceFileItems(args: {
  principal: Principal
  input: ArchiveWorkspaceFileItemsInput
  request?: OrchestrationRequestContext
}): Promise<ArchiveWorkspaceFileItemsResult> {
  const fileIds = [...new Set(args.input.fileIds ?? [])]
  const folderIds = [...new Set(args.input.folderIds ?? [])]
  if (fileIds.length === 0 && folderIds.length === 0) {
    throw new OrchestrationError('validation', 'At least one file or folder must be selected')
  }
  if (
    fileIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS ||
    folderIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS
  ) {
    throw new OrchestrationError(
      'validation',
      `Bulk file operations accept at most ${MAX_WORKSPACE_FILE_BULK_REQUEST_IDS} file and folder IDs`
    )
  }

  const { context } = await authorizeWorkspaceFileOperation(
    args.principal,
    fileOperations.delete,
    args.input.workspaceId,
    fileIds[0]
  )
  const auditAttribution = resolvePrincipalAuditAttribution(args.principal)
  await assertWorkspaceFileItemsBelongToWorkspace({
    workspaceId: context.workspaceId,
    fileIds,
    folderIds,
  })
  const deletedItems = await bulkArchiveWorkspaceFileItems({
    workspaceId: context.workspaceId,
    fileIds,
    folderIds,
  })

  if (fileIds.length === 1 && folderIds.length === 0 && deletedItems.files === 0) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  if (folderIds.length === 1 && fileIds.length === 0 && deletedItems.folders === 0) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }

  if (fileIds.length > 0) {
    recordAudit({
      workspaceId: context.workspaceId,
      actorId: auditAttribution.actorId,
      actorName: auditAttribution.actorName,
      action: AuditAction.FILE_DELETED,
      resourceType: AuditResourceType.FILE,
      description: `Deleted ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`,
      metadata: { operation: fileOperations.delete.id, actor: auditAttribution.actor, fileIds },
      request: args.request,
    })
  }
  if (folderIds.length > 0) {
    recordAudit({
      workspaceId: context.workspaceId,
      actorId: auditAttribution.actorId,
      actorName: auditAttribution.actorName,
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderIds.length === 1 ? folderIds[0] : undefined,
      description: `Deleted ${folderIds.length} file folder${folderIds.length === 1 ? '' : 's'}`,
      metadata: {
        operation: fileOperations.delete.id,
        actor: auditAttribution.actor,
        folderIds,
        affected: deletedItems,
      },
      request: args.request,
    })
  }
  await notifyWorkspaceFilesChanged(context.workspaceId)
  logger.info('Archived workspace file items', { workspaceId: context.workspaceId, deletedItems })
  return { deletedItems }
}

export const archiveWorkspaceFileItemsOperation = {
  operation: fileOperations.delete,
  execute: executeArchiveWorkspaceFileItems,
} as const
