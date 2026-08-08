import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  cancelWorkflowExecution,
  WorkflowExecutionNotFoundError,
} from '@/lib/execution/cancel-workflow-execution'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'

export interface CancelWorkflowRunInput {
  workflowId: string
  runId: string
}

function assertedWorkspaceId(principal: Principal): string | undefined {
  return principal.kind === 'workspace_api_key' || principal.kind === 'delegated'
    ? principal.workspaceId
    : undefined
}

export const cancelWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.cancelRun,
  resolveContext: ({ principal, input }: { principal: Principal; input: CancelWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkspaceId(principal),
    }),
  async execute({ principal, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    try {
      const result = await cancelWorkflowExecution({
        executionId: context.runId,
        workflowId: context.workflowId,
        userId: attribution.attributedUserId,
        workspaceId: context.workspaceId,
        captureAnalytics: false,
      })
      return { ...result, workflowId: context.workflowId, workspaceId: context.workspaceId }
    } catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) {
        throw new OrchestrationError('not_found', 'Run not found')
      }
      throw error
    }
  },
})
