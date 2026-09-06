import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import type { TaskWakeRequest } from '@/lib/mothership/generated/tasks'
import { acquirePendingChatStream } from '@/lib/mothership/request/session/abort'
import { taskDelegationPolicy } from '@/lib/mothership/tasks/application/context'
import { taskOperations } from '@/lib/mothership/tasks/application/operations'

export const prepareTaskWake = defineAuthorizedWorkspaceUseCase({
  operation: taskOperations.wake,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Parameters<typeof resolveOwnedChatContext>[0]
    input: TaskWakeRequest
  }) => resolveOwnedChatContext(principal, input.chatId),
  authorizationOptions: { delegation: taskDelegationPolicy },
  async authorizeResource({ context, input }) {
    if (context.workspaceId !== input.workspaceId || context.userId !== input.userId) {
      throw new OrchestrationError('not_found', 'Chat not found')
    }
  },
  async execute({ input }) {
    if (!(await acquirePendingChatStream(input.chatId, input.runId))) {
      throw new OrchestrationError('conflict', 'Another stream holds this chat; retry the wake')
    }
    return { accepted: true } as const
  },
})

export async function authorizeTaskWake(
  input: Parameters<typeof prepareTaskWake.execute>[0]
): Promise<void> {
  if (!prepareTaskWake.authorize) throw new Error('Task wake requires an authorization phase')
  await prepareTaskWake.authorize(input)
}
