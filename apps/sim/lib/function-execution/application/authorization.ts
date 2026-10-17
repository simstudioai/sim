import type { WorkspaceDelegatedPrincipal } from '@sim/auth/principal'
import { workspaceDelegationRestrictions } from '@sim/auth/principal'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export const FUNCTION_EXECUTION_DELEGATION_AUDIENCE = 'sim:function-executions'

export interface FunctionExecutionAuthorizationContext extends ActiveWorkspaceApplicationContext {
  executionId?: string
}

export const functionExecutionDelegationPolicy = {
  audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: WorkspaceDelegatedPrincipal,
    context: FunctionExecutionAuthorizationContext
  ): boolean => {
    const scopedExecutionId = workspaceDelegationRestrictions(principal)?.executionId
    return context.executionId
      ? scopedExecutionId === context.executionId
      : scopedExecutionId === undefined
  },
}
