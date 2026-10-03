import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

export interface ReadPausedWorkflowExecutionInput {
  workflowId: string
  executionId: string
}

export const readPausedWorkflowExecution = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readPausedExecution,
  resolveContext: ({ input }: { input: ReadPausedWorkflowExecutionInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  async execute({ context, input }) {
    const detail = await PauseResumeManager.getPausedExecutionDetail({
      workflowId: context.workflowId,
      executionId: input.executionId,
    })
    if (!detail) throw new OrchestrationError('not_found', 'Paused execution not found')
    return detail
  },
})
