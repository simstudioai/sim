import type { Principal } from '@sim/auth/principal'
import {
  permissionSatisfies,
  resolveEffectiveWorkspacePermission,
} from '@sim/platform-authz/workspace'
import type {
  BillingReadOperation,
  BillingReadPrincipal,
} from '@/lib/billing/application/operations'
import type { OperationUseCase } from '@/lib/core/application'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
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
    return { kind: 'account', userId: principal.userId }
  }

  const workspaceId =
    principal.kind === 'workspace_api_key' ? principal.workspaceId : requestedWorkspaceId
  if (!workspaceId) throw new Error(`Billing operation ${operation.id} lost its workspace scope`)

  const workspace = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!workspace) throw new OrchestrationError('not_found', 'Workspace not found')

  if (principal.kind === 'personal_api_key') {
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
      const scope = await resolveBillingReadScope(
        principal,
        definition.operation,
        definition.requestedWorkspaceId(input)
      )
      return definition.execute({ principal, operation: definition.operation, input, scope })
    },
  }
}
