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

export const readWorkflowRun = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readRun,
  resolveContext: ({ input }: { input: ReadWorkflowRunInput }) =>
    resolveActiveWorkflowRunApplicationContext({
      runId: input.runId,
      assertedWorkflowId: input.workflowId,
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
