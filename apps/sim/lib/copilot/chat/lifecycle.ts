import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  authorizeWorkflowByWorkspacePermission,
  getActiveWorkflowRecord,
} from '@sim/workflow-authz'
import { and, eq } from 'drizzle-orm'
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
    logger.warn('Copilot chat not found or not owned by user', { chatId, userId })
    return null
  }

  if (chat.workflowId) {
    const authorization = await authorizeWorkflowByWorkspacePermission({
      workflowId: chat.workflowId,
      userId,
      action: 'read',
    })
    if (!authorization.allowed || !authorization.workflow) {
      logger.warn('Copilot chat workflow not authorized for user', {
        chatId,
        userId,
        workflowId: chat.workflowId,
      })
      return null
    }
  } else if (chat.workspaceId) {
    const access = await checkWorkspaceAccess(chat.workspaceId, userId)
    if (!access.exists || !access.hasAccess) {
      logger.warn('Copilot chat workspace not accessible to user', {
        chatId,
        userId,
        workspaceId: chat.workspaceId,
      })
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
        logger.warn('Copilot chat workflow mismatch', {
          chatId,
          userId,
          requestWorkflowId: workflowId,
          chatWorkflowId: chat.workflowId,
        })
        return { chatId, chat: null, conversationHistory: [], isNew: false }
      }

      if (workspaceId && chat.workspaceId !== workspaceId) {
        logger.warn('Copilot chat workspace mismatch', {
          chatId,
          userId,
          requestWorkspaceId: workspaceId,
          chatWorkspaceId: chat.workspaceId,
        })
        return { chatId, chat: null, conversationHistory: [], isNew: false }
      }

      if (chat.workflowId) {
        const activeWorkflow = await getActiveWorkflowRecord(chat.workflowId)
        if (!activeWorkflow) {
          logger.warn('Copilot chat workflow no longer active', {
            chatId,
            userId,
            workflowId: chat.workflowId,
          })
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
