import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import { deleteWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'

const logger = createLogger('DeleteWorkspaceFile')

export interface DeleteWorkspaceFileInput {
  fileId: string
  assertedWorkspaceId?: string
}

export interface DeleteWorkspaceFileResult {
  id: string
  workspaceId: string
  deleted: true
}

interface DeleteWorkspaceFileArguments {
  principal: Principal
  input: DeleteWorkspaceFileInput
  request?: OrchestrationRequestContext
}

async function executeDeleteWorkspaceFile({
  principal,
  input,
  request,
}: DeleteWorkspaceFileArguments): Promise<DeleteWorkspaceFileResult> {
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.delete,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })

  const auditAttribution = resolvePrincipalAuditAttribution(principal)
  await deleteWorkspaceFile(canonical.workspaceId, canonical.fileId)

  recordAudit({
    workspaceId: canonical.workspaceId,
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FILE_DELETED,
    resourceType: AuditResourceType.FILE,
    resourceId: canonical.fileId,
    description: `Deleted workspace file ${canonical.fileId}`,
    metadata: { operation: fileOperations.delete.id, actor: auditAttribution.actor },
    request,
  })
  await notifyWorkspaceFilesChanged(canonical.workspaceId)
  logger.info('Deleted workspace file', {
    workspaceId: canonical.workspaceId,
    fileId: canonical.fileId,
    principalKind: principal.kind,
  })
  return { id: canonical.fileId, workspaceId: canonical.workspaceId, deleted: true }
}

export const deleteWorkspaceFileOperation = {
  operation: fileOperations.delete,
  execute: executeDeleteWorkspaceFile,
} as const
