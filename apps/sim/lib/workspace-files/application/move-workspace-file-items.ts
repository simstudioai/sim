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
  moveWorkspaceFileItems,
} from '@/lib/uploads/contexts/workspace'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { authorizeWorkspaceFileOperation } from '@/lib/workspace-files/application/workspace-operation-context'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'

const logger = createLogger('MoveWorkspaceFileItems')

export interface MoveWorkspaceFileItemsInput {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
  targetFolderId?: string | null
  targetFolderPath?: string
}

export interface MoveWorkspaceFileItemsResult {
  movedItems: { files: number; folders: number }
}

async function executeMoveWorkspaceFileItems(args: {
  principal: Principal
  input: MoveWorkspaceFileItemsInput
  request?: OrchestrationRequestContext
}): Promise<MoveWorkspaceFileItemsResult> {
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
    fileOperations.move,
    args.input.workspaceId,
    fileIds[0]
  )
  const auditAttribution = resolvePrincipalAuditAttribution(args.principal)
  await assertWorkspaceFileItemsBelongToWorkspace({
    workspaceId: context.workspaceId,
    fileIds,
    folderIds,
  })
  const moved = await moveWorkspaceFileItems({
    workspaceId: context.workspaceId,
    fileIds,
    folderIds,
    targetFolderId: args.input.targetFolderId,
    targetFolderPath: args.input.targetFolderPath,
  })
  const movedItems = { files: moved.movedFiles, folders: moved.movedFolders }

  if (fileIds.length > 0) {
    recordAudit({
      workspaceId: context.workspaceId,
      actorId: auditAttribution.actorId,
      actorName: auditAttribution.actorName,
      action: AuditAction.FILE_MOVED,
      resourceType: AuditResourceType.FILE,
      description: `Moved ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`,
      metadata: {
        operation: fileOperations.move.id,
        actor: auditAttribution.actor,
        fileIds,
        targetFolderId: args.input.targetFolderId,
        targetFolderPath: args.input.targetFolderPath,
      },
      request: args.request,
    })
  }
  if (folderIds.length > 0) {
    recordAudit({
      workspaceId: context.workspaceId,
      actorId: auditAttribution.actorId,
      actorName: auditAttribution.actorName,
      action: AuditAction.FOLDER_MOVED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderIds.length === 1 ? folderIds[0] : undefined,
      description: `Moved ${folderIds.length} file folder${folderIds.length === 1 ? '' : 's'}`,
      metadata: {
        operation: fileOperations.move.id,
        actor: auditAttribution.actor,
        folderIds,
        targetFolderId: args.input.targetFolderId,
        targetFolderPath: args.input.targetFolderPath,
      },
      request: args.request,
    })
  }
  await notifyWorkspaceFilesChanged(context.workspaceId)
  logger.info('Moved workspace file items', { workspaceId: context.workspaceId, movedItems })
  return { movedItems }
}

export const moveWorkspaceFileItemsOperation = {
  operation: fileOperations.move,
  execute: executeMoveWorkspaceFileItems,
} as const
