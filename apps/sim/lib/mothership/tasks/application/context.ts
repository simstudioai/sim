import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import type { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'

export const TASK_DELEGATION_AUDIENCE = 'sim:copilot-tasks'

type TaskChatContext = Awaited<ReturnType<typeof resolveOwnedChatContext>>

export const taskDelegationPolicy: WorkspaceDelegationPolicy<TaskChatContext> = {
  audience: TASK_DELEGATION_AUDIENCE,
  isWithinScope: (principal, context) =>
    principal.serviceId === 'copilot' && principal.workspaceId === context.workspaceId,
}
