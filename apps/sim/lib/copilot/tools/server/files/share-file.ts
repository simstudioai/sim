import { createLogger } from '@sim/logger'
import type { ShareAuthType } from '@/lib/api/contracts/public-shares'
import {
  executeCopilotFileUseCase,
  resolveCopilotWorkspaceFileReference,
} from '@/lib/copilot/application/execute-file-use-case'
import { messageForCopilotFileError } from '@/lib/copilot/auth/file-delegation'
import { ShareFile } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { resolveEnvReferenceSecretArg } from '@/lib/copilot/tools/server/env-reference'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { readWorkspaceFileMetadata } from '@/lib/workspace-files/application/read-workspace-file-metadata'
import {
  updateWorkspaceFileShare,
  WorkspaceFileShareNoopError,
} from '@/lib/workspace-files/application/share-workspace-file'

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
    const nested = params.args
    const path = params.path || (nested?.path as string) || ''
    const legacyFileId = params.fileId || (nested?.fileId as string) || ''
    const action = (params.action || (nested?.action as string) || 'share') as 'share' | 'unshare'
    const authType = (params.authType || (nested?.authType as ShareAuthType | undefined)) as
      | ShareAuthType
      | undefined
    const rawPassword = params.password || (nested?.password as string) || undefined
    // "Protect it with the password in {{SHARE_PW}}" arrives as the literal
    // reference — resolve it, or the placeholder becomes the real password.
    const resolvedPassword = await resolveEnvReferenceSecretArg({
      userId: context.userId,
      workspaceId: context.workspaceId,
      value: rawPassword,
      argName: 'password',
      registry: context.resolvedSecretTraceRegistry,
    })
    if (resolvedPassword.error) {
      return { success: false, message: resolvedPassword.error }
    }
    const password = resolvedPassword.value
    const allowedEmails =
      params.allowedEmails || (nested?.allowedEmails as string[] | undefined) || undefined

    const targetRef = path || legacyFileId
    if (!targetRef) return { success: false, message: 'path is required' }

    let existingFile
    try {
      existingFile = path
        ? await resolveCopilotWorkspaceFileReference(context, fileOperations.updateShare, {
            workspaceId,
            reference: path,
          })
        : (
            await executeCopilotFileUseCase(
              context,
              readWorkspaceFileMetadata,
              { fileId: legacyFileId, assertedWorkspaceId: workspaceId },
              { fileId: legacyFileId }
            )
          ).file
    } catch (error) {
      const classified = asOrchestrationError(error)
      if (classified?.code !== 'not_found') throw error
      return { success: false, message: `File not found: ${targetRef}` }
    }
    if (!existingFile) {
      return { success: false, message: `File not found: ${targetRef}` }
    }
    assertServerToolNotAborted(context)
    const isActive = action !== 'unshare'
    try {
      const result = await executeCopilotFileUseCase(
        context,
        updateWorkspaceFileShare,
        {
          fileId: existingFile.id,
          assertedWorkspaceId: workspaceId,
          isActive,
          authType,
          password,
          allowedEmails,
          noOpIfInactive: !isActive,
        },
        { fileId: existingFile.id }
      )
      const share = result.share
      logger.info(`${isActive ? 'Enabled' : 'Disabled'} share for file via share_file`, {
        fileId: existingFile.id,
        workspaceId,
        authType: share.authType,
        userId: context.userId,
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
    } catch (error) {
      if (error instanceof WorkspaceFileShareNoopError) {
        return {
          success: true,
          message: `"${existingFile.name}" isn't shared — nothing to unshare.`,
        }
      }
      return {
        success: false,
        message: messageForCopilotFileError(error, 'Unable to update file sharing'),
      }
    }
  },
}
