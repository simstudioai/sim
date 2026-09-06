import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'
import { InternalTaskStatus } from '@/lib/mothership/generated/tasks'
import { fetchGo } from '@/lib/mothership/request/go/fetch'
import { mothershipRequestHeaders } from '@/lib/mothership/request/headers'
import { getMothershipBaseURL } from '@/lib/mothership/server/agent-url'
import { taskOperations } from '@/lib/mothership/tasks/application/operations'

export const readTaskStatus = defineAuthorizedWorkspaceUseCase({
  operation: taskOperations.readStatus,
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
    const response = await fetchGo(`${base}/api/tasks/status`, {
      method: 'POST',
      headers: mothershipRequestHeaders(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      spanName: 'copilot.tasks.status',
    })
    if (response.status === 404) throw new OrchestrationError('not_found', 'Task not found')
    if (!response.ok) throw new Error('Task service is unavailable')
    const task = InternalTaskStatus.parse(await response.json())
    if (task.taskId !== input.taskId) throw new Error('Task service returned an unrelated task')
    return { ...(await resolveOwnedChatContext(principal, task.chatId)), task }
  },
  authorizationOptions: {},
  async execute({ context }) {
    const { taskId, status, summary } = context.task
    return { taskId, status, summary }
  },
})
