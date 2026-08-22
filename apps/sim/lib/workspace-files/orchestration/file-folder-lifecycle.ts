import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import { asOrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { FolderPathError } from '@/lib/folders/paths'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  bulkArchiveWorkspaceFileItems,
  createWorkspaceFileFolder,
  createWorkspaceFileFolderAtPath,
  deleteWorkspaceFileFolderByPath,
  FileConflictError,
  moveRenameWorkspaceFile,
  moveWorkspaceFileItems,
  relocateWorkspaceFileFolderByPath,
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

export interface PerformDeleteWorkspaceFileItemsParams {
  workspaceId: string
  userId: string
  fileIds?: string[]
  folderIds?: string[]
  /**
   * Optional originating request, forwarded to the audit log so the deletion
   * entry captures client IP / user agent. Omitted by in-app callers that have
   * no HTTP request in scope.
   */
  request?: { headers: { get(name: string): string | null } }
}

export interface PerformDeleteWorkspaceFileItemsResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  deletedItems?: WorkspaceFileArchiveResult
}

export interface PerformMoveWorkspaceFileItemsParams {
  workspaceId: string
  userId: string
  fileIds?: string[]
  folderIds?: string[]
  targetFolderId?: string | null
  targetFolderPath?: string
}

export interface PerformMoveWorkspaceFileItemsResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
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
  errorCode?: OrchestrationErrorCode
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
  errorCode?: OrchestrationErrorCode
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
  errorCode?: OrchestrationErrorCode
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
  errorCode?: OrchestrationErrorCode
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
  errorCode?: OrchestrationErrorCode
  folder?: WorkspaceFileFolderRecord
  restoredItems?: WorkspaceFileArchiveResult
}

export interface PerformFileFolderPathMutationResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: WorkspaceFileFolderRecord
  path?: string
}

export interface PerformDeleteFileFolderByPathResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  deletedItems?: WorkspaceFileArchiveResult
}

function fileFolderPathError(error: unknown): {
  error: string
  errorCode: OrchestrationErrorCode
} {
  if (error instanceof FolderPathError) {
    return { error: error.message, errorCode: 'validation' }
  }
  if (
    error instanceof WorkspaceFileFolderConflictError ||
    getPostgresErrorCode(error) === '23505'
  ) {
    return { error: toError(error).message, errorCode: 'conflict' }
  }
  const classified = asOrchestrationError(error)
  if (classified) return { error: classified.message, errorCode: classified.code }
  return { error: toError(error).message, errorCode: 'internal' }
}

export async function performCreateWorkspaceFileFolderAtPath(params: {
  workspaceId: string
  userId: string
  path: string
}): Promise<PerformFileFolderPathMutationResult> {
  try {
    const result = await createWorkspaceFileFolderAtPath(params)
    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceName: result.folder.name,
      description: `Created file folder "${result.folder.name}"`,
      metadata: { path: result.path },
    })
    await notifyWorkspaceFilesChanged(params.workspaceId)
    return { success: true, folder: { ...result.folder, path: result.path }, path: result.path }
  } catch (error) {
    logger.error('Failed to create workspace file folder by path', { error })
    return { success: false, ...fileFolderPathError(error) }
  }
}

export async function performRelocateWorkspaceFileFolderByPath(params: {
  workspaceId: string
  userId: string
  path: string
  destinationPath: string
}): Promise<PerformFileFolderPathMutationResult> {
  try {
    const result = await relocateWorkspaceFileFolderByPath(params)
    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_MOVED,
      resourceType: AuditResourceType.FOLDER,
      resourceName: result.folder.name,
      description: `Moved file folder to "${result.path}"`,
      metadata: { sourcePath: params.path, destinationPath: result.path },
    })
    await notifyWorkspaceFilesChanged(params.workspaceId)
    return { success: true, folder: { ...result.folder, path: result.path }, path: result.path }
  } catch (error) {
    logger.error('Failed to relocate workspace file folder by path', { error })
    return { success: false, ...fileFolderPathError(error) }
  }
}

export async function performDeleteWorkspaceFileFolderByPath(params: {
  workspaceId: string
  userId: string
  path: string
  recursive: boolean
}): Promise<PerformDeleteFileFolderByPathResult> {
  try {
    const deletedItems = await deleteWorkspaceFileFolderByPath(params)
    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      description: `Deleted file folder "${params.path}"`,
      metadata: { path: params.path, affected: deletedItems },
    })
    await notifyWorkspaceFilesChanged(params.workspaceId)
    return { success: true, deletedItems }
  } catch (error) {
    logger.error('Failed to delete workspace file folder by path', { error })
    return { success: false, ...fileFolderPathError(error) }
  }
}

