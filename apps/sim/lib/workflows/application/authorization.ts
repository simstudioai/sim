import { type Principal, resolvePrincipalExecutionActorUserId } from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

export const WORKFLOW_DELEGATION_AUDIENCE = 'sim:workflows'

export interface WorkflowAuthorizationContext extends WorkspaceAuthorizationContext {
  workflowId?: string
  runId?: string
  billedAccountUserId: string
}

export const workflowDelegationPolicy: WorkspaceDelegationPolicy<WorkflowAuthorizationContext> = {
  audience: WORKFLOW_DELEGATION_AUDIENCE,
  isWithinScope(
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: WorkflowAuthorizationContext
  ) {
    if (principal.workspaceId !== context.workspaceId) return false
    if (principal.serviceId === 'copilot') return true
    if (principal.serviceId !== 'executor') return false
    const delegationContext = (principal as { delegationContext?: unknown }).delegationContext
    return (
      typeof delegationContext === 'object' &&
      delegationContext !== null &&
      'kind' in delegationContext &&
      delegationContext.kind === 'workflow_execution' &&
      'workflowId' in delegationContext &&
      typeof delegationContext.workflowId === 'string' &&
      delegationContext.workflowId.length > 0
    )
  },
}

/** Resolves the legacy execution actor used for user-attributed workflow writes. */
export function requireWorkflowExecutionUserId(principal: Principal): string {
  const userId = resolvePrincipalExecutionActorUserId(principal)
  if (!userId) {
    throw new OrchestrationError(
      'forbidden',
      'Workflow write requires a user subject or execution actor'
    )
  }
  return userId
}
