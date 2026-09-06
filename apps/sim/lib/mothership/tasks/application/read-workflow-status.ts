import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { taskDelegationPolicy } from '@/lib/mothership/tasks/application/context'
import { taskOperations } from '@/lib/mothership/tasks/application/operations'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

export const readWatchedWorkflowStatus = defineAuthorizedWorkspaceUseCase({
  operation: taskOperations.readWorkflowStatus,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Parameters<typeof resolveOwnedChatContext>[0]
    input: { chatId: string; executionId: string }
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: { delegation: taskDelegationPolicy },
  async execute({ input, context }) {
    const run = await resolveActiveWorkflowRunApplicationContext({
      runId: input.executionId,
      assertedWorkspaceId: context.workspaceId,
    })
    const result = await getWorkflowExecutionStatus({
      workflowId: run.workflowId,
      executionId: run.runId,
      includeOutput: false,
      selectedOutputs: [],
    })
    if (!result) throw new OrchestrationError('not_found', 'Run not found')
    const status =
      result.status === 'completed'
        ? 'completed'
        : result.status === 'failed' || result.status === 'cancelled'
          ? 'failed'
          : 'pending'
    const summary =
      `Workflow run ${run.runId} of "${run.workflow.name}" ${result.status}${result.error ? `: ${result.error.slice(0, 500)}` : ''}`.slice(
        0,
        4000
      )
    return {
      status,
      summary,
      ...(result.error ? { output: result.error.slice(0, 2_000_000) } : {}),
    } as const
  },
})
