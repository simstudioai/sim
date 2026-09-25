import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ExecuteWorkflowServiceResult,
  executeWorkflowService,
} from '@/lib/workflows/executor/execute-service'
import {
  loadDeployedWorkflowState,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'
import { resolveDeploymentTriggerBlockId } from '@/lib/workflows/triggers/deployment-entry'

export interface ExecuteWorkflowInput {
  workflowId: string
  requestId: string
  input: unknown
  executionId?: string
  includeFileBase64?: boolean
  base64MaxBytes?: number
  selectedOutputs?: string[]
  triggerBlockId?: string
  stopAfterBlockId?: string
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
    let deploymentVersionId: string | undefined
    let triggerBlockId: string | undefined
    if (context.workflow.isDeployed) {
      try {
        const deployed = await loadDeployedWorkflowState(context.workflowId, context.workspaceId)
        deploymentVersionId = deployed.deploymentVersionId
        triggerBlockId = resolveDeploymentTriggerBlockId(deployed.blocks, input.triggerBlockId)
      } catch (error) {
        if (error instanceof NoActiveDeploymentError) {
          throw new OrchestrationError(
            'validation',
            'The workflow has no active deployment. Deploy it before running.'
          )
        }
        throw error
      }
    }
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    return executeWorkflowService({
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
      includeFileBase64: input.includeFileBase64,
      base64MaxBytes: input.base64MaxBytes,
      selectedOutputs: input.selectedOutputs,
      triggerBlockId,
      deploymentVersionId,
      stopAfterBlockId: input.stopAfterBlockId,
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
