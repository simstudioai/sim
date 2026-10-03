import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { asOrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  bulkArchiveWorkspaceFileItems,
  type WorkspaceFileArchiveResult,
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
