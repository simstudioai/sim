import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  assertWorkspaceFileItemsBelongToWorkspace,
  loadWorkspaceFileOperationContext,
  moveWorkspaceFileItems,
} from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
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
  affectedIds: { fileIds: string[]; folderIds: string[] }
}

function normalizeSelection(input: MoveWorkspaceFileItemsInput) {
  return {
    fileIds: [...new Set(input.fileIds ?? [])],
    folderIds: [...new Set(input.folderIds ?? [])],
  }
}

async function executeMoveWorkspaceFileItems({
  input,
  context,
}: {
  input: MoveWorkspaceFileItemsInput
  context: Awaited<ReturnType<typeof resolveMoveContext>>
}): Promise<MoveWorkspaceFileItemsResult> {
  const { fileIds, folderIds } = normalizeSelection(input)
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

  await assertWorkspaceFileItemsBelongToWorkspace({
    workspaceId: context.workspaceId,
    fileIds,
    folderIds,
  })
  const moved = await moveWorkspaceFileItems({
    workspaceId: context.workspaceId,
    fileIds,
    folderIds,
    targetFolderId: input.targetFolderId,
    targetFolderPath: input.targetFolderPath,
  })
  const movedItems = { files: moved.movedFileIds.length, folders: moved.movedFolderIds.length }

  logger.info('Moved workspace file items', { workspaceId: context.workspaceId, movedItems })
  return {
    movedItems,
    affectedIds: { fileIds: moved.movedFileIds, folderIds: moved.movedFolderIds },
  }
}

async function resolveMoveContext({ input }: { input: MoveWorkspaceFileItemsInput }) {
  const context = await loadWorkspaceFileOperationContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  const { fileIds, folderIds } = normalizeSelection(input)
  return {
    ...context,
    fileId: fileIds.length === 1 && folderIds.length === 0 ? fileIds[0] : undefined,
  }
}

export const moveWorkspaceFileItemsOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.move,
  resolveContext: resolveMoveContext,
  execute: executeMoveWorkspaceFileItems,
  projectAudit({ input, result }) {
    const entries = []
    if (result.affectedIds.fileIds.length > 0) {
      entries.push({
        action: AuditAction.FILE_MOVED,
        resourceType: AuditResourceType.FILE,
        description: `Moved ${result.affectedIds.fileIds.length} file${result.affectedIds.fileIds.length === 1 ? '' : 's'}`,
        metadata: {
          fileIds: result.affectedIds.fileIds,
          targetFolderId: input.targetFolderId,
          targetFolderPath: input.targetFolderPath,
        },
      })
    }
    if (result.affectedIds.folderIds.length > 0) {
      entries.push({
        action: AuditAction.FOLDER_MOVED,
        resourceType: AuditResourceType.FOLDER,
        resourceId:
          result.affectedIds.folderIds.length === 1 ? result.affectedIds.folderIds[0] : undefined,
        description: `Moved ${result.affectedIds.folderIds.length} file folder${result.affectedIds.folderIds.length === 1 ? '' : 's'}`,
        metadata: {
          folderIds: result.affectedIds.folderIds,
          targetFolderId: input.targetFolderId,
          targetFolderPath: input.targetFolderPath,
        },
      })
    }
    return entries
  },
  async afterSuccess({ context, result }) {
    if (result.affectedIds.fileIds.length > 0 || result.affectedIds.folderIds.length > 0) {
      await notifyWorkspaceFilesChanged(context.workspaceId)
    }
  },
})
