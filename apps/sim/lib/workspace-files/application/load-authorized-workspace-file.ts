import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceFileContext,
  loadActiveWorkspaceFileContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { authorizeWorkspaceOperation } from '@/lib/workspace-files/application/authorization'
import type { WorkspaceOperation } from '@/lib/workspace-files/application/operations'

interface LoadAuthorizedWorkspaceFileArgs {
  principal: Principal
  operation: WorkspaceOperation
  fileId: string
  assertedWorkspaceId?: string
  includeDeleted?: boolean
}

export async function loadAuthorizedWorkspaceFile({
  principal,
  operation,
  fileId,
  assertedWorkspaceId,
  includeDeleted,
}: LoadAuthorizedWorkspaceFileArgs): Promise<ActiveWorkspaceFileContext> {
  const canonical = await loadActiveWorkspaceFileContext(fileId, { includeDeleted })
  if (
    !canonical ||
    (assertedWorkspaceId !== undefined && assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', 'File not found')
  }

  await authorizeWorkspaceOperation(principal, operation, {
    workspaceId: canonical.workspaceId,
    workspaceOrganizationId: canonical.workspaceOrganizationId,
    allowPersonalApiKeys: canonical.allowPersonalApiKeys,
    fileId: canonical.fileId,
  })

  return canonical
}
