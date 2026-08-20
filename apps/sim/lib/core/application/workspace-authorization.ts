import {
  type DelegatedPrincipal,
  type Principal,
  resolvePrincipalSubject,
} from '@sim/auth/principal'
import type { db } from '@sim/db'
import {
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
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

export class InsufficientWorkspacePermissionsError extends ForbiddenOperationError {
  constructor() {
    super('INSUFFICIENT_WORKSPACE_ROLE', 'Insufficient workspace permissions')
    this.name = 'InsufficientWorkspacePermissionsError'
  }
}

/**
 * No reach into the workspace at all. Carries no `detailCode` on purpose: the v2
 * surface conceals this as a `404`, and a code would restate the resource's
 * existence that the concealment withholds. The message stays identical to
 * {@link InsufficientWorkspacePermissionsError} for the same reason.
 */
export class NoWorkspaceAccessError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Insufficient workspace permissions')
    this.name = 'NoWorkspaceAccessError'
  }
}

export class PersonalApiKeysDisabledError extends ForbiddenOperationError {
  constructor() {
    super('PERSONAL_API_KEYS_DISABLED', 'Personal API keys are not allowed for this workspace')
    this.name = 'PersonalApiKeysDisabledError'
  }
}

export class WorkspaceApiKeyAuthorizationError extends ForbiddenOperationError {
  constructor() {
    super(
      'WORKSPACE_KEY_OPERATION_NOT_PERMITTED',
      'Workspace API key cannot perform this operation'
    )
    this.name = 'WorkspaceApiKeyAuthorizationError'
  }
}

/** Concealed as a `404`; see {@link NoWorkspaceAccessError} for why it has no code. */
export class WorkspaceApiKeyScopeAuthorizationError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Workspace API key cannot access this workspace')
    this.name = 'WorkspaceApiKeyScopeAuthorizationError'
  }
}

/** Concealed as a `404`; see {@link NoWorkspaceAccessError} for why it has no code. */
export class DelegatedWorkspaceAuthorizationError extends OrchestrationError {
  constructor() {
    super('forbidden', 'Delegated workspace access is no longer valid')
    this.name = 'DelegatedWorkspaceAuthorizationError'
  }
}

export class PrincipalKindAuthorizationError extends ForbiddenOperationError {
  constructor(principalKind: Principal['kind'], operationId: string) {
    super(
      'PRINCIPAL_KIND_NOT_PERMITTED',
      `Principal kind ${principalKind} cannot perform operation ${operationId}`
    )
    this.name = 'PrincipalKindAuthorizationError'
  }
}

/**
 * Only a delegated principal can raise this, and no delegated principal reaches
 * `/api/v2` — the surface authenticates API keys only — so it carries no v2
 * `detailCode`.
 */
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
    /**
     * A workspace key refused because the operation does not delegate to one is
     * the case {@link WorkspaceApiKeyAuthorizationError} exists to name, and the
     * one the `WORKSPACE_API_KEY_DENIED` OpenAPI sentence promises. It has to be
     * separated here rather than left to `authorizeWorkspaceOperation`: an
     * operation that denies workspace keys also omits `workspace_api_key` from
     * `principalKinds` — `defineWorkspaceOperation` enforces that the two agree
     * — so this guard always fires first and the later branch can never see such
     * a principal. Reported as the generic kind refusal, a client branching on
     * the published `WORKSPACE_KEY_OPERATION_NOT_PERMITTED` never matched.
     */
    if (principal.kind === 'workspace_api_key' && operation.workspaceApiKey === 'deny') {
      throw new WorkspaceApiKeyAuthorizationError()
    }
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
      const subject = resolvePrincipalSubject(principal)
      if (subject?.kind === 'sim_user') {
        await requireCurrentHumanPermission(subject.userId, context, operation.minimumRole, options)
        return
      }
      if (principal.serviceId !== 'executor') {
        throw new DelegatedWorkspaceAuthorizationError()
      }
      return
    }
  }
}
