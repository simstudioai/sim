import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { copilotChats, db } from '@sim/db'
import { and, eq, isNull } from 'drizzle-orm'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export async function resolveOwnedChatContext(principal: Principal, chatId: string) {
  const [chat] = await db
    .select({ userId: copilotChats.userId, workspaceId: copilotChats.workspaceId })
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), isNull(copilotChats.deletedAt)))
    .limit(1)
  if (!chat?.workspaceId || chat.userId !== resolvePrincipalSubjectUserId(principal)) {
    throw new OrchestrationError('not_found', 'Chat not found')
  }
  if ((await getActivelyBannedUserIds([chat.userId])).length > 0) {
    throw new OrchestrationError('forbidden', 'User account is suspended')
  }
  return {
    ...(await resolveActiveWorkspaceApplicationContext(chat.workspaceId)),
    chatId,
    userId: chat.userId,
  }
}
