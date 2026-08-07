import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  loadActiveWorkspaceFileContext,
  renameWorkspaceFile as renameStoredWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { authorizeWorkspaceOperation } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const logger = createLogger('RenameWorkspaceFile')

export interface RenameWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
  name: string
}

export interface RenameWorkspaceFileResult {
  file: WorkspaceFileRecord
}

interface RenameWorkspaceFileArguments {
  principal: Principal
  input: RenameWorkspaceFileInput
  request?: OrchestrationRequestContext
}

async function executeRenameWorkspaceFile({
  principal,
  input,
  request,
}: RenameWorkspaceFileArguments): Promise<RenameWorkspaceFileResult> {
  const canonical = await loadActiveWorkspaceFileContext(input.fileId)
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }

  await authorizeWorkspaceOperation(principal, fileOperations.rename, {
    workspaceId: canonical.workspaceId,
    workspaceOrganizationId: canonical.workspaceOrganizationId,
    allowPersonalApiKeys: canonical.allowPersonalApiKeys,
    fileId: canonical.fileId,
  })

  const attribution = resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: canonical.billedAccountUserId,
  })
  const file = await renameStoredWorkspaceFile(canonical.workspaceId, canonical.fileId, input.name)
  const workspaceId = canonical.workspaceId

  logger.info('Renamed workspace file', {
    workspaceId,
    fileId: input.fileId,
    name: file.name,
    principalKind: principal.kind,
  })
  recordAudit({
    workspaceId,
    actorId: attribution.attributedUserId,
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: file.id,
    resourceName: file.name,
    description: `Renamed file to "${file.name}"`,
    metadata: {
      operation: fileOperations.rename.id,
      actor: attribution.actor,
    },
    request,
  })
  await notifyWorkspaceFilesChanged(workspaceId)
  return { file }
}

export const renameWorkspaceFile = {
  operation: fileOperations.rename,
  execute: executeRenameWorkspaceFile,
} as const
