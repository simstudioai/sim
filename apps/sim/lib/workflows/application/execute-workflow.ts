import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import {
  inlinesRunFiles,
  withholdUnadmittedInlineFiles,
} from '@/lib/workflows/application/admit-run-files'
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
  mode: 'sync' | 'async' | 'stream' | 'sync-result-stream'
  requestHeaders: Headers
  includeThinking?: boolean
  includeToolCalls?: boolean
  /**
   * Workflow call chain for this hop, already extended with the target workflow
   * id by the surface adapter. Carries the recursion guard across API hops.
   */
  callChain?: string[]
}

function authenticatesExecutionCredentials(principal: Principal): boolean {
  return principal.kind !== 'workspace_api_key'
}

export const executeWorkflowOperation = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.execute,
  resolveContext: ({ input }: { input: ExecuteWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  async execute({ principal, context, input }): Promise<ExecuteWorkflowServiceResult> {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await executeWorkflowService({
      workflowId: context.workflowId,
      principal,
      userId: attribution.attributedUserId,
      input: input.input,
      triggerType: 'api',
      requestId: input.requestId,
      executionId: input.executionId,
      callChain: input.callChain,
      useAuthenticatedUserAsActor: authenticatesExecutionCredentials(principal),
      workflowRecord: context.workflow,
      includeFileBase64: inlinesRunFiles(principal, input.includeFileBase64, input.mode),
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
    return withholdUnadmittedInlineFiles(principal, context.workspaceId, result)
  },
})
