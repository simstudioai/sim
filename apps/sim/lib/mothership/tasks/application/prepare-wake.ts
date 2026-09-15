import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import type { TaskWakeRequest } from '@/lib/mothership/generated/tasks'
import { acquirePendingChatStream } from '@/lib/mothership/request/session/abort'
import { taskDelegationPolicy } from '@/lib/mothership/tasks/application/context'
import {
  organizationTaskOperations,
  taskOperations,
} from '@/lib/mothership/tasks/application/operations'

export const prepareTaskWake = defineAuthorizedChatUseCase({
  operation: taskOperations.wake,
  organizationOperation: organizationTaskOperations.wake,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Parameters<typeof resolveOwnedChatContext>[0]
    input: TaskWakeRequest
  }) => {
    return resolveOwnedChatContext(principal, input.chatId).then((context) => {
      if (
        context.workspaceId !== input.workspaceId ||
        context.organizationId !== input.organizationId ||
        context.userId !== input.userId ||
        (context.organizationId && context.mode !== 'agent')
      )
        throw new OrchestrationError('not_found', 'Chat not found')
      return context
    })
  },
  authorizationOptions: { delegation: taskDelegationPolicy },
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
