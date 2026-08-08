import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import type { db } from '@sim/db'
import {
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import type { WorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export interface WorkspaceAuthorizationContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
}

export interface WorkspaceDelegationPolicy<C extends WorkspaceAuthorizationContext> {
  audience: string
  isWithinScope(principal: DelegatedPrincipal, context: C): boolean
}

export interface WorkspaceAuthorizationOptions<C extends WorkspaceAuthorizationContext> {
  executor?: Pick<typeof db, 'select'>
  forUpdate?: boolean
  delegation?: WorkspaceDelegationPolicy<C>
}

function requirePermission(permission: PermissionType | null, required: PermissionType): void {
  if (!permissionSatisfies(permission, required)) {
    throw new OrchestrationError('forbidden', 'Insufficient workspace permissions')
  }
}

async function requireCurrentHumanPermission<C extends WorkspaceAuthorizationContext>(
  userId: string,
  context: C,
  required: PermissionType,
  options?: WorkspaceAuthorizationOptions<C>
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

export async function authorizeWorkspaceOperation<C extends WorkspaceAuthorizationContext>(
  principal: Principal,
  operation: WorkspaceOperation,
  context: C,
  options?: WorkspaceAuthorizationOptions<C>
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
    case 'delegated': {
      const delegation = options?.delegation
      if (!delegation) {
        throw new Error(`Operation ${operation.id} requires an explicit delegation policy`)
      }
      if (
        principal.audience !== delegation.audience ||
        principal.expiresAt.getTime() <= Date.now() ||
        principal.workspaceId !== context.workspaceId ||
        !delegation.isWithinScope(principal, context)
      ) {
        throw new OrchestrationError('forbidden', 'Delegated workspace access is no longer valid')
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
}
