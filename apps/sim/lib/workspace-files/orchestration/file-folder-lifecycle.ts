import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import {
  assertFolderMutable,
  assertResourceMutable,
  ResourceLockedError,
} from '@sim/platform-authz/resource-lock'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import {
  performCreateFolder,
  performRestoreFolder,
  performUpdateFolder,
} from '@/lib/folders/orchestration'
import {
  bulkArchiveWorkspaceFileItems,
  FileConflictError,
  getWorkspaceFileFolder,
  moveWorkspaceFileItems,
  renameWorkspaceFile,
  restoreWorkspaceFile,
  type WorkspaceFileArchiveResult,
  WorkspaceFileFolderConflictError,
  type WorkspaceFileFolderRecord,
  WorkspaceFileItemsNotFoundError,
  WorkspaceFileMoveConflictError,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'

const logger = createLogger('WorkspaceFileFolderLifecycle')

export type WorkspaceFilesOrchestrationErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'locked'
  | 'internal'

export function workspaceFilesOrchestrationStatus(
  errorCode: WorkspaceFilesOrchestrationErrorCode | undefined
): number {
  if (errorCode === 'validation') return 400
  if (errorCode === 'conflict') return 409
  if (errorCode === 'not_found') return 404
  if (errorCode === 'locked') return 423
  return 500
}

export interface PerformDeleteWorkspaceFileItemsParams {
  workspaceId: string
  userId: string
  fileIds?: string[]
  folderIds?: string[]
}

export interface PerformDeleteWorkspaceFileItemsResult {
  success: boolean
  error?: string
  errorCode?: WorkspaceFilesOrchestrationErrorCode
  deletedItems?: WorkspaceFileArchiveResult
}

export interface PerformMoveWorkspaceFileItemsParams {
  workspaceId: string
  userId: string
  fileIds?: string[]
  folderIds?: string[]
  targetFolderId?: string | null
}

export interface PerformMoveWorkspaceFileItemsResult {
  success: boolean
  error?: string
  errorCode?: WorkspaceFilesOrchestrationErrorCode
  movedItems?: { files: number; folders: number }
}

export interface PerformRenameWorkspaceFileParams {
  workspaceId: string
  fileId: string
  name: string
  userId: string
  locked?: boolean
  /** True when `name` is unchanged and only `locked` is being toggled. */
  isLockOnlyUpdate?: boolean
}

export interface PerformRenameWorkspaceFileResult {
  success: boolean
  error?: string
  errorCode?: WorkspaceFilesOrchestrationErrorCode
  file?: WorkspaceFileRecord
}

export interface PerformRestoreWorkspaceFileParams {
  workspaceId: string
  fileId: string
  userId: string
}

export interface PerformRestoreWorkspaceFileResult {
  success: boolean
  error?: string
  errorCode?: WorkspaceFilesOrchestrationErrorCode
}

export interface PerformCreateWorkspaceFileFolderParams {
  workspaceId: string
  userId: string
  name: string
  parentId?: string | null
}

export interface PerformCreateWorkspaceFileFolderResult {
  success: boolean
  error?: string
  errorCode?: WorkspaceFilesOrchestrationErrorCode
  folder?: WorkspaceFileFolderRecord
}

export interface PerformUpdateWorkspaceFileFolderParams {
  workspaceId: string
  folderId: string
  userId: string
  name?: string
  parentId?: string | null
  sortOrder?: number
}

export interface PerformUpdateWorkspaceFileFolderResult {
  success: boolean
  error?: string
  errorCode?: WorkspaceFilesOrchestrationErrorCode
  folder?: WorkspaceFileFolderRecord
}

export interface PerformRestoreWorkspaceFileFolderParams {
  workspaceId: string
  folderId: string
  userId: string
}

export interface PerformRestoreWorkspaceFileFolderResult {
  success: boolean
  error?: string
  errorCode?: WorkspaceFilesOrchestrationErrorCode
  folder?: WorkspaceFileFolderRecord
  restoredItems?: WorkspaceFileArchiveResult
}

export async function performDeleteWorkspaceFileItems(
  params: PerformDeleteWorkspaceFileItemsParams
): Promise<PerformDeleteWorkspaceFileItemsResult> {
  const { workspaceId, userId, fileIds = [], folderIds = [] } = params

  if (fileIds.length === 0 && folderIds.length === 0) {
    return {
      success: false,
      error: 'At least one file or folder must be selected',
      errorCode: 'validation',
    }
  }

  try {
    await Promise.all(fileIds.map((id) => assertResourceMutable('file', id)))
    await Promise.all(folderIds.map((id) => assertFolderMutable(id, 'file')))

    const deletedItems = await bulkArchiveWorkspaceFileItems({ workspaceId, fileIds, folderIds })

    if (fileIds.length === 1 && folderIds.length === 0 && deletedItems.files === 0) {
      return { success: false, error: 'File not found', errorCode: 'not_found' }
    }
    if (folderIds.length === 1 && fileIds.length === 0 && deletedItems.folders === 0) {
      return { success: false, error: 'Folder not found', errorCode: 'not_found' }
    }

    logger.info('Deleted workspace file items', {
      workspaceId,
      fileIds,
      folderIds,
      deletedItems,
    })

    if (fileIds.length > 0) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FILE_DELETED,
        resourceType: AuditResourceType.FILE,
        description: `Deleted ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`,
        metadata: { fileIds },
      })
    }

    if (folderIds.length > 0) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FOLDER_DELETED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folderIds.length === 1 ? folderIds[0] : undefined,
        description: `Deleted ${folderIds.length} file folder${folderIds.length === 1 ? '' : 's'}`,
        metadata: {
          folderIds,
          affected: {
            files: deletedItems.files,
            folders: deletedItems.folders,
          },
        },
      })
    }

    return { success: true, deletedItems }
  } catch (error) {
    if (error instanceof ResourceLockedError) {
      return { success: false, error: error.message, errorCode: 'locked' }
    }
    logger.error('Failed to delete workspace file items', { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performMoveWorkspaceFileItems(
  params: PerformMoveWorkspaceFileItemsParams
): Promise<PerformMoveWorkspaceFileItemsResult> {
  const { workspaceId, userId, fileIds = [], folderIds = [], targetFolderId } = params

  if (fileIds.length === 0 && folderIds.length === 0) {
    return {
      success: false,
      error: 'At least one file or folder must be selected',
      errorCode: 'validation',
    }
  }

  try {
    await Promise.all(fileIds.map((id) => assertResourceMutable('file', id)))
    await Promise.all(folderIds.map((id) => assertFolderMutable(id, 'file')))
    // The checks above only cover each moved item's *current* folder chain —
    // without this, an item could be moved out of an unlocked folder into a locked one.
    if (targetFolderId) {
      await assertFolderMutable(targetFolderId, 'file')
    }

    const moved = await moveWorkspaceFileItems({
      workspaceId,
      fileIds,
      folderIds,
      targetFolderId,
    })
    const movedItems = { files: moved.movedFiles, folders: moved.movedFolders }

    logger.info('Moved workspace file items', {
      workspaceId,
      fileIds,
      folderIds,
      targetFolderId,
      movedItems,
    })

    if (fileIds.length > 0) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FILE_MOVED,
        resourceType: AuditResourceType.FILE,
        description: `Moved ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}${targetFolderId ? ' to folder' : ' to root'}`,
        metadata: { fileIds, targetFolderId },
      })
    }

    if (folderIds.length > 0) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FOLDER_MOVED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folderIds.length === 1 ? folderIds[0] : undefined,
        description: `Moved ${folderIds.length} file folder${folderIds.length === 1 ? '' : 's'}${targetFolderId ? ' to folder' : ' to root'}`,
        metadata: { folderIds, targetFolderId },
      })
    }

    return { success: true, movedItems }
  } catch (error) {
    if (error instanceof ResourceLockedError) {
      return { success: false, error: error.message, errorCode: 'locked' }
    }
    logger.error('Failed to move workspace file items', { error })
    if (
      error instanceof WorkspaceFileMoveConflictError ||
      error instanceof WorkspaceFileFolderConflictError ||
      getPostgresErrorCode(error) === '23505'
    ) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'A file or folder with this name already exists in the destination folder',
        errorCode: 'conflict',
      }
    }
    if (error instanceof WorkspaceFileItemsNotFoundError) {
      return { success: false, error: error.message, errorCode: 'not_found' }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performRenameWorkspaceFile(
  params: PerformRenameWorkspaceFileParams
): Promise<PerformRenameWorkspaceFileResult> {
  const { workspaceId, fileId, name, userId, locked, isLockOnlyUpdate } = params

  try {
    if (!isLockOnlyUpdate) {
      await assertResourceMutable('file', fileId)
    }

    const file = await renameWorkspaceFile(workspaceId, fileId, name, locked)

    logger.info('Renamed workspace file', { workspaceId, fileId, name: file.name })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FILE_UPDATED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileId,
      resourceName: file.name,
      description: `Renamed file to "${file.name}"`,
    })

    return { success: true, file }
  } catch (error) {
    if (error instanceof ResourceLockedError) {
      return { success: false, error: error.message, errorCode: 'locked' }
    }
    logger.error('Failed to rename workspace file', { error })
    if (error instanceof FileConflictError || getPostgresErrorCode(error) === '23505') {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performRestoreWorkspaceFile(
  params: PerformRestoreWorkspaceFileParams
): Promise<PerformRestoreWorkspaceFileResult> {
  const { workspaceId, fileId, userId } = params

  try {
    await assertResourceMutable('file', fileId)
    await restoreWorkspaceFile(workspaceId, fileId)

    logger.info('Restored workspace file', { workspaceId, fileId })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FILE_RESTORED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileId,
      resourceName: fileId,
      description: `Restored workspace file ${fileId}`,
    })

    return { success: true }
  } catch (error) {
    if (error instanceof ResourceLockedError) {
      return { success: false, error: error.message, errorCode: 'locked' }
    }
    logger.error('Failed to restore workspace file', { error })
    if (error instanceof FileConflictError || getPostgresErrorCode(error) === '23505') {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

/**
 * Delegates to the generic `resourceType: 'file'` folder CRUD in
 * `@/lib/folders/orchestration` (single source of truth for folder audit
 * recording) and re-fetches the VFS-flavored `WorkspaceFileFolderRecord`
 * (adds the computed `path` the generic `Folder` shape doesn't carry).
 */
export async function performCreateWorkspaceFileFolder(
  params: PerformCreateWorkspaceFileFolderParams
): Promise<PerformCreateWorkspaceFileFolderResult> {
  const { workspaceId, userId, name, parentId } = params

  const result = await performCreateFolder({
    resourceType: 'file',
    workspaceId,
    userId,
    name,
    parentId,
  })
  if (!result.success || !result.folder) {
    return { success: false, error: result.error, errorCode: result.errorCode }
  }

  const folder = await getWorkspaceFileFolder(workspaceId, result.folder.id)
  if (!folder) {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }

  logger.info('Created workspace file folder', { workspaceId, folderId: folder.id })
  return { success: true, folder }
}

/** See `performCreateWorkspaceFileFolder` — delegates to the generic layer, re-fetches for `path`. */
export async function performUpdateWorkspaceFileFolder(
  params: PerformUpdateWorkspaceFileFolderParams
): Promise<PerformUpdateWorkspaceFileFolderResult> {
  const { workspaceId, folderId, userId, name, parentId, sortOrder } = params

  const result = await performUpdateFolder({
    resourceType: 'file',
    workspaceId,
    folderId,
    userId,
    name,
    parentId,
    sortOrder,
  })
  if (!result.success || !result.folder) {
    return { success: false, error: result.error, errorCode: result.errorCode }
  }

  const folder = await getWorkspaceFileFolder(workspaceId, folderId)
  if (!folder) {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }

  logger.info('Updated workspace file folder', { workspaceId, folderId })
  return { success: true, folder }
}

/** See `performCreateWorkspaceFileFolder` — delegates to the generic layer, re-fetches for `path`. */
export async function performRestoreWorkspaceFileFolder(
  params: PerformRestoreWorkspaceFileFolderParams
): Promise<PerformRestoreWorkspaceFileFolderResult> {
  const { workspaceId, folderId, userId } = params

  const result = await performRestoreFolder({ resourceType: 'file', workspaceId, folderId, userId })
  if (!result.success || !result.restoredItems) {
    return { success: false, error: result.error, errorCode: 'not_found' }
  }

  const folder = await getWorkspaceFileFolder(workspaceId, folderId)
  if (!folder) {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }

  const restoredItems: WorkspaceFileArchiveResult = {
    folders: result.restoredItems.folders,
    files: result.restoredItems.files ?? 0,
  }
  logger.info('Restored workspace file folder', { workspaceId, folderId, restoredItems })
  return { success: true, folder, restoredItems }
}
