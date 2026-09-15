import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export type ChatOwnerContext =
  | (WorkspaceAuthorizationContext & { organizationId?: undefined })
  | { organizationId: string; workspaceId?: undefined; workspaceOrganizationId?: undefined }

/** Workspace tasks never inherit organization Assistant ownership. */
export async function resolveOwnedWorkspaceChatContext(principal: Principal, chatId: string) {
  const context = await resolveOwnedChatContext(principal, chatId)
  if (!context.workspaceId) throw new OrchestrationError('not_found', 'Chat not found')
  return context
}

export async function resolveOwnedChatContext(principal: Principal, chatId: string) {
  const [chat] = await db
    .select({
      userId: copilotChats.userId,
      workspaceId: copilotChats.workspaceId,
      organizationId: copilotChats.organizationId,
      type: copilotChats.type,
    })
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), isNull(copilotChats.deletedAt)))
    .limit(1)
  if (
    !chat ||
    Boolean(chat.workspaceId) === Boolean(chat.organizationId) ||
    chat.userId !== resolvePrincipalSubjectUserId(principal) ||
    (chat.organizationId && chat.type !== 'mothership')
  ) {
    throw new OrchestrationError('not_found', 'Chat not found')
  }
  if ((await getActivelyBannedUserIds([chat.userId])).length > 0) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  const owner: ChatOwnerContext = chat.organizationId
    ? { organizationId: chat.organizationId }
    : {
        ...(await resolveActiveWorkspaceApplicationContext(chat.workspaceId!)),
        organizationId: undefined,
      }
  return {
    ...owner,
    chatId,
    userId: chat.userId,
  }
}
