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
    throw new OrchestrationError(
      'forbidden',
      `Principal kind ${principal.kind} cannot perform operation ${operation.id}`
    )
  }
}

async function resolveBillingReadScope(
  principal: BillingReadPrincipal,
  operation: BillingReadOperation,
  requestedWorkspaceId: string | undefined
): Promise<BillingReadScope> {
  if (principal.kind === 'workspace_api_key') {
    if (requestedWorkspaceId && requestedWorkspaceId !== principal.workspaceId) {
      throw new OrchestrationError('forbidden', 'API key is not authorized for this workspace')
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
      throw new OrchestrationError('forbidden', 'Personal API keys are disabled for this workspace')
    }
    const permission = await resolveEffectiveWorkspacePermission(
      principal.userId,
      workspace.workspaceId,
      workspace.workspaceOrganizationId
    )
    if (!permissionSatisfies(permission, operation.workspaceMinimumRole)) {
      throw new OrchestrationError('forbidden', 'Access denied')
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
