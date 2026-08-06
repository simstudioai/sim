import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  asOrchestrationError,
  type OrchestrationErrorCode,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  ContentVersionConflictError,
  updateWorkspaceFileContent,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace'
import { EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

const logger = createLogger('WorkspaceFileContentOrchestration')

/** Ceiling on a single content replace, independent of the workspace quota. */
export const MAX_WORKSPACE_FILE_CONTENT_BYTES = 50 * 1024 * 1024

/** JSON-body ceiling with room for a 50 MiB file's base64 expansion and envelope. */
export const MAX_WORKSPACE_FILE_INLINE_BODY_BYTES = 70 * 1024 * 1024

export interface PerformUpdateWorkspaceFileContentParams {
  workspaceId: string
  fileId: string
  userId: string
  content: string
  encoding: 'utf-8' | 'base64'
  actorName?: string
  actorEmail?: string
  request?: OrchestrationRequestContext
}

export interface PerformUpdateWorkspaceFileContentResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  file?: WorkspaceFileRecord
}

/**
 * Replaces a workspace file's bytes.
 *
 * Failures are classified rather than message-matched: the manager throws a
 * classified `not_found`, the storage ledger throws `StorageLimitExceededError`
 * (a `payload_too_large` {@link OrchestrationError}), and both reach here through
 * `asOrchestrationError`, which walks the `cause` chain past drizzle's
 * transaction wrapper.
 */
export async function performUpdateWorkspaceFileContent(
  params: PerformUpdateWorkspaceFileContentParams
): Promise<PerformUpdateWorkspaceFileContentResult> {
  const { workspaceId, fileId, userId, content, encoding, actorName, actorEmail, request } = params

  const buffer = Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf-8')

  if (buffer.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
    return {
      success: false,
      error: `File size exceeds ${MAX_WORKSPACE_FILE_CONTENT_BYTES / 1024 / 1024}MB limit`,
      errorCode: 'payload_too_large',
    }
  }

  try {
    const file = await updateWorkspaceFileContent(workspaceId, fileId, userId, buffer, undefined, {
      secretProvenancePolicy: {
        mode: 'replace',
        provenance: EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE,
      },
    })

    logger.info('Updated workspace file content', { workspaceId, fileId, size: buffer.length })

    recordAudit({
      workspaceId,
      actorId: userId,
      actorName,
      actorEmail,
      action: AuditAction.FILE_UPDATED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileId,
      resourceName: file.name,
      description: `Updated content of file "${file.name}"`,
      metadata: { contentSize: buffer.length },
      request,
    })

    return { success: true, file }
  } catch (error) {
    const classified = asOrchestrationError(error)
    if (classified) {
      logger.warn('Workspace file content update rejected', {
        workspaceId,
        fileId,
        errorCode: classified.code,
      })
      return { success: false, error: classified.message, errorCode: classified.code }
    }
    if (error instanceof ContentVersionConflictError) {
      return { success: false, error: error.message, errorCode: 'conflict' }
    }
    logger.error('Failed to update workspace file content', { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}
