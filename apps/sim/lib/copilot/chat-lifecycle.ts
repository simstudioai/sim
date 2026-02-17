import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'

const logger = createLogger('CopilotChatLifecycle')

export interface ChatLoadResult {
  chatId: string
  chat: typeof copilotChats.$inferSelect | null
  conversationHistory: unknown[]
  isNew: boolean
}

/**
 * Resolve or create a copilot chat session.
 * If chatId is provided, loads the existing chat. Otherwise creates a new one.
 * Supports both workflow-scoped and workspace-scoped chats.
 */
export async function resolveOrCreateChat(params: {
  chatId?: string
  userId: string
  workflowId?: string
  workspaceId?: string
  model: string
}): Promise<ChatLoadResult> {
  const { chatId, userId, workflowId, workspaceId, model } = params

  if (chatId) {
    const [chat] = await db
      .select()
      .from(copilotChats)
      .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
      .limit(1)

    return {
      chatId,
      chat: chat ?? null,
      conversationHistory: chat && Array.isArray(chat.messages) ? chat.messages : [],
      isNew: false,
    }
  }

  const [newChat] = await db
    .insert(copilotChats)
    .values({
      userId,
      ...(workflowId ? { workflowId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      title: null,
      model,
      messages: [],
    })
    .returning()

  if (!newChat) {
    logger.warn('Failed to create new copilot chat row', { userId, workflowId, workspaceId })
    return {
      chatId: '',
      chat: null,
      conversationHistory: [],
      isNew: true,
    }
  }

  return {
    chatId: newChat.id,
    chat: newChat,
    conversationHistory: [],
    isNew: true,
  }
}
