import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import {
  bulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolder,
  FileConflictError,
  moveWorkspaceFileItems,
  renameWorkspaceFile,
  restoreWorkspaceFile,
  restoreWorkspaceFileFolder,
  updateWorkspaceFileFolder,
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
  | 'internal'

export function workspaceFilesOrchestrationStatus(
  errorCode: WorkspaceFilesOrchestrationErrorCode | undefined
): number {
  if (errorCode === 'validation') return 400
  if (errorCode === 'conflict') return 409
  if (errorCode === 'not_found') return 404
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
  const { workspaceId, fileId, name, userId } = params

  try {
    const file = await renameWorkspaceFile(workspaceId, fileId, name)

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
    logger.error('Failed to restore workspace file', { error })
    if (error instanceof FileConflictError || getPostgresErrorCode(error) === '23505') {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performCreateWorkspaceFileFolder(
  params: PerformCreateWorkspaceFileFolderParams
): Promise<PerformCreateWorkspaceFileFolderResult> {
  const { workspaceId, userId, name, parentId } = params

  try {
    const folder = await createWorkspaceFileFolder({ workspaceId, userId, name, parentId })

    logger.info('Created workspace file folder', { workspaceId, folderId: folder.id })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folder.id,
      resourceName: folder.name,
      description: `Created file folder "${folder.name}"`,
    })

    return { success: true, folder }
  } catch (error) {
    logger.error('Failed to create workspace file folder', { error })
    if (
      error instanceof WorkspaceFileFolderConflictError ||
      getPostgresErrorCode(error) === '23505'
    ) {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performUpdateWorkspaceFileFolder(
  params: PerformUpdateWorkspaceFileFolderParams
): Promise<PerformUpdateWorkspaceFileFolderResult> {
  const { workspaceId, folderId, userId, name, parentId, sortOrder } = params

  try {
    const folder = await updateWorkspaceFileFolder({
      workspaceId,
      folderId,
      name,
      parentId,
      sortOrder,
    })

    logger.info('Updated workspace file folder', { workspaceId, folderId })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FOLDER_UPDATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folder.name,
      description: `Updated file folder "${folder.name}"`,
    })

    return { success: true, folder }
  } catch (error) {
    logger.error('Failed to update workspace file folder', { error })
    if (
      error instanceof WorkspaceFileFolderConflictError ||
      getPostgresErrorCode(error) === '23505'
    ) {
      return {
        success: false,
        error:
          getPostgresErrorCode(error) === '23505'
            ? 'A folder with this name already exists in this location'
            : toError(error).message,
        errorCode: 'conflict',
      }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performRestoreWorkspaceFileFolder(
  params: PerformRestoreWorkspaceFileFolderParams
): Promise<PerformRestoreWorkspaceFileFolderResult> {
  const { workspaceId, folderId, userId } = params

  try {
    const { folder, restoredItems } = await restoreWorkspaceFileFolder(workspaceId, folderId)

    logger.info('Restored workspace file folder', { workspaceId, folderId, restoredItems })

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FOLDER_RESTORED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folder.name,
      description: `Restored file folder "${folder.name}"`,
      metadata: {
        affected: {
          files: restoredItems.files,
          subfolders: Math.max(0, restoredItems.folders - 1),
        },
      },
    })

    return { success: true, folder, restoredItems }
  } catch (error) {
    logger.error('Failed to restore workspace file folder', { error })
    if (getPostgresErrorCode(error) === '23505') {
      return {
        success: false,
        error: 'A folder with this name already exists in this location',
        errorCode: 'conflict',
      }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}