export async function performDeleteWorkspaceFileItems(
  params: PerformDeleteWorkspaceFileItemsParams
): Promise<PerformDeleteWorkspaceFileItemsResult> {
  const { workspaceId, userId, fileIds = [], folderIds = [], request } = params

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
        request,
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
        request,
      })
    }

    await notifyWorkspaceFilesChanged(workspaceId)
    return { success: true, deletedItems }
  } catch (error) {
    logger.error('Failed to delete workspace file items', { error })
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export async function performMoveWorkspaceFileItems(
  params: PerformMoveWorkspaceFileItemsParams
): Promise<PerformMoveWorkspaceFileItemsResult> {
  const {
    workspaceId,
    userId,
    fileIds = [],
    folderIds = [],
    targetFolderId,
    targetFolderPath,
  } = params

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
      targetFolderPath,
    })
    const movedItems = { files: moved.movedFiles, folders: moved.movedFolders }

    logger.info('Moved workspace file items', {
      workspaceId,
      fileIds,
      folderIds,
      targetFolderId,
      targetFolderPath,
      movedItems,
    })

    if (fileIds.length > 0) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FILE_MOVED,
        resourceType: AuditResourceType.FILE,
        description: `Moved ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}${targetFolderId || (targetFolderPath && targetFolderPath !== '/') ? ' to folder' : ' to root'}`,
        metadata: { fileIds, targetFolderId, targetFolderPath },
      })
    }

    if (folderIds.length > 0) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FOLDER_MOVED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folderIds.length === 1 ? folderIds[0] : undefined,
        description: `Moved ${folderIds.length} file folder${folderIds.length === 1 ? '' : 's'}${targetFolderId || (targetFolderPath && targetFolderPath !== '/') ? ' to folder' : ' to root'}`,
        metadata: { folderIds, targetFolderId, targetFolderPath },
      })
    }

    await notifyWorkspaceFilesChanged(workspaceId)
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
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
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

    await notifyWorkspaceFilesChanged(workspaceId)
    return { success: true, file }
  } catch (error) {
    logger.error('Failed to rename workspace file', { error })
    if (error instanceof FileConflictError || getPostgresErrorCode(error) === '23505') {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export interface PerformMoveRenameWorkspaceFileParams {
  workspaceId: string
  userId: string
  fileId: string
  targetFolderId: string | null
  newName: string
}

export interface PerformMoveRenameWorkspaceFileResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  file?: WorkspaceFileRecord
}

export async function performMoveRenameWorkspaceFile(
  params: PerformMoveRenameWorkspaceFileParams
): Promise<PerformMoveRenameWorkspaceFileResult> {
  const { workspaceId, userId, fileId, targetFolderId, newName } = params

  try {
    const { file, renamed, moved } = await moveRenameWorkspaceFile({
      workspaceId,
      fileId,
      targetFolderId,
      newName,
    })
    logger.info('Moved/renamed workspace file', { workspaceId, fileId, renamed, moved })

    if (moved) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FILE_MOVED,
        resourceType: AuditResourceType.FILE,
        resourceId: fileId,
        resourceName: file.name,
        description: `Moved file "${file.name}"${targetFolderId ? ' to folder' : ' to root'}`,
        metadata: { targetFolderId },
      })
    }
    if (renamed) {
      recordAudit({
        workspaceId,
        actorId: userId,
        action: AuditAction.FILE_UPDATED,
        resourceType: AuditResourceType.FILE,
        resourceId: fileId,
        resourceName: file.name,
        description: `Renamed file to "${file.name}"`,
      })
    }

    await notifyWorkspaceFilesChanged(workspaceId)
    return { success: true, file }
  } catch (error) {
    logger.error('Failed to move/rename workspace file', { error })
    if (error instanceof FileConflictError || getPostgresErrorCode(error) === '23505') {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    if (toError(error).message.includes('not found')) {
      return { success: false, error: toError(error).message, errorCode: 'not_found' }
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

    await notifyWorkspaceFilesChanged(workspaceId)
    return { success: true }
  } catch (error) {
    logger.error('Failed to restore workspace file', { error })
    if (error instanceof FileConflictError || getPostgresErrorCode(error) === '23505') {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
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

    await notifyWorkspaceFilesChanged(workspaceId)
    return { success: true, folder }
  } catch (error) {
    logger.error('Failed to create workspace file folder', { error })
    if (
      error instanceof WorkspaceFileFolderConflictError ||
      getPostgresErrorCode(error) === '23505'
    ) {
      return { success: false, error: toError(error).message, errorCode: 'conflict' }
    }
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
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

    await notifyWorkspaceFilesChanged(workspaceId)
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
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
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

    await notifyWorkspaceFilesChanged(workspaceId)
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
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
    }
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}
