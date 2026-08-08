import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  assertWorkspaceFileItemsBelongToWorkspace,
  bulkArchiveWorkspaceFileItems,
  loadWorkspaceFileOperationContext,
} from '@/lib/uploads/contexts/workspace'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'

const logger = createLogger('ArchiveWorkspaceFileItems')

export interface ArchiveWorkspaceFileItemsInput {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
}

export interface ArchiveWorkspaceFileItemsResult {
  deletedItems: { files: number; folders: number }
  affectedIds: { fileIds: string[]; folderIds: string[] }
}

function normalizeSelection(input: ArchiveWorkspaceFileItemsInput) {
  return {
    fileIds: [...new Set(input.fileIds ?? [])],
    folderIds: [...new Set(input.folderIds ?? [])],
  }
}

async function executeArchiveWorkspaceFileItems({
  input,
  context,
}: {
  input: ArchiveWorkspaceFileItemsInput
  context: Awaited<ReturnType<typeof resolveArchiveContext>>
}): Promise<ArchiveWorkspaceFileItemsResult> {
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
  const archived = await bulkArchiveWorkspaceFileItems({
    workspaceId: context.workspaceId,
    fileIds,
    folderIds,
  })
  const deletedItems = { files: archived.fileIds.length, folders: archived.folderIds.length }

  if (fileIds.length === 1 && folderIds.length === 0 && archived.fileIds.length === 0) {
    throw new OrchestrationError('not_found', 'File not found')
  }
  if (folderIds.length === 1 && fileIds.length === 0 && archived.folderIds.length === 0) {
    throw new OrchestrationError('not_found', 'Folder not found')
  }

  logger.info('Archived workspace file items', { workspaceId: context.workspaceId, deletedItems })
  return {
    deletedItems,
    affectedIds: { fileIds: archived.fileIds, folderIds: archived.folderIds },
  }
}

async function resolveArchiveContext({ input }: { input: ArchiveWorkspaceFileItemsInput }) {
  const context = await loadWorkspaceFileOperationContext(input.workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  const { fileIds, folderIds } = normalizeSelection(input)
  return {
    ...context,
    fileId: fileIds.length === 1 && folderIds.length === 0 ? fileIds[0] : undefined,
  }
}

export const archiveWorkspaceFileItemsOperation = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.delete,
  resolveContext: resolveArchiveContext,
  execute: executeArchiveWorkspaceFileItems,
  projectAudit({ result }) {
    const entries = []
    if (result.affectedIds.fileIds.length > 0) {
      entries.push({
        action: AuditAction.FILE_DELETED,
        resourceType: AuditResourceType.FILE,
        description: `Deleted ${result.affectedIds.fileIds.length} file${result.affectedIds.fileIds.length === 1 ? '' : 's'}`,
        metadata: {
          fileIds: result.affectedIds.fileIds,
        },
      })
    }
    if (result.affectedIds.folderIds.length > 0) {
      entries.push({
        action: AuditAction.FOLDER_DELETED,
        resourceType: AuditResourceType.FOLDER,
        resourceId:
          result.affectedIds.folderIds.length === 1 ? result.affectedIds.folderIds[0] : undefined,
        description: `Deleted ${result.affectedIds.folderIds.length} file folder${result.affectedIds.folderIds.length === 1 ? '' : 's'}`,
        metadata: {
          folderIds: result.affectedIds.folderIds,
          affected: result.deletedItems,
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
