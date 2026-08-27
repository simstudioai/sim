import type { DelegatedPrincipal } from '@sim/auth/principal'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const FUNCTION_EXECUTION_DELEGATION_AUDIENCE = 'sim:function-executions'

export interface FunctionExecutionAuthorizationContext extends ActiveWorkspaceApplicationContext {
  executionId?: string
}

export const functionExecutionDelegationPolicy = {
  audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: DelegatedPrincipal,
    context: FunctionExecutionAuthorizationContext
  ): boolean => {
    const scopedExecutionId = principal.resourceScope?.executionId
    return context.executionId
      ? scopedExecutionId === context.executionId
      : scopedExecutionId === undefined
  },
}
