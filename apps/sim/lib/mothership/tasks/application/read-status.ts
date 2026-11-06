import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { isTimeoutError } from '@/lib/core/execution-limits'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedChatUseCase } from '@/lib/mothership/chat/application/authorized-chat-use-case'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { InternalTaskStatus } from '@/lib/mothership/generated/tasks'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'
import {
  organizationTaskOperations,
  taskOperations,
} from '@/lib/mothership/tasks/application/operations'

/** The task service failed to answer a status read; `timedOut` separates a slow service from a down one. */
export class TaskServiceUnavailableError extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut ? 'Task service timed out' : 'Task service is unavailable')
    this.name = 'TaskServiceUnavailableError'
  }
}

async function fetchTaskStatus(base: string, input: { taskId: string }) {
  try {
    const response = await fetchGo(`${base}/api/tasks/status`, {
      method: 'POST',
      headers: mothershipRequestHeaders(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      spanName: 'copilot.tasks.status',
    })
    if (response.status === 404) throw new OrchestrationError('not_found', 'Task not found')
    if (!response.ok) throw new TaskServiceUnavailableError(false)
    return InternalTaskStatus.parse(await response.json())
  } catch (error) {
    if (isTimeoutError(error)) throw new TaskServiceUnavailableError(true)
    throw error
  }
}

export const readTaskStatus = defineAuthorizedChatUseCase({
  operation: taskOperations.readStatus,
  organizationOperation: organizationTaskOperations.readStatus,
  async resolveContext({
    principal,
    input,
  }: {
    principal: Parameters<typeof resolveOwnedChatContext>[0]
    input: { taskId: string }
  }) {
    const userId = resolvePrincipalSubjectUserId(principal)
    if (!userId) throw new OrchestrationError('forbidden', 'A user is required')
    const base = await getMothershipBaseURL({ userId })
    const task = await fetchTaskStatus(base, input)
    if (task.taskId !== input.taskId) throw new Error('Task service returned an unrelated task')
    return { ...(await resolveOwnedChatContext(principal, task.chatId)), task }
  },
  authorizationOptions: {},
  async execute({ context }) {
    const { taskId, status, summary } = context.task
    return { taskId, status, summary }
  },
})
