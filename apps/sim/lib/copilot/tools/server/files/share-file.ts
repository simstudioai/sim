import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import { ShareFile } from '@/lib/copilot/generated/tool-catalog-v1'
import { ensureWorkspaceAccess } from '@/lib/copilot/tools/handlers/access'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  getShareForResource,
  ShareValidationError,
  upsertFileShare,
} from '@/lib/public-shares/share-manager'
import {
  getWorkspaceFile,
  resolveWorkspaceFileReference,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  PublicFileSharingNotAllowedError,
  validatePublicFileSharing,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('ShareFileServerTool')

interface ShareFileArgs {
  path?: string
  fileId?: string
  action?: 'share' | 'unshare'
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  args?: Record<string, unknown>
}

interface ShareFileResult {
  success: boolean
  message: string
  data?: {
    url: string
    token: string
    authType: ShareAuthType
    hasPassword: boolean
    isActive: boolean
  }
}

export const shareFileServerTool: BaseServerTool<ShareFileArgs, ShareFileResult> = {
  name: ShareFile.id,
  async execute(params: ShareFileArgs, context?: ServerToolContext): Promise<ShareFileResult> {
    if (!context?.userId) {
      throw new Error('Authentication required')
    }
    const workspaceId = context.workspaceId
    if (!workspaceId) {
      return { success: false, message: 'Workspace ID is required' }
    }
    await ensureWorkspaceAccess(workspaceId, context.userId, 'write')

    const nested = params.args
    const path = params.path || (nested?.path as string) || ''
    const legacyFileId = params.fileId || (nested?.fileId as string) || ''
    const action = (params.action || (nested?.action as string) || 'share') as 'share' | 'unshare'
    const authType = (params.authType || (nested?.authType as ShareAuthType | undefined)) as
      | ShareAuthType
      | undefined
    const password = params.password || (nested?.password as string) || undefined
    const allowedEmails =
      params.allowedEmails || (nested?.allowedEmails as string[] | undefined) || undefined

    const targetRef = path || legacyFileId
    if (!targetRef) return { success: false, message: 'path is required' }

    const existingFile = path
      ? await resolveWorkspaceFileReference(workspaceId, path)
      : await getWorkspaceFile(workspaceId, legacyFileId)
    if (!existingFile) {
      return { success: false, message: `File not found: ${targetRef}` }
    }
    const fileId = existingFile.id
    const isActive = action !== 'unshare'
    const existingShare = await getShareForResource('file', fileId)

    // Unsharing a file that was never shared (or is already disabled) is a no-op:
    // never insert an inactive row, emit a FILE_SHARE_DISABLED audit, or return a
    // link claiming a share was revoked when none existed.
    if (!isActive && !existingShare?.isActive) {
      return {
        success: true,
        message: `"${existingFile.name}" isn't shared — nothing to unshare.`,
      }
    }

    // Enabling a share is gated by the org's access-control policy (both the
    // master on/off and the per-auth-type allow-list); disabling is always
    // allowed so users can still un-share after the policy is turned on.
    if (isActive) {
      // Validate the auth type that will ACTUALLY be persisted. upsertFileShare
      // falls back to the existing share's authType when none is passed, so a bare
      // re-enable must be checked against that stored mode — not 'public' — or a
      // now-disallowed password/email/sso share could be silently reactivated.
      const effectiveAuthType = authType ?? existingShare?.authType ?? 'public'
      try {
        await validatePublicFileSharing(context.userId, workspaceId, effectiveAuthType)
      } catch (error) {
        if (error instanceof PublicFileSharingNotAllowedError) {
          return { success: false, message: error.message }
        }
        throw error
      }
    }

    assertServerToolNotAborted(context)

    let share
    try {
      share = await upsertFileShare({
        workspaceId,
        fileId,
        userId: context.userId,
        isActive,
        authType,
        password,
        allowedEmails,
      })
    } catch (error) {
      if (error instanceof ShareValidationError) {
        return { success: false, message: error.message }
      }
      throw error
    }

    logger.info(`${isActive ? 'Enabled' : 'Disabled'} share for file via share_file`, {
      fileId,
      workspaceId,
      authType: share.authType,
      userId: context.userId,
    })

    recordAudit({
      workspaceId,
      actorId: context.userId,
      action: isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileId,
      resourceName: existingFile.name,
      description: `${isActive ? 'Enabled' : 'Disabled'} public share for "${existingFile.name}"`,
    })

    if (!isActive) {
      return {
        success: true,
        message: `Stopped sharing "${existingFile.name}". The previous link no longer works.`,
        data: {
          url: share.url,
          token: share.token,
          authType: share.authType,
          hasPassword: share.hasPassword,
          isActive: share.isActive,
        },
      }
    }

    const authNote =
      share.authType === 'password'
        ? ' (password-protected — share the password separately)'
        : share.authType === 'email'
          ? ' (restricted to allowed emails via one-time code)'
          : share.authType === 'sso'
            ? ' (restricted to allowed emails via SSO)'
            : ''

    return {
      success: true,
      message: `Shared "${existingFile.name}"${authNote}: ${share.url}`,
      data: {
        url: share.url,
        token: share.token,
        authType: share.authType,
        hasPassword: share.hasPassword,
        isActive: share.isActive,
      },
    }
  },
}
