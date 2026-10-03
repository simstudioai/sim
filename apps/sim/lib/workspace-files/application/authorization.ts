import type { Principal } from '@sim/auth/principal'
import type { WorkspaceOperation } from '@/lib/core/application'
import {
  authorizeWorkspaceOperation,
  type WorkspaceAuthorizationContext,
  type WorkspaceAuthorizationOptions,
} from '@/lib/core/application'

export const WORKSPACE_FILES_DELEGATION_AUDIENCE = 'sim:workspace-files'

export interface WorkspaceFileAuthorizationContext extends WorkspaceAuthorizationContext {
  fileId?: string
}

export type WorkspaceFileAuthorizationOptions = Omit<
  WorkspaceAuthorizationOptions<WorkspaceFileAuthorizationContext>,
  'delegation'
>

export const workspaceFileDelegationPolicy = {
  audience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
  isWithinScope: (
    delegated: Extract<Principal, { kind: 'delegated' }>,
    canonicalContext: WorkspaceFileAuthorizationContext
  ) =>
    delegated.resourceScope?.fileId === undefined ||
    delegated.resourceScope.fileId === canonicalContext.fileId,
} as const

export async function authorizeWorkspaceFileAccess(
  principal: Principal,
  operation: WorkspaceOperation,
  context: WorkspaceFileAuthorizationContext,
  options?: WorkspaceFileAuthorizationOptions
): Promise<void> {
  await authorizeWorkspaceOperation(principal, operation, context, {
    ...options,
    delegation: workspaceFileDelegationPolicy,
  })
}
