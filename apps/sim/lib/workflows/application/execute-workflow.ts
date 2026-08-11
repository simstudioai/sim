import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ExecuteWorkflowServiceResult,
  executeWorkflowService,
} from '@/lib/workflows/executor/execute-service'

export interface ExecuteWorkflowInput {
  workflowId: string
  requestId: string
  input: unknown
  executionId?: string
  includeFileBase64?: boolean
  base64MaxBytes?: number
  selectedOutputs?: string[]
  requestedTimeoutSeconds?: number
  abortSignal?: AbortSignal
  mode: 'sync' | 'async' | 'stream'
  requestHeaders: Headers
  includeThinking?: boolean
  includeToolCalls?: boolean
}

function assertedWorkspaceId(principal: Principal): string | undefined {
  return principal.kind === 'workspace_api_key' || principal.kind === 'delegated'
    ? principal.workspaceId
    : undefined
}

function authenticatesExecutionCredentials(principal: Principal): boolean {
  return principal.kind !== 'workspace_api_key'
}

export const executeWorkflowOperation = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.execute,
  resolveContext: ({ principal, input }: { principal: Principal; input: ExecuteWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkspaceId(principal),
    }),
  async execute({ principal, context, input }): Promise<ExecuteWorkflowServiceResult> {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    return executeWorkflowService({
      workflowId: context.workflowId,
      userId: attribution.attributedUserId,
      input: input.input,
      triggerType: 'api',
      requestId: input.requestId,
      executionId: input.executionId,
      useAuthenticatedUserAsActor: authenticatesExecutionCredentials(principal),
      workflowRecord: context.workflow,
      includeFileBase64: input.includeFileBase64,
      base64MaxBytes: input.base64MaxBytes,
      selectedOutputs: input.selectedOutputs,
      rateLimitCounter: input.mode === 'async' ? 'async' : 'sync',
      requestedTimeoutSeconds: input.requestedTimeoutSeconds,
      abortSignal: input.abortSignal,
      mode: input.mode,
      requestHeaders: input.requestHeaders,
      includeThinking: input.includeThinking,
      includeToolCalls: input.includeToolCalls,
    })
  },
})
