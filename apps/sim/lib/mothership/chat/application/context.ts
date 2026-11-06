import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { conversationModeSelection } from '@/lib/mothership/chat/intent'
import { authorizeChatWorkflowRead, isChatModeAvailable } from '@/lib/mothership/chat/lifecycle'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'

export type ChatOwnerContext =
  | (WorkspaceAuthorizationContext & { organizationId?: undefined })
  | { organizationId: string; workspaceId?: undefined; workspaceOrganizationId?: undefined }

/** Workspace tasks never inherit organization Assistant ownership. */
export async function resolveOwnedWorkspaceChatContext(principal: Principal, chatId: string) {
  const context = await resolveOwnedChatContext(principal, chatId)
  if (!context.workspaceId) throw new OrchestrationError('not_found', 'Chat not found')
  return context
}

export interface OwnedChatContextOptions {
  /**
   * Resolves the chat for an owner whose account is blocked. Only Stop sets it: halting the
   * owner's existing work is never harmful, so it stays available after access is withheld.
   */
  allowBlockedOwner?: boolean
}

export async function resolveOwnedChatContext(
  principal: Principal,
  chatId: string,
  options: OwnedChatContextOptions = {}
) {
  const [chat] = await db
    .select({
      userId: copilotChats.userId,
      workspaceId: copilotChats.workspaceId,
      organizationId: copilotChats.organizationId,
      workflowId: copilotChats.workflowId,
      type: copilotChats.type,
      mode: conversationModeSelection,
      memorySpaceId: copilotChats.memorySpaceId,
    })
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), isNull(copilotChats.deletedAt)))
    .limit(1)
  if (
    !chat ||
    (chat.workspaceId && chat.organizationId) ||
    (!chat.workspaceId && !chat.organizationId && !chat.workflowId) ||
    chat.userId !== resolvePrincipalSubjectUserId(principal) ||
    (chat.organizationId && chat.type !== 'mothership')
  ) {
    throw new OrchestrationError('not_found', 'Chat not found')
  }
  if (!options.allowBlockedOwner && (await getActivelyBannedUserIds([chat.userId])).length > 0) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  const owner: ChatOwnerContext = chat.organizationId
    ? { organizationId: chat.organizationId }
    : {
        ...(await resolveActiveWorkspaceApplicationContext(
          await resolveChatWorkspaceId(chatId, chat)
        )),
        organizationId: undefined,
      }
  return {
    ...owner,
    chatId,
    userId: chat.userId,
    workflowId: chat.workflowId,
    type: chat.type,
    mode: chat.mode,
    memorySpaceId: chat.memorySpaceId ?? null,
  }
}

/**
 * A workflow chat row from before chats carried a workspace is scoped by its workflow's, while
 * its owner may still read that workflow.
 */
async function resolveChatWorkspaceId(
  chatId: string,
  chat: { userId: string; workspaceId: string | null; workflowId: string | null }
): Promise<string> {
  if (chat.workspaceId) return chat.workspaceId
  const workflow = chat.workflowId
    ? await authorizeChatWorkflowRead(chatId, chat.userId, chat.workflowId)
    : null
  if (!workflow?.workspaceId) throw new OrchestrationError('not_found', 'Chat not found')
  return workflow.workspaceId
}

/**
 * Refuses a chat its owner may no longer read, as the chat detail read does: a workflow chat
 * whose workflow they cannot read, or a workspace Plan chat while Plan mode is off for them.
 */
export async function requireOwnedChatReadable(
  context: Awaited<ReturnType<typeof resolveOwnedChatContext>>
) {
  if (
    (context.workflowId &&
      !(await authorizeChatWorkflowRead(context.chatId, context.userId, context.workflowId))) ||
    !(await isChatModeAvailable(context, context.userId))
  )
    throw new OrchestrationError('not_found', 'Chat not found')
}
