import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode, toError } from '@sim/utils/errors'
import {
  asOrchestrationError,
  type OrchestrationErrorCode,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  FileConflictError,
  uploadWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from '@/lib/workspace-files/orchestration/content'

const logger = createLogger('WorkspaceFileCreateOrchestration')

export interface PerformCreateWorkspaceFileParams {
  workspaceId: string
  userId: string
  name: string
  contentType: string
  folderId?: string | null
  content?: Buffer
  exactName?: boolean
  actorName?: string
  actorEmail?: string
  request?: OrchestrationRequestContext
}

export interface PerformCreateWorkspaceFileResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  file?: WorkspaceFileRecord
}

/**
 * Creates a workspace file from server-held bytes and returns its canonical record.
 *
 * Exact-name mode keeps this operation suitable for public create surfaces: a
 * live sibling with the requested name is a conflict instead of silently
 * producing a suffixed copy. Uploads remain the storage and accounting
 * primitive, including for an empty buffer.
 */
export async function performCreateWorkspaceFile(
  params: PerformCreateWorkspaceFileParams
): Promise<PerformCreateWorkspaceFileResult> {
  const {
    workspaceId,
    userId,
    name,
    contentType,
    folderId,
    content = Buffer.alloc(0),
    exactName = true,
    actorName,
    actorEmail,
    request,
  } = params

  if (content.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
    return {
      success: false,
      error: `File size exceeds ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB limit`,
      errorCode: 'payload_too_large',
    }
  }

  try {
    const file = await uploadWorkspaceFile(workspaceId, userId, content, name, contentType, {
      folderId,
      exactName,
    })

    logger.info('Created workspace file', {
      workspaceId,
      fileId: file.id,
      folderId: file.folderId,
      size: file.size,
    })

    recordAudit({
      workspaceId,
      actorId: userId,
      actorName,
      actorEmail,
      action: AuditAction.FILE_UPLOADED,
      resourceType: AuditResourceType.FILE,
      resourceId: file.id,
      resourceName: file.name,
      description: `Uploaded file "${file.name}"`,
      metadata: { fileSize: file.size, fileType: file.type },
      request,
    })

    captureServerEvent(
      userId,
      'file_uploaded',
      { workspace_id: workspaceId, file_type: file.type },
      { groups: { workspace: workspaceId } }
    )

    return { success: true, file }
  } catch (error) {
    logger.error('Failed to create workspace file', { error, workspaceId, folderId })

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
