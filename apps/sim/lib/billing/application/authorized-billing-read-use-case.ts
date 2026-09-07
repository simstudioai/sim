import { isUserCredentialPrincipal, type Principal } from '@sim/auth/principal'
import {
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import { SIM_CLI_CLIENT_ID } from '@/lib/auth/oauth-provider'
import type {
  BillingReadOperation,
  BillingReadPrincipal,
} from '@/lib/billing/application/operations'
import { type OperationUseCase, requireUserCredentialCapabilities } from '@/lib/core/application'
import { requireOAuthOperationScope } from '@/lib/core/application/oauth-authorization'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { isCapabilityWithheldForUser } from '@/lib/permission-groups/user-scope.server'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

export type BillingReadScope =
  | { kind: 'account'; userId: string }
  | { kind: 'workspace'; workspace: ActiveWorkspaceApplicationContext }

interface AuthorizedBillingReadContext<O extends BillingReadOperation, I> {
  principal: BillingReadPrincipal
  operation: O
  input: I
  scope: BillingReadScope
}

interface AuthorizedBillingReadDefinition<O extends BillingReadOperation, I, R> {
  operation: O
  requestedWorkspaceId(input: I): string | undefined
  execute(args: AuthorizedBillingReadContext<O, I>): Promise<R>
}

function requireBillingReadPrincipal(
  principal: Principal,
  operation: BillingReadOperation
): asserts principal is BillingReadPrincipal {
  if (!operation.principalKinds.some((kind) => kind === principal.kind)) {
    throw new PrincipalKindAuthorizationError(principal.kind, operation.id)
  }
}

async function resolveBillingReadScope(
  principal: BillingReadPrincipal,
  operation: BillingReadOperation,
  requestedWorkspaceId: string | undefined
): Promise<BillingReadScope> {
  if (principal.kind === 'workspace_api_key') {
    if (requestedWorkspaceId && requestedWorkspaceId !== principal.workspaceId) {
      /**
       * A cross-tenant refusal, so it must not explain itself: naming the cause
       * would confirm the named workspace exists to a key that was never scoped
       * to it. The billing routes conceal this class as a `404`, which is also
       * the answer a workspace id that does not exist gets, so the two are
       * indistinguishable — see `createV2ResourceConcealmentPolicy`.
       */
      throw new WorkspaceApiKeyScopeAuthorizationError()
    }
  } else if (!requestedWorkspaceId) {
    /**
     * permission-group-enforced: personal_api_key.use — the account-scoped read
     * names no workspace, so nothing above resolved a group for it and the
     * workspace branch's check below never runs.
     *
     * `personal_api_key.use` refuses a *principal kind* rather than a capability
     * of the resource, so it applies to every operation a personal key can
     * reach — including the one that happens to carry no workspace. Left out,
     * the narrower scope would be the guarded one: the same key an organization
     * withholds from `GET /billing?workspaceId=…` would still read the account's
     * plan, balance and usage by omitting the parameter.
     *
     * Resolved from the organization's default group, the fallback
     * {@link isCapabilityWithheldForUser} defines for a user-global action —
     * the same one the personal-API-key and CLI mint paths use. A no-op when the
     * caller is in no organization or no group governs them.
     */
    if (isUserCredentialPrincipal(principal)) {
      if (await isCapabilityWithheldForUser(principal.userId, 'personal_api_key.use')) {
        throw new PersonalApiKeysDisabledError()
      }
      /**
       * permission-group-enforced: cli.use — a CLI token reads the account's
       * plan, balance and usage here without naming a workspace, so the
       * workspace-scoped check in the funnel never sees it.
       */
      if (
        principal.kind === 'oauth_access_token' &&
        principal.clientId === SIM_CLI_CLIENT_ID &&
        (await isCapabilityWithheldForUser(principal.userId, 'cli.use'))
      ) {
        refuseCapability('cli.use')
      }
    }
    return { kind: 'account', userId: principal.userId }
  }

  const workspaceId =
    principal.kind === 'workspace_api_key' ? principal.workspaceId : requestedWorkspaceId
  if (!workspaceId) throw new Error(`Billing operation ${operation.id} lost its workspace scope`)

  const workspace = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')

  if (isUserCredentialPrincipal(principal)) {
    if (!workspace.allowPersonalApiKeys) {
      throw new PersonalApiKeysDisabledError()
    }
    const permission = await resolveEffectiveWorkspacePermission(
      principal.userId,
      workspace.workspaceId,
      workspace.workspaceOrganizationId
    )
    if (permission === null) throw new NoWorkspaceAccessError()
    if (!permissionSatisfies(permission, operation.workspaceMinimumRole)) {
      throw new InsufficientWorkspacePermissionsError()
    }
    /**
     * permission-group-enforced: personal_api_key.use, cli.use — this path
     * resolves its own workspace scope instead of running through
     * `authorizeWorkspaceOperation`, so the funnel's capability refusals have
     * to be repeated here or the same credential the funnel refuses still
     * reads billing.
     *
     * After the role check, like the funnel: it answers with a 403 naming how an
     * organization configured one cohort, and running it ahead of the concealed
     * no-access refusal would hand that to a caller with no reach into the
     * workspace at all.
     */
    await requireUserCredentialCapabilities(principal, workspace)
  }

  return { kind: 'workspace', workspace }
}

export function defineAuthorizedBillingReadUseCase<const O extends BillingReadOperation, I, R>(
  definition: AuthorizedBillingReadDefinition<O, I, R>
): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input }) {
      requireBillingReadPrincipal(principal, definition.operation)
      requireOAuthOperationScope(principal, definition.operation)
      const scope = await resolveBillingReadScope(
        principal,
        definition.operation,
        definition.requestedWorkspaceId(input)
      )
      return definition.execute({ principal, operation: definition.operation, input, scope })
    },
  }
}
