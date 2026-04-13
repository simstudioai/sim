import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getActiveWorkflowRecord } from '@/lib/workflows/active-context'
import { authorizeWorkflowByWorkspacePermission } from '@/lib/workflows/utils'
import {
  assertActiveWorkspaceAccess,
  checkWorkspaceAccess,
} from '@/lib/workspaces/permissions/utils'

const logger = createLogger('CopilotChatLifecycle')

export interface ChatLoadResult {
  chatId: string
  chat: typeof copilotChats.$inferSelect | null
  conversationHistory: unknown[]
  isNew: boolean
}

export async function getAccessibleCopilotChat(chatId: string, userId: string) {
  const [chat] = await db
    .select()
    .from(copilotChats)
    .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, userId)))
    .limit(1)

  if (!chat) {
    return null
  }

  if (chat.workflowId) {
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: chat.workflowId,
      userId,
      action: 'read',
    })
    if (!authorization.allowed || !authorization.workflow) {
      return null
    }
  } else if (chat.workspaceId) {
    const access = await checkWorkspaceAccess(chat.workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      return null
    }
  }

  return chat
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
  type?: 'mothership' | 'copilot'
}): Promise<ChatLoadResult> {
  const { chatId, userId, workflowId, workspaceId, model, type } = params

  if (workspaceId) {
    await assertActiveWorkspaceAccess(workspaceId, userId)
  }

  if (chatId) {
    const chat = await getAccessibleCopilotChat(chatId, userId)

    if (chat) {
      if (workflowId && chat.workflowId !== workflowId) {
        return { chatId, chat: null, conversationHistory: [], isNew: false }
      }

      if (workspaceId && chat.workspaceId !== workspaceId) {
        return { chatId, chat: null, conversationHistory: [], isNew: false }
      }

      if (chat.workflowId) {
        const activeWorkflow = await getActiveWorkflowRecord(chat.workflowId)
        if (!activeWorkflow) {
          return { chatId, chat: null, conversationHistory: [], isNew: false }
        }
      }
    }

    return {
      chatId,
      chat: chat ?? null,
      conversationHistory: chat && Array.isArray(chat.messages) ? chat.messages : [],
      isNew: false,
    }
  }

  const now = new Date()
  const [newChat] = await db
    .insert(copilotChats)
    .values({
      userId,
      ...(workflowId ? { workflowId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      type: type ?? 'copilot',
      title: null,
      model,
      messages: [],
      lastSeenAt: now,
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
