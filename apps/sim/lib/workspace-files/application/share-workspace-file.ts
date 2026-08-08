import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { ShareAuthType, ShareRecord } from '@/lib/api/contracts/public-shares'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getShareForResource,
  ShareValidationError,
  upsertFileShare,
} from '@/lib/public-shares/share-manager'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
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

function requireWorkspaceFileShareUserId(principal: Principal): string {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
      return principal.userId
    case 'delegated':
      return principal.subjectUserId
    case 'workspace_api_key':
      throw new OrchestrationError(
        'forbidden',
        'Workspace API keys cannot change public file sharing'
      )
  }
}

async function executeGetWorkspaceFileShare({
  principal,
  input,
}: {
  principal: Principal
  input: GetWorkspaceFileShareInput
}): Promise<GetWorkspaceFileShareResult> {
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.readShare,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  const share = await getShareForResource('file', canonical.fileId)
  return { share }
}

async function executeUpdateWorkspaceFileShare({
  principal,
  input,
  request,
}: {
  principal: Principal
  input: UpdateWorkspaceFileShareInput
  request?: OrchestrationRequestContext
}): Promise<UpdateWorkspaceFileShareResult> {
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.updateShare,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })
  const file = await getWorkspaceFile(canonical.workspaceId, canonical.fileId, {
    throwOnError: true,
  })
  if (!file) throw new OrchestrationError('not_found', 'File not found')

  const existingShare = await getShareForResource('file', canonical.fileId)
  if (input.noOpIfInactive && !input.isActive && !existingShare?.isActive) {
    throw new WorkspaceFileShareNoopError()
  }

  if (input.isActive) {
    const effectiveAuthType = input.authType ?? existingShare?.authType ?? 'public'
    try {
      const subjectUserId = requireWorkspaceFileShareUserId(principal)
      await validatePublicFileSharing(subjectUserId, canonical.workspaceId, effectiveAuthType)
    } catch (error) {
      if (error instanceof PublicFileSharingNotAllowedError)
        throw new OrchestrationError('forbidden', error.message)
      throw error
    }
  }

  let share: ShareRecord
  try {
    share = await upsertFileShare({
      workspaceId: canonical.workspaceId,
      fileId: canonical.fileId,
      userId: requireWorkspaceFileShareUserId(principal),
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

  const auditAttribution = resolvePrincipalAuditAttribution(principal)
  recordAudit({
    workspaceId: canonical.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: input.isActive ? AuditAction.FILE_SHARED : AuditAction.FILE_SHARE_DISABLED,
    resourceType: AuditResourceType.FILE,
    resourceId: canonical.fileId,
    resourceName: file.name,
    description: `${input.isActive ? 'Enabled' : 'Disabled'} public share for "${file.name}"`,
    metadata: { operation: fileOperations.updateShare.id, actor: auditAttribution.actor },
    request,
  })
  logger.info(`${input.isActive ? 'Enabled' : 'Disabled'} share for workspace file`, {
    workspaceId: canonical.workspaceId,
    fileId: canonical.fileId,
    principalKind: principal.kind,
  })
  return { share }
}

export const getWorkspaceFileShare = {
  operation: fileOperations.readShare,
  execute: executeGetWorkspaceFileShare,
} as const

export const updateWorkspaceFileShare = {
  operation: fileOperations.updateShare,
  execute: executeUpdateWorkspaceFileShare,
} as const
