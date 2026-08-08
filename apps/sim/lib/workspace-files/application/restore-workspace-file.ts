import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  loadWorkspaceFileLifecycleContext,
  restoreWorkspaceFile,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { authorizeWorkspaceOperation } from '@/lib/workspace-files/application/authorization'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const logger = createLogger('RestoreWorkspaceFile')

export interface RestoreWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface RestoreWorkspaceFileResult {
  restored: true
}

interface RestoreWorkspaceFileArguments {
  principal: Principal
  input: RestoreWorkspaceFileInput
  request?: OrchestrationRequestContext
}

async function executeRestoreWorkspaceFile({
  principal,
  input,
  request,
}: RestoreWorkspaceFileArguments): Promise<RestoreWorkspaceFileResult> {
  const canonical = await loadWorkspaceFileLifecycleContext(input.fileId)
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }

  await authorizeWorkspaceOperation(principal, fileOperations.restore, {
    workspaceId: canonical.workspaceId,
    workspaceOrganizationId: canonical.workspaceOrganizationId,
    allowPersonalApiKeys: canonical.allowPersonalApiKeys,
    fileId: canonical.fileId,
  })

  const auditAttribution = resolvePrincipalAuditAttribution(principal)
  await restoreWorkspaceFile(canonical.workspaceId, canonical.fileId)

  recordAudit({
    workspaceId: canonical.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FILE_RESTORED,
    resourceType: AuditResourceType.FILE,
    resourceId: canonical.fileId,
    resourceName: canonical.fileId,
    description: `Restored workspace file ${canonical.fileId}`,
    metadata: { operation: fileOperations.restore.id, actor: auditAttribution.actor },
    request,
  })
  await notifyWorkspaceFilesChanged(canonical.workspaceId)
  logger.info('Restored workspace file', {
    workspaceId: canonical.workspaceId,
    fileId: canonical.fileId,
    principalKind: principal.kind,
  })
  return { restored: true }
}

export const restoreWorkspaceFileOperation = {
  operation: fileOperations.restore,
  execute: executeRestoreWorkspaceFile,
} as const
