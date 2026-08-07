import type { Principal } from '@sim/auth/principal'
import type { db } from '@sim/db'
import {
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { WorkspaceOperation } from '@/lib/workspace-files/application/operations'

export const WORKSPACE_FILES_DELEGATION_AUDIENCE = 'sim:workspace-files'

export interface WorkspaceAuthorizationContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  fileId?: string
}

function requirePermission(permission: PermissionType | null, required: PermissionType): void {
  if (!permissionSatisfies(permission, required)) {
    throw new OrchestrationError('forbidden', 'Insufficient workspace permissions')
  }
}

async function requireCurrentHumanPermission(
  userId: string,
  context: WorkspaceAuthorizationContext,
  required: PermissionType,
  options?: WorkspaceAuthorizationOptions
): Promise<void> {
  const permission = await resolveEffectiveWorkspacePermission(
    userId,
    context.workspaceId,
    context.workspaceOrganizationId,
    options?.executor,
    { forUpdate: options?.forUpdate }
  )
  requirePermission(permission, required)
}

export interface WorkspaceAuthorizationOptions {
  executor?: Pick<typeof db, 'select'>
  forUpdate?: boolean
}

export async function authorizeWorkspaceOperation(
  principal: Principal,
  operation: WorkspaceOperation,
  context: WorkspaceAuthorizationContext,
  options?: WorkspaceAuthorizationOptions
): Promise<void> {
  switch (principal.kind) {
    case 'session':
      await requireCurrentHumanPermission(principal.userId, context, operation.minimumRole, options)
      return
    case 'personal_api_key':
      if (!context.allowPersonalApiKeys) {
        throw new OrchestrationError(
          'forbidden',
          'Personal API keys are disabled for this workspace'
        )
      }
      await requireCurrentHumanPermission(principal.userId, context, operation.minimumRole, options)
      return
    case 'workspace_api_key':
      if (
        principal.workspaceId !== context.workspaceId ||
        operation.workspaceApiKey !== 'allow' ||
        !permissionSatisfies('write', operation.minimumRole)
      ) {
        throw new OrchestrationError('forbidden', 'Workspace API key cannot perform this operation')
      }
      return
    case 'delegated':
      if (
        principal.audience !== WORKSPACE_FILES_DELEGATION_AUDIENCE ||
        principal.expiresAt.getTime() <= Date.now() ||
        principal.workspaceId !== context.workspaceId ||
        (principal.resourceScope?.fileId !== undefined &&
          principal.resourceScope.fileId !== context.fileId)
      ) {
        throw new OrchestrationError('forbidden', 'Delegated file access is no longer valid')
      }
      await requireCurrentHumanPermission(
        principal.subjectUserId,
        context,
        operation.minimumRole,
        options
      )
      return
  }
}
