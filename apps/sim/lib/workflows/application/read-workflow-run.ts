import type { Principal } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE,
  FunctionalOutputsUnavailableError,
} from '@/lib/logs/execution/functional-outputs'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

export interface ReadWorkflowRunInput {
  workflowId: string
  runId: string
  includeOutput: boolean
  selectedOutputs: string[]
}

function assertedWorkspaceId(principal: Principal): string | undefined {
  return principal.kind === 'workspace_api_key' || principal.kind === 'delegated'
    ? principal.workspaceId
    : undefined
}

export const readWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readRun,
  resolveContext: ({ principal, input }: { principal: Principal; input: ReadWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkspaceId(principal),
    }),
  async execute({ context, input }) {
    try {
      const status = await getWorkflowExecutionStatus({
        workflowId: context.workflowId,
        executionId: context.runId,
        includeOutput: input.includeOutput,
        selectedOutputs: input.selectedOutputs,
      })
      if (!status) throw new OrchestrationError('not_found', 'Run not found')
      return status
    } catch (error) {
      if (error instanceof FunctionalOutputsUnavailableError) {
        throw new OrchestrationError('conflict', FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE)
      }
      throw error
    }
  },
})
