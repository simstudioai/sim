import { principalWorkspaceId, workspaceDelegationRestrictions } from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import type { resolveOwnedChatContext } from '@/lib/mothership/chat/application/context'

export const TASK_DELEGATION_AUDIENCE = 'sim:copilot-tasks'

type TaskChatContext = Awaited<ReturnType<typeof resolveOwnedChatContext>>

export const taskDelegationPolicy: WorkspaceDelegationPolicy<
  TaskChatContext & WorkspaceAuthorizationContext
> = {
  audience: TASK_DELEGATION_AUDIENCE,
  isWithinScope: (principal, context) =>
    principal.serviceId === 'copilot' &&
    principalWorkspaceId(principal) === context.workspaceId &&
    (!workspaceDelegationRestrictions(principal)?.chatId ||
      workspaceDelegationRestrictions(principal)?.chatId === context.chatId),
}
