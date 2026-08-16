import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getShareForResource,
  ShareValidationError,
  upsertFileShare,
} from '@/lib/public-shares/share-manager'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { defineAuthorizedWorkspaceFileUseCase } from '@/lib/workspace-files/application/authorized-workspace-file-use-case'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { resolveActiveWorkspaceFileContext } from '@/lib/workspace-files/application/workspace-file-context'
import {
  PublicFileSharingNotAllowedError,
  validatePublicFileSharing,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('WorkspaceFileShare')

export interface GetWorkspaceFileShareInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface GetWorkspaceFileShareResult {
  share: ShareRecord | null
}

export interface UpdateWorkspaceFileShareInput {
  fileId: string
  assertedWorkspaceId?: string
  isActive: boolean
  authType?: ShareAuthType
  password?: string
  allowedEmails?: string[]
  token?: string
  noOpIfInactive?: boolean
}

export interface UpdateWorkspaceFileShareResult {
  share: ShareRecord
}

export class WorkspaceFileShareNoopError extends Error {
  constructor() {
    super('Workspace file is not currently shared')
    this.name = 'WorkspaceFileShareNoopError'
  }
}

export const getWorkspaceFileShare = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.readShare,
  resolveContext: ({ input }: { input: GetWorkspaceFileShareInput }) =>
    resolveActiveWorkspaceFileContext(input),
  async execute({ context }): Promise<GetWorkspaceFileShareResult> {
    const share = await getShareForResource('file', context.fileId)
    return { share }
  },
})

export const updateWorkspaceFileShare = defineAuthorizedWorkspaceFileUseCase({
  operation: fileOperations.updateShare,
  async resolveContext({ input }: { input: UpdateWorkspaceFileShareInput }) {
    const canonical = await resolveActiveWorkspaceFileContext(input)
    const file = await getWorkspaceFile(canonical.workspaceId, canonical.fileId, {
      throwOnError: true,
    })
    if (!file) throw new OrchestrationError('not_found', 'File not found')
    return { ...canonical, file }
  },
  async execute({ principal, input, context }): Promise<UpdateWorkspaceFileShareResult> {
    const subjectUserId = requirePrincipalSubjectUserId(principal)

    const existingShare = await getShareForResource('file', context.fileId)
    if (input.noOpIfInactive && !input.isActive && !existingShare?.isActive) {
      throw new WorkspaceFileShareNoopError()
    }

    if (input.isActive) {
      const effectiveAuthType = input.authType ?? existingShare?.authType ?? 'public'
      try {
        await validatePublicFileSharing(subjectUserId, context.workspaceId, effectiveAuthType)
      } catch (error) {
        if (error instanceof PublicFileSharingNotAllowedError)
          throw new ForbiddenOperationError('PUBLIC_SHARING_NOT_ALLOWED', error.message)
        throw error
      }
    }

    let share: ShareRecord
    try {
      share = await upsertFileShare({
        workspaceId: context.workspaceId,
        fileId: context.fileId,
        userId: subjectUserId,
        isActive: input.isActive,
        authType: input.authType,
        password: input.password,
        allowedEmails: input.allowedEmails,
        token: input.token,
      })
    } catch (error) {
      if (error instanceof ShareValidationError) {
        throw new OrchestrationError('validation', error.message)
      }
      throw error
    }
    if (!share) throw new Error('Updating workspace file share returned no share')

    logger.info(`${input.isActive ? 'Enabled' : 'Disabled'} share for workspace file`, {
      workspaceId: context.workspaceId,
      fileId: context.fileId,
      principalKind: principal.kind,
    })
    return { share }
  },
  projectAudit: ({ input, context }) => ({
    action: input.isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
    resourceType: AuditResourceType.FILE,
    resourceId: context.fileId,
    resourceName: context.file.name,
    description: `${input.isActive ? 'Enabled' : 'Disabled'} public share for "${context.file.name}"`,
  }),
})
