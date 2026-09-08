import {
  type DelegatedPrincipal,
  type OAuthAccessTokenPrincipal,
  type PersonalApiKeyPrincipal,
  type Principal,
  resolvePrincipalSubject,
} from '@sim/auth/principal'
import type { db } from '@sim/db'
import {
  type PermissionType,
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import type {
  PrincipalForOperation,
  WorkspaceOperation,
} from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  assertWorkspaceCapability,
  capabilityDeniedBy,
} from '@/lib/permission-groups/capability-assertions'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'

/**
 * The person whose permission group governs `principal`, or `null` when no
 * group applies to it.
 *
 * THE one statement of that rule, for the checks that cannot ride on an
 * operation's `capability` because they need the resource in hand — an import's
 * block allowlist, a bulk download's item count. Those sites otherwise reach for
 * whatever user id is nearest, and the nearest one is usually a bystander: a
 * workspace key's creator, or the billing owner an attribution helper
 * substituted. Both would apply a stranger's group to a caller the funnel
 * deliberately passes ungated.
 *
 * Mirrors {@link authorizeWorkspaceOperation} exactly, including its executor
 * exemption: a run carries the role of whoever triggered it but not their
 * capabilities.
 */
export function capabilityGovernedPrincipalUserId(principal: Principal): string | null {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
    case 'oauth_access_token':
      return principal.userId
    case 'workspace_api_key':
    case 'system':
    case 'credential_group_enrollment':
    case 'scim_connection':
      return null
    case 'delegated': {
      if (principal.serviceId === 'executor') return null
      const subject = resolvePrincipalSubject(principal)
      return subject?.kind === 'sim_user' ? subject.userId : null
    }
  }
}

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
  requireOAuthOperationScope(principal, operation)
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
  if (capability === 'none') return
  if (context.workspaceOrganizationId === null) return

  await assertWorkspaceCapability(
    userId,
    context.workspaceId,
    capability,
    context.workspaceOrganizationId
  )
}

/**
 * Refuses a token the Sim CLI holds when the caller's group withholds CLI use.
 *
 * permission-group-enforced: cli.use — the consent page enforces it when the
 * grant is first made, but a consent already on file lets every later
 * authorization skip the consent endpoint, and a refresh token keeps minting
 * access tokens for a month. Withdrawing the capability has to stop the
 * credential in use, not only the next fresh grant, so it is asked again here,
 * on the request. The group config is request-cached and the personal-key check
 * that runs just before this one has already read it, so it costs no extra
 * query.
 *
 * Three surfaces authorize themselves instead of entering through the funnel.
 * Billing and audit-log reads repeat this check at their own call sites, since
 * both return data a withdrawn capability is meant to cut off. `/api/v2/meta`
 * does not, and should not: it answers only with facts about the credential
 * the caller already holds, so there is nothing there to withhold.
 */
export async function requireCliAccessAllowed(
  clientId: string,
  userId: string,
  context: WorkspaceAuthorizationContext
): Promise<void> {
  if (clientId !== SIM_CLI_CLIENT_ID) return
  if (context.workspaceOrganizationId === null) return

  await assertWorkspaceCapability(
    userId,
    context.workspaceId,
    'cli.use',
    context.workspaceOrganizationId
  )
}

/**
 * Enforces credential-wide restrictions after current workspace membership is established.
 * Shared by the authorization funnel and workspace billing/chat reads.
 */
export async function requireUserCredentialCapabilities(
  principal: PersonalApiKeyPrincipal | OAuthAccessTokenPrincipal,
  context: WorkspaceAuthorizationContext
): Promise<void> {
  await requirePersonalApiKeysAllowed(principal.userId, context)
  if (principal.kind === 'oauth_access_token') {
    /** permission-group-enforced: oauth_apps.use — applies to every OAuth principal after the role check. */
    if (context.workspaceOrganizationId !== null) {
      await assertWorkspaceCapability(
        principal.userId,
        context.workspaceId,
        'oauth_apps.use',
        context.workspaceOrganizationId
      )
    }
    await requireCliAccessAllowed(principal.clientId, principal.userId, context)
  }
}

