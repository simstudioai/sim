import type { DelegatedPrincipal } from '@sim/auth/principal'
import type { FunctionExecuteBody } from '@/lib/api/contracts'
import type { InternalSandboxProfile } from '@/lib/auth/internal'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { serializeExecutionDeadlineHeader } from '@/lib/execution/execution-deadline-header'
import { FUNCTION_EXECUTION_DELEGATION_AUDIENCE } from '@/lib/function-execution/application/authorization'
import { executeFunction } from '@/lib/function-execution/application/execute-function'
import { createExecutorPrincipalFromExecutionContext } from '@/lib/internal/principals/executor'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

export type TrustedFunctionToolExecutionContext = InternalToolOperationContext & {
  workspaceId: string
}

export interface ExecuteFunctionToolInput {
  body: FunctionExecuteBody
  headers: Headers
  context: TrustedFunctionToolExecutionContext
  requestId: string
  signal?: AbortSignal
  sandboxProfile?: InternalSandboxProfile
}

/** Executes a Function tool with authority taken only from trusted server execution context. */
export async function executeFunctionTool(input: ExecuteFunctionToolInput): Promise<Response> {
  const { body, context, headers, requestId, signal, sandboxProfile } = input
  const issuedAt = new Date()
  const serializedDeadline = serializeExecutionDeadlineHeader(signal)
  const requestedTimeout =
    typeof body.timeout === 'number' ? body.timeout : DEFAULT_EXECUTION_TIMEOUT_MS
  const expiresAt = serializedDeadline
    ? new Date(Number(serializedDeadline))
    : new Date(issuedAt.getTime() + requestedTimeout)
  const trustedBody: FunctionExecuteBody = {
    ...body,
    workflowId: context.workflowId,
    executionId: context.executionId,
    userId: undefined,
    workspaceId: context.workspaceId,
    largeValueExecutionIds: context.largeValueExecutionIds,
    largeValueKeys: context.largeValueKeys,
    fileKeys: context.fileKeys,
    allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
  }
  let principal: DelegatedPrincipal
  if (context.copilotToolExecution === true) {
    if (!context.userId) throw new Error('Copilot Function execution requires a user')
    principal = {
      kind: 'delegated',
      serviceId: 'copilot',
      subjectUserId: context.userId,
      workspaceId: context.workspaceId,
      delegationId: `function-execute:${requestId}`,
      audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
      issuedAt,
      expiresAt,
      ...(context.executionId ? { resourceScope: { executionId: context.executionId } } : {}),
    }
  } else {
    principal = await createExecutorPrincipalFromExecutionContext({
      context,
      audience: FUNCTION_EXECUTION_DELEGATION_AUDIENCE,
      expiresAt,
      ...(context.executionId ? { resourceScope: { executionId: context.executionId } } : {}),
    })
  }

  return executeFunction.execute({
    principal,
    input: {
      workspaceId: context.workspaceId,
      body: trustedBody,
      headers,
      ...(signal ? { signal } : {}),
      ...(sandboxProfile ? { sandboxProfile } : {}),
    },
  })
}
