import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
import type {
  OrchestrationErrorCode,
  OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  getShareForResource,
  ShareValidationError,
  upsertFileShare,
} from '@/lib/public-shares/share-manager'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import {
  PublicFileSharingNotAllowedError,
  validatePublicFileSharing,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('WorkspaceFileShareOrchestration')

export interface PerformGetWorkspaceFileShareParams {
  workspaceId: string
  fileId: string
}

export interface PerformGetWorkspaceFileShareResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  share?: ShareRecord | null
}

export interface PerformUpsertWorkspaceFileShareParams {
  workspaceId: string
  fileId: string
  userId: string
  isActive: boolean
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  /**
   * Caller-reserved share token. Only the session UI supplies one, so it can
   * show the public link before the share is saved; the public API never does,
   * because a caller-chosen token is both guessable and able to collide with an
   * existing row's unique index. Omitted means the manager generates one.
   */
  token?: string
  actorName?: string
  actorEmail?: string
  request?: OrchestrationRequestContext
}

export interface PerformUpsertWorkspaceFileShareResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  share?: ShareRecord
}

export async function performGetWorkspaceFileShare(
  params: PerformGetWorkspaceFileShareParams
): Promise<PerformGetWorkspaceFileShareResult> {
  const { workspaceId, fileId } = params

  try {
    const file = await getWorkspaceFile(workspaceId, fileId)
    if (!file) return { success: false, error: 'File not found', errorCode: 'not_found' }

    const share = await getShareForResource('file', fileId)
    return { success: true, share }
  } catch (error) {
    logger.error('Failed to fetch workspace file share', { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

/**
 * Enables or disables a file's public share.
 *
 * Both the access-control gate and the effective-authType resolution live here
 * rather than in a route, so the session surface and the public API cannot
 * diverge on either. Disabling is deliberately never gated — a user must be able
 * to un-share after the org policy is turned on.
 *
 * Note that disabling is not revoking: {@link upsertFileShare} preserves the
 * token and the stored password / allow-list, so re-enabling resurrects the
 * identical URL.
 */
export async function performUpsertWorkspaceFileShare(
  params: PerformUpsertWorkspaceFileShareParams
): Promise<PerformUpsertWorkspaceFileShareResult> {
  const {
    workspaceId,
    fileId,
    userId,
    isActive,
    authType,
    password,
    allowedEmails,
    token,
    actorName,
    actorEmail,
    request,
  } = params

  try {
    const file = await getWorkspaceFile(workspaceId, fileId)
    if (!file) return { success: false, error: 'File not found', errorCode: 'not_found' }

    if (isActive) {
      /**
       * Validate the auth type that will ACTUALLY be persisted. `upsertFileShare`
       * falls back to the existing share's authType when none is passed, so a bare
       * re-enable must be checked against that stored mode — not `'public'` — or a
       * now-disallowed password/email/sso share could be silently reactivated.
       */
      const existingShare = await getShareForResource('file', fileId)
      const effectiveAuthType = authType ?? existingShare?.authType ?? 'public'
      try {
        await validatePublicFileSharing(userId, workspaceId, effectiveAuthType)
      } catch (error) {
        if (error instanceof PublicFileSharingNotAllowedError) {
          logger.warn('Public file sharing disabled for workspace', { workspaceId, fileId })
          return { success: false, error: error.message, errorCode: 'forbidden' }
        }
        throw error
      }
    }

    const share = await upsertFileShare({
      workspaceId,
      fileId,
      userId,
      isActive,
      authType,
      password,
      allowedEmails,
      token,
    })

    logger.info(`${isActive ? 'Enabled' : 'Disabled'} share for file ${fileId}`)

    recordAudit({
      workspaceId,
      actorId: userId,
      actorName,
      actorEmail,
      action: isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileId,
      resourceName: file.name,
      description: `${isActive ? 'Enabled' : 'Disabled'} public share for "${file.name}"`,
      request,
    })

    return { success: true, share }
  } catch (error) {
    if (error instanceof ShareValidationError) {
      return { success: false, error: error.message, errorCode: 'validation' }
    }
    logger.error('Failed to update workspace file share', { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}
