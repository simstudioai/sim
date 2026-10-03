import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveInvocationWorkspace } from '@/lib/mothership/application/workspace-target'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { taskDelegationPolicy } from '@/lib/mothership/tasks/application/context'
import {
  organizationTaskOperations,
  taskOperations,
} from '@/lib/mothership/tasks/application/operations'
import { resolveActiveWorkflowRunApplicationContext } from '@/lib/workflows/application/context'
import { getWorkflowExecutionStatus } from '@/lib/workflows/executor/execution-status'

export const readWatchedWorkflowStatus = defineAuthorizedChatUseCase({
  operation: taskOperations.readWorkflowStatus,
  organizationOperation: organizationTaskOperations.readWorkflowStatus,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Parameters<typeof resolveOwnedChatContext>[0]
    input: { chatId: string; executionId: string; workspaceId?: string }
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: { delegation: taskDelegationPolicy },
  async execute({ input, context }) {
    if (context.workspaceId && input.workspaceId && context.workspaceId !== input.workspaceId)
      throw new OrchestrationError('not_found', 'Run not found')
    const target = context.organizationId
      ? await resolveInvocationWorkspace(context, input.workspaceId)
      : { workspaceId: context.workspaceId! }
    const run = await resolveActiveWorkflowRunApplicationContext({
      runId: input.executionId,
      assertedWorkspaceId: target.workspaceId,
    })
    const result = await getWorkflowExecutionStatus({
      workflowId: run.workflowId,
      workspaceId: target.workspaceId,
      viewerUserId: context.userId,
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
      workflowId: run.workflowId,
      status,
      summary,
      ...(result.error ? { output: result.error.slice(0, 2_000_000) } : {}),
    } as const
  },
})
