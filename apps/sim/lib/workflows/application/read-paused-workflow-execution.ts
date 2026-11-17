import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

export interface ReadPausedWorkflowExecutionInput {
  workflowId: string
  executionId: string
  /**
   * Also read the execution snapshot. It carries every block's output and can run to
   * many megabytes, so only a caller that returns it asks for it.
   */
  includeSnapshot: boolean
}

export const readPausedWorkflowExecution = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.readPausedExecution,
  resolveContext: ({ input }: { input: ReadPausedWorkflowExecutionInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
  async execute({ context, input }) {
    const target = { workflowId: context.workflowId, executionId: input.executionId }
    const detail = input.includeSnapshot
      ? await PauseResumeManager.getPausedExecutionDetail(target)
      : await PauseResumeManager.getPausedExecutionView(target)
    if (!detail) throw new OrchestrationError('not_found', 'Paused execution not found')
    return detail
  },
})
