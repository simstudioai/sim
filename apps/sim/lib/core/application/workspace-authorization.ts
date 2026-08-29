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
import { type ForbiddenDetailCode, ForbiddenOperationError } from '@/lib/core/application/forbidden'
import type {
  PrincipalForOperation,
  WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CAPABILITY_RULES,
  capabilityRefusalMessage,
  type PermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'

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

/**
 * The caller's permission group withholds a capability the operation needs.
 *
 * Carries the capability so a log line and an audit entry can name it; the
 * message names it for the caller. One detail code covers every capability
 * because the remedy is the same for all of them — the closed code set is
 * closed over remedies, not over causes.
 */
export class PermissionGroupCapabilityError extends ForbiddenOperationError {
  constructor(
    readonly capability: PermissionGroupCapability,
    detailCode: ForbiddenDetailCode,
    describe: string
  ) {
    super(detailCode, capabilityRefusalMessage(describe))
    this.name = 'PermissionGroupCapabilityError'
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

/**
 * Refuses an operation whose capability the caller's permission group withholds.
 *
 * Runs only for a principal that stands for a person, because a permission
 * group is a membership of users — see {@link authorizeWorkspaceOperation} for
 * why an actorless caller passes through rather than being denied.
 */
async function requireCapability(
  userId: string,
  context: WorkspaceAuthorizationContext,
  operation: WorkspaceOperation
): Promise<void> {
  const capability = operation.capability
  if (capability === undefined || capability === 'none') return
  if (context.workspaceOrganizationId === null) return

  const config = await resolvePermissionGroupConfig(
    userId,
    context.workspaceId,
    context.workspaceOrganizationId
  )
  if (!config) return

  const rule = CAPABILITY_RULES[capability]
  if (rule.kind !== 'static' || !rule.deniedBy(config)) return

  throw new PermissionGroupCapabilityError(capability, rule.detailCode, rule.describe)
}

/**
 * Refuses a personal API key the caller's permission group withholds.
 *
 * Separate from {@link requireCapability} because it is not a property of the
 * operation: no operation opts into it, and every operation a personal key can
 * reach is subject to it.
 */
async function requirePersonalApiKeysAllowed(
  userId: string,
  context: WorkspaceAuthorizationContext
): Promise<void> {
  if (context.workspaceOrganizationId === null) return

  const config = await resolvePermissionGroupConfig(
    userId,
    context.workspaceId,
    context.workspaceOrganizationId
  )
  if (config?.disablePersonalApiKeys) throw new PersonalApiKeysDisabledError()
}

/**
 * The workspace role check, then the permission-group capability check.
 *
 * Capability comes second on purpose. `requirePermission` throws
 * {@link NoWorkspaceAccessError}, which the v2 surface conceals as a `404` so a
 * non-member cannot learn the resource exists; refusing on capability first
 * would tell a complete outsider which capabilities the organization withholds.
 * It is also the cheaper check, and it names the remedy a caller can act on —
 * raising a role, rather than chasing an admin about a group setting that is
 * not why they were refused.
 */
async function requireCurrentHumanAccess<C extends WorkspaceAuthorizationContext>(
  userId: string,
  context: C,
  operation: WorkspaceOperation,
  options?: WorkspaceAuthorizationOptions<C>
): Promise<void> {
  const permission = await resolveEffectiveWorkspacePermission(
    userId,
    context.workspaceId,
    context.workspaceOrganizationId,
    options?.executor,
    { forUpdate: options?.forUpdate }
  )
  requirePermission(permission, operation.minimumRole)
  await requireCapability(userId, context, operation)
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
      await requireCurrentHumanAccess(principal.userId, context, operation, options)
      return
    case 'personal_api_key':
      /**
       * permission-group-enforced: personal_api_key.use — refuses a principal
       * kind rather than a capability of the resource, so it cannot ride on an
       * operation's `capability` the way the others do.
       *
       * The workspace column and the group key combine with AND, not override.
       * The column is the coarse switch every workspace has; the group key
       * narrows it further for one cohort inside an enterprise organization.
       * Either one saying no is a no.
       */
      if (!context.allowPersonalApiKeys) {
        throw new PersonalApiKeysDisabledError()
      }
      await requirePersonalApiKeysAllowed(principal.userId, context)
      await requireCurrentHumanAccess(principal.userId, context, operation, options)
      return
    /**
     * A workspace API key authorizes as the workspace, so there is no user and
     * therefore no permission group to resolve — the operation's `capability`
     * does not apply. Substituting the key's creator would apply a bystander's
     * group to every caller of a shared key, and would break the key outright
     * once that person left the organization. The escape is closed at the door
     * instead: minting a workspace key is itself capability-gated.
     */
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
        await requireCurrentHumanAccess(subject.userId, context, operation, options)
        return
      }
      if (
        principal.serviceId !== 'executor' ||
        principal.delegationContext?.currentWorkflow?.mode !== 'deployment'
      ) {
        throw new DelegatedWorkspaceAuthorizationError()
      }
      /**
       * A deployment run with no subject has no user, so the operation's
       * capability does not apply — a deployed workflow acts with the
       * workspace's authority, not its author's permission group, the same way
       * a service account does. Denying here would 403 every scheduled run,
       * webhook and public-API call in the organization the moment a group
       * withheld anything. What the run *does* is still governed: the executor
       * gates every block, tool and model through `assertPermissionsAllowed`.
       */
      return
    }
  }
}
