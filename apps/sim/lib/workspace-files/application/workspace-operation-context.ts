import type { Principal } from '@sim/auth/principal'
import type { WorkspaceOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  loadWorkspaceFileOperationContext,
  type WorkspaceFileOperationContext,
} from '@/lib/uploads/contexts/workspace/workspace-file-folder-manager'
import { authorizeWorkspaceFileAccess } from '@/lib/workspace-files/application/authorization'

export interface AuthorizedWorkspaceOperationContext {
  context: WorkspaceFileOperationContext
}

export async function authorizeWorkspaceFileOperation(
  principal: Principal,
  operation: WorkspaceOperation,
  workspaceId: string,
  fileId?: string
): Promise<AuthorizedWorkspaceOperationContext> {
  const context = await loadWorkspaceFileOperationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')

  await authorizeWorkspaceFileAccess(principal, operation, {
    workspaceId: context.workspaceId,
    workspaceOrganizationId: context.workspaceOrganizationId,
    allowPersonalApiKeys: context.allowPersonalApiKeys,
    fileId,
  })

  return { context }
}
