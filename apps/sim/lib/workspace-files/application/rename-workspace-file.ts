import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { type Principal, resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { notifyWorkspaceFilesChanged } from '@/lib/realtime/notify'
import {
  renameWorkspaceFile as renameStoredWorkspaceFile,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { loadAuthorizedWorkspaceFile } from '@/lib/workspace-files/application/load-authorized-workspace-file'
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
  const canonical = await loadAuthorizedWorkspaceFile({
    principal,
    operation: fileOperations.rename,
    fileId: input.fileId,
    assertedWorkspaceId: input.assertedWorkspaceId,
  })

  const auditAttribution = resolvePrincipalAuditAttribution(principal)
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
    actorId: auditAttribution.actorId,
    actorName: auditAttribution.actorName,
    action: AuditAction.FILE_UPDATED,
    resourceType: AuditResourceType.FILE,
    resourceId: file.id,
    resourceName: file.name,
    description: `Renamed file to "${file.name}"`,
    metadata: {
      operation: fileOperations.rename.id,
      actor: auditAttribution.actor,
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
