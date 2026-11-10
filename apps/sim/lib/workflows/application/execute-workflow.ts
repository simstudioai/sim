import type { Principal, WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  inlinesRunFiles,
  withholdUnadmittedInlineFiles,
} from '@/lib/workflows/application/admit-run-files'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  type ExecuteWorkflowServiceResult,
  executeWorkflowService,
} from '@/lib/workflows/executor/execute-service'
import { getWorkflowDeploymentVersionId } from '@/lib/workflows/persistence/utils'

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
  /** The caller may stop waiting and leave the run going; see `executeWorkflowService`. */
  detachable?: boolean
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

async function executeDeployedWorkflow(
  principal: WorkflowExecutionPrincipal,
  context: ActiveWorkflowApplicationContext,
  input: ExecuteWorkflowInput,
  deploymentVersionId?: string
): Promise<ExecuteWorkflowServiceResult> {
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
    deploymentVersionId,
    includeFileBase64: inlinesRunFiles(principal, input.includeFileBase64, input.mode),
    base64MaxBytes: input.base64MaxBytes,
    selectedOutputs: input.selectedOutputs,
    rateLimitCounter: input.mode === 'async' ? 'async' : 'sync',
    requestedTimeoutSeconds: input.requestedTimeoutSeconds,
    abortSignal: input.abortSignal,
    mode: input.mode,
    detachable: input.detachable,
    requestHeaders: input.requestHeaders,
    includeThinking: input.includeThinking,
    includeToolCalls: input.includeToolCalls,
  })
  return withholdUnadmittedInlineFiles(principal, context.workspaceId, result)
}

export const executeWorkflowOperation = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.execute,
  resolveContext: ({ input }: { input: ExecuteWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  execute: ({ principal, context, input }) => executeDeployedWorkflow(principal, context, input),
})

interface ExecuteWorkflowVersionInput extends ExecuteWorkflowInput {
  /** Deployment version number to run instead of the active deployment. */
  version: number
}

/**
 * Runs a chosen deployment version of a deployed workflow. Picking which graph
 * runs is a deployment decision, so it needs write access where running the
 * active deployment needs read. The workflow must still be deployed: the
 * service's deployment check applies to a pinned run as to any deployed one.
 */
export const executeWorkflowVersionOperation = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.executeVersion,
  resolveContext: ({ input }: { input: ExecuteWorkflowVersionInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  async execute({ principal, context, input }): Promise<ExecuteWorkflowServiceResult> {
    const deploymentVersionId = await getWorkflowDeploymentVersionId(
      context.workflowId,
      input.version
    )
    if (!deploymentVersionId) {
      throw new OrchestrationError('not_found', 'Version not found')
    }
    return executeDeployedWorkflow(principal, context, input, deploymentVersionId)
  },
})
