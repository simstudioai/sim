import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { type FunctionExecuteBody, functionExecuteBodySchema } from '@/lib/api/contracts'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { functionExecutionDelegationPolicy } from '@/lib/function-execution/application/authorization'
import { functionExecutionOperations } from '@/lib/function-execution/application/operations'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface ExecuteFunctionInput {
  workspaceId: string
  body: FunctionExecuteBody
  headers: Headers
  signal?: AbortSignal
  sandboxProfile?: 'mothership'
}

/**
 * Runs the existing Function protocol in the authenticated owner process.
 *
 * Returning a Response deliberately preserves the compatibility adapter's status, headers, and
 * private metadata while callers migrate off the HTTP transport. The Function protocol itself is
 * still parsed by its shared boundary contract before any code executes.
 */
export const executeFunction = defineAuthorizedWorkspaceUseCase({
  operation: functionExecutionOperations.execute,
  resolveContext: async ({ input }: { input: ExecuteFunctionInput }) => {
    if (input.body.workspaceId !== input.workspaceId) {
      throw new OrchestrationError('not_found', 'Workspace not found')
    }
    return {
      ...(await resolveActiveWorkspaceApplicationContext(input.workspaceId)),
      ...(input.body.executionId ? { executionId: input.body.executionId } : {}),
    }
  },
  authorizationOptions: {
    delegation: functionExecutionDelegationPolicy,
  },
  execute: async ({ principal, input }): Promise<Response> => {
    const parsedBody = functionExecuteBodySchema.safeParse(input.body)
    if (!parsedBody.success) {
      throw new OrchestrationError(
        'validation',
        parsedBody.error.issues[0]?.message ?? 'Function execution input is invalid'
      )
    }
    const { executeFunctionRequest } = await import('@/lib/function-execution/execute-request')
    return executeFunctionRequest(
      {
        headers: input.headers,
        signal: input.signal ?? new AbortController().signal,
      },
      parsedBody.data,
      {
        userId: requirePrincipalSubjectUserId(principal),
        ...(input.sandboxProfile ? { sandboxProfile: input.sandboxProfile } : {}),
      }
    )
  },
})
