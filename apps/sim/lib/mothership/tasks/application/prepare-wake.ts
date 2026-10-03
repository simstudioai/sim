import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getLatestRunForStream } from '@/lib/mothership/async-runs/repository'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import type { TaskWakeRequest } from '@/lib/mothership/generated/tasks'
import {
  acquirePendingChatStream,
  getLocalChatStreamLease,
  releasePendingChatStream,
} from '@/lib/mothership/request/session/abort'
import { taskDelegationPolicy } from '@/lib/mothership/tasks/application/context'
import {
  organizationTaskOperations,
  taskOperations,
} from '@/lib/mothership/tasks/application/operations'

const wakeDefinition = {
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
        (context.organizationId && context.mode !== 'agent' && context.mode !== 'plan')
      )
        throw new OrchestrationError('not_found', 'Chat not found')
      return context
    })
  },
  authorizationOptions: { delegation: taskDelegationPolicy },
}

export const prepareTaskWake = defineAuthorizedChatUseCase({
  ...wakeDefinition,
  async execute({ input }) {
    if (!(await acquirePendingChatStream(input.chatId, input.runId))) {
      throw new OrchestrationError('conflict', 'Another stream holds this chat; retry the wake')
    }
    const lease = getLocalChatStreamLease(input.chatId, input.runId)
    /**
     * The worker retries a wake under the same run ID until its own run appears. A turn sim
     * already ran under that ID without reaching the worker (a usage-limit refusal) can never
     * open again, so answer not-found: the worker dismisses the notification instead of
     * retrying forever. Checked under the chat lock, so an in-flight turn still answers busy.
     * Any throw here releases the lock just taken, by its own lease: a slow lookup can outlive
     * the lock, and a retry under the same run ID may hold the chat by then.
     */
    try {
      if (await getLatestRunForStream(input.runId)) {
        throw new OrchestrationError('not_found', 'This wake already ran')
      }
    } catch (error) {
      await releasePendingChatStream(input.chatId, input.runId, lease)
      throw error
    }
    return { accepted: true } as const
  },
})

const readWakeMode = defineAuthorizedChatUseCase({
  ...wakeDefinition,
  async execute({ context }) {
    return context.mode
  },
})

export async function authorizeTaskWake(input: Parameters<typeof prepareTaskWake.execute>[0]) {
  return readWakeMode.execute(input)
}
