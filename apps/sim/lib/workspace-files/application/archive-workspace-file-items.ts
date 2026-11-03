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
import {
  namesWorkspaceFileVfsPath,
  resolveWorkspaceFileVfsPath,
} from '@/lib/workspace-files/application/file-context'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  MAX_WORKSPACE_FILE_BULK_REQUEST_IDS,
  MAX_WORKSPACE_FILE_BULK_REQUEST_PATHS,
} from '@/lib/workspace-files/limits'

const logger = createLogger('ArchiveWorkspaceFileItems')

export interface ArchiveWorkspaceFileItemsInput {
  workspaceId: string
  fileIds?: string[]
  folderIds?: string[]
  /**
   * Also accept a live file's exact `files/…` VFS path among `fileIds`. Only the public v2
   * surface sets it; every other caller passes ids, and a path there stays an unknown id.
   */
  acceptVfsPath?: boolean
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

/**
 * Turns each path among the selected files into its file's id, all before anything is archived,
 * so one path that names no single live file refuses the whole request. Runs only after the
 * caller is admitted to the workspace, which is what lets a refusal name what the workspace
 * holds.
 */
async function resolveFileReferences(
  workspaceId: string,
  acceptVfsPath: boolean | undefined,
  references: string[]
): Promise<string[]> {
  const isPath = references.map((reference) => namesWorkspaceFileVfsPath(acceptVfsPath, reference))
  if (isPath.filter(Boolean).length > MAX_WORKSPACE_FILE_BULK_REQUEST_PATHS) {
    throw new OrchestrationError(
      'validation',
      `Bulk file operations resolve at most ${MAX_WORKSPACE_FILE_BULK_REQUEST_PATHS} file paths per request; pass file ids for the rest`
    )
  }
  const resolved: string[] = []
  for (const [index, reference] of references.entries()) {
    if (!isPath[index]) {
      resolved.push(reference)
      continue
    }
    resolved.push(
      await resolveWorkspaceFileVfsPath(workspaceId, reference).catch((error: unknown) => {
        if (!(error instanceof OrchestrationError) || error.code !== 'not_found') throw error
        throw new OrchestrationError(
          'not_found',
          `No live file at "${reference}"${reference.includes(',') ? '; pass each path as its own entry' : ''}`
        )
      })
    )
  }
  return [...new Set(resolved)]
}

async function executeArchiveWorkspaceFileItems({
  input,
  context,
}: {
  input: ArchiveWorkspaceFileItemsInput
  context: Awaited<ReturnType<typeof resolveArchiveContext>>
}): Promise<ArchiveWorkspaceFileItemsResult> {
  const { fileIds: references, folderIds } = normalizeSelection(input)
  if (references.length === 0 && folderIds.length === 0) {
    throw new OrchestrationError('validation', 'At least one file or folder must be selected')
  }
  if (
    references.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS ||
    folderIds.length > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS
  ) {
    throw new OrchestrationError(
      'validation',
      `Bulk file operations accept at most ${MAX_WORKSPACE_FILE_BULK_REQUEST_IDS} file and folder IDs`
    )
  }
  const fileIds = await resolveFileReferences(context.workspaceId, input.acceptVfsPath, references)

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
  const [sole] = fileIds
  const namesOneFileById =
    sole !== undefined &&
    fileIds.length === 1 &&
    folderIds.length === 0 &&
    !namesWorkspaceFileVfsPath(input.acceptVfsPath, sole)
  return { ...context, fileId: namesOneFileById ? sole : undefined }
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
