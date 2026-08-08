import type { Principal } from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'

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
    return (
      principal.workspaceId === context.workspaceId &&
      (!principal.resourceScope?.workflowId ||
        principal.resourceScope.workflowId === context.workflowId)
    )
  },
}
