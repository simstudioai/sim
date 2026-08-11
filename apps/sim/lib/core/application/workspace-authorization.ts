import type { DelegatedPrincipal, Principal } from '@sim/auth/principal'
import type { db } from '@sim/db'
import {
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import type {
  PrincipalForOperation,
  WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
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

export class InsufficientWorkspacePermissionsError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Insufficient workspace permissions')
    this.name = 'InsufficientWorkspacePermissionsError'
  }
}

export class NoWorkspaceAccessError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Insufficient workspace permissions')
    this.name = 'NoWorkspaceAccessError'
  }
}

export class PersonalApiKeysDisabledError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Personal API keys are not allowed for this workspace')
    this.name = 'PersonalApiKeysDisabledError'
  }
}

export class WorkspaceApiKeyAuthorizationError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Workspace API key cannot perform this operation')
    this.name = 'WorkspaceApiKeyAuthorizationError'
  }
}

export class WorkspaceApiKeyScopeAuthorizationError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Workspace API key cannot access this workspace')
    this.name = 'WorkspaceApiKeyScopeAuthorizationError'
  }
}

export class DelegatedWorkspaceAuthorizationError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Delegated workspace access is no longer valid')
    this.name = 'DelegatedWorkspaceAuthorizationError'
  }
}

export class PrincipalKindAuthorizationError extends OrchestrationError {
  constructor(principalKind: Principal['kind'], operationId: string) {
    super('forbidden', `Principal kind ${principalKind} cannot perform operation ${operationId}`)
    this.name = 'PrincipalKindAuthorizationError'
  }
}

export class DelegatedServiceAuthorizationError extends OrchestrationError {
  constructor(serviceId: DelegatedPrincipal['serviceId'], operationId: string) {
    super('forbidden', `Delegated service ${serviceId} cannot perform operation ${operationId}`)
    this.name = 'DelegatedServiceAuthorizationError'
  }
}

export function requireAllowedWorkspacePrincipal<O extends WorkspaceOperation>(
  principal: Principal,
  operation: O
): asserts principal is PrincipalForOperation<O> {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  }
  if (principal.kind !== 'delegated') return

  const delegatedServices = operation.delegatedServices
  if (!delegatedServices?.length) {
    throw new Error(`Operation ${operation.id} is missing its delegated service policy`)
  }
  if (!delegatedServices.some((serviceId) => serviceId === principal.serviceId)) {
    throw new DelegatedServiceAuthorizationError(principal.serviceId, operation.id)
  }
}

function requirePermission(permission: PermissionType | null, required: PermissionType): void {
  if (permission === null) {
    throw new NoWorkspaceAccessError()
  }
  if (!permissionSatisfies(permission, required)) {
    throw new InsufficientWorkspacePermissionsError()
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
  requireAllowedWorkspacePrincipal(principal, operation)

  switch (principal.kind) {
    case 'session':
      await requireCurrentHumanPermission(principal.userId, context, operation.minimumRole, options)
      return
    case 'personal_api_key':
      if (!context.allowPersonalApiKeys) {
        throw new PersonalApiKeysDisabledError()
      }
      await requireCurrentHumanPermission(principal.userId, context, operation.minimumRole, options)
      return
    case 'workspace_api_key':
      if (principal.workspaceId !== context.workspaceId) {
        throw new WorkspaceApiKeyScopeAuthorizationError()
      }
      if (
        operation.workspaceApiKey !== 'allow' ||
        !permissionSatisfies('write', operation.minimumRole)
      ) {
        throw new WorkspaceApiKeyAuthorizationError()
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
        throw new DelegatedWorkspaceAuthorizationError()
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