export async function requirePersonalApiKeysAllowed(
  userId: string,
  context: WorkspaceAuthorizationContext
): Promise<void> {
  if (context.workspaceOrganizationId === null) return

  const config = await resolvePermissionGroupConfig(
    userId,
    context.workspaceId,
    context.workspaceOrganizationId
  )
  if (capabilityDeniedBy('personal_api_key.use', config)) throw new PersonalApiKeysDisabledError()
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
export async function requireCurrentHumanRole<C extends WorkspaceAuthorizationContext>(
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

/**
 * A use case's own escalation: refuses unless the person holds `required` in
 * the workspace right now. For an operation whose minimum role fits most of
 * its inputs but one variant needs more — a connector that crawls as every
 * enrolled member is an admin decision even though creating a connector is
 * not — so the operation keeps its role and the variant asserts its own.
 */
async function requireCurrentHumanAccess<C extends WorkspaceAuthorizationContext>(
  userId: string,
  context: C,
  operation: WorkspaceOperation,
  options?: WorkspaceAuthorizationOptions<C>
): Promise<void> {
  await requireCurrentHumanRole(userId, context, operation.minimumRole, options)
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
       *
       * The column is checked before the role, deliberately: it is a property of
       * the workspace rather than of any group, it needs no query, and refusing
       * a key the workspace has switched off is the answer whatever the caller's
       * role turns out to be. The group key is not — it runs AFTER the role
       * check, for the reason {@link requireCurrentHumanRole} gives: it answers
       * with a `403` naming how an organization configured one cohort, and
       * running it ahead of the concealed {@link NoWorkspaceAccessError} would
       * hand that to a caller with no reach into the workspace at all.
       *
       * `requireCurrentHumanAccess` is unrolled below so the group's
       * personal-key refusal sits between the role check and the operation's own
       * capability: the remedies differ, and the narrower one is worth naming
       * first.
       */
      if (!context.allowPersonalApiKeys) {
        throw new PersonalApiKeysDisabledError()
      }
      await requireCurrentHumanRole(principal.userId, context, operation.minimumRole, options)
      await requirePersonalApiKeysAllowed(principal.userId, context)
      await requireCapability(principal.userId, context, operation)
      return
    /** OAuth scopes and expiry were checked before loading protected context. */
    case 'oauth_access_token': {
      if (!context.allowPersonalApiKeys) {
        throw new PersonalApiKeysDisabledError()
      }
      await requireCurrentHumanRole(principal.userId, context, operation.minimumRole, options)
      await requireUserCredentialCapabilities(principal, context)
      await requireCapability(principal.userId, context, operation)
      return
    }
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
        /**
         * A workflow run carries the role of whoever triggered it but not their
         * capabilities. A capability names what a *person* may reach in the
         * product — the Tables module, the Files module — while a run reaches
         * those same resources because a block in the graph does, and what a run
         * may do is governed separately by `assertPermissionsAllowed`, which
         * gates every block, tool and model against the group of whoever the run
         * resolved as its actor — for a manually triggered run, the triggering
         * member.
         *
         * Applying capabilities here would mean an admin ticking "hide Tables
         * from the sidebar" silently broke every workflow with a Table block for
         * that cohort — a runtime kill-switch behind a checkbox that promises to
         * hide a nav item. Copilot is deliberately not exempt: it acts as the
         * person, so it must not reach what the person may not.
         */
        if (principal.serviceId === 'executor') {
          await requireCurrentHumanRole(subject.userId, context, operation.minimumRole, options)
          return
        }
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
       * The same reasoning with no subject at all: a deployed workflow acts on
       * the workspace's behalf rather than any one member's.
       *
       * Be careful what this does *not* say. The block, tool and model gate
       * still runs, but for an actorless run — a schedule, a webhook, a
       * workspace-key call — `useAuthenticatedUserAsActor` is false, so
       * `preprocessing.ts` falls back to `resolveSystemBillingAttribution` and
       * the actor becomes the workspace's billing owner. Those gates therefore
       * resolve the *payer's* permission group, not the workspace's and not
       * nobody's. That predates this change and is not a capability the funnel
       * can reach, but it means a member denied a tool can still reach it by
       * putting the workflow on a schedule, and a billing owner who happens to
       * sit in a restrictive group narrows every unattended run in the
       * workspace. Fixing it means deciding what a workspace itself is allowed
       * to do, which is a policy question this exemption deliberately leaves
       * open.
       */
      return
    }
  }
}
