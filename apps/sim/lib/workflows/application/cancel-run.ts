import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  cancelWorkflowExecution,
  WorkflowExecutionNotFoundError,
} from '@/lib/execution/cancel-workflow-execution'
import { captureServerEvent } from '@/lib/posthog/server'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'

export interface CancelWorkflowRunInput {
  runId: string
  abortSignal?: AbortSignal
}

export const cancelWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.cancelRun,
  resolveContext: ({ input }: { input: CancelWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
    }),
  async execute({ principal, context, input }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    try {
      const result = await cancelWorkflowExecution({
        executionId: context.runId,
        workflowId: context.workflowId,
        attributedUserId: attribution.attributedUserId,
        workspaceId: context.workspaceId,
        abortSignal: input.abortSignal,
      })
      return { ...result, workflowId: context.workflowId, workspaceId: context.workspaceId }
    } catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) {
        throw new OrchestrationError('not_found', 'Run not found')
      }
      throw error
    }
  },
  afterSuccess({ principal, context, result }) {
    if (!result.success || result.reason === 'already_cancelled') return
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    captureServerEvent(
      attribution.attributedUserId,
      'workflow_execution_cancelled',
      { workflow_id: context.workflowId, workspace_id: context.workspaceId },
      { groups: { workspace: context.workspaceId } }
    )
  },
})
