import { copilotChats, db, mothershipInboxTask, permissions, user, workspace } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { resolveOrCreateChat } from '@/lib/copilot/chat-lifecycle'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat-payload'
import { requestChatTitle } from '@/lib/copilot/chat-streaming'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import type { OrchestratorResult } from '@/lib/copilot/orchestrator/types'
import { taskPubSub } from '@/lib/copilot/task-events'
import { generateWorkspaceContext } from '@/lib/copilot/workspace-context'
import { isHosted } from '@/lib/core/config/feature-flags'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'
import { formatEmailAsMessage } from '@/lib/mothership/inbox/format'
import { sendInboxResponse } from '@/lib/mothership/inbox/response'
import type { AgentMailAttachment } from '@/lib/mothership/inbox/types'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InboxExecutor')

const MAX_BODY_LENGTH = 50_000

/**
 * Execute a mothership inbox task end-to-end:
 * 1. Load task and workspace
 * 2. Resolve user identity
 * 3. Resolve or create chat
 * 4. Build execution context
 * 5. Run orchestrator
 * 6. Send response email
 * 7. Update task status
 */
export async function executeInboxTask(taskId: string): Promise<void> {
  const [inboxTask] = await db
    .select()
    .from(mothershipInboxTask)
    .where(eq(mothershipInboxTask.id, taskId))
    .limit(1)

  if (!inboxTask) {
    logger.error('Inbox task not found', { taskId })
    return
  }

  if (inboxTask.status === 'completed' || inboxTask.status === 'failed') {
    logger.info('Inbox task already terminal, skipping', { taskId, status: inboxTask.status })
    return
  }

  const [ws] = await db
    .select()
    .from(workspace)
    .where(eq(workspace.id, inboxTask.workspaceId))
    .limit(1)

  if (!ws) {
    logger.error('Workspace not found for inbox task', {
      taskId,
      workspaceId: inboxTask.workspaceId,
    })
    await markTaskFailed(taskId, 'Workspace not found')
    return
  }

  let chatId = inboxTask.chatId
  let responseSent = false

  try {
    const [[claimed], userId] = await Promise.all([
      db
        .update(mothershipInboxTask)
        .set({ status: 'processing', processingStartedAt: new Date() })
        .where(and(eq(mothershipInboxTask.id, taskId), eq(mothershipInboxTask.status, 'received')))
        .returning({ id: mothershipInboxTask.id }),
      resolveUserId(inboxTask.fromEmail, ws),
    ])

    if (!claimed) {
      logger.info('Task already claimed by another execution, skipping', { taskId })
      return
    }

    if (!chatId) {
      const chatResult = await resolveOrCreateChat({
        userId,
        workspaceId: ws.id,
        model: 'claude-opus-4-5',
        type: 'mothership',
      })
      chatId = chatResult.chatId

      await db.update(mothershipInboxTask).set({ chatId }).where(eq(mothershipInboxTask.id, taskId))

      const titleInput =
        inboxTask.subject !== '(no subject)'
          ? `${inboxTask.subject}\n\n${inboxTask.bodyPreview || ''}`
          : inboxTask.bodyPreview || inboxTask.bodyText?.substring(0, 500) || ''

      requestChatTitle({
        message: titleInput,
        model: 'claude-opus-4-5',
      })
        .then(async (title) => {
          if (title && chatId) {
            await db.update(copilotChats).set({ title }).where(eq(copilotChats.id, chatId))
            taskPubSub?.publishStatusChanged({
              workspaceId: ws.id,
              chatId,
              type: 'renamed',
            })
          }
        })
        .catch((err) => {
          logger.warn('Failed to generate chat title', { chatId, err })
        })

      taskPubSub?.publishStatusChanged({
        workspaceId: ws.id,
        chatId,
        type: 'created',
      })
    }

    if (chatId) {
      taskPubSub?.publishStatusChanged({
        workspaceId: ws.id,
        chatId,
        type: 'started',
      })
    }

    let attachments: AgentMailAttachment[] = []
    if (inboxTask.hasAttachments && ws.inboxProviderId && inboxTask.agentmailMessageId) {
      try {
        const fullMessage = await agentmail.getMessage(
          ws.inboxProviderId,
          inboxTask.agentmailMessageId
        )
        attachments = fullMessage.attachments || []
      } catch (attachErr) {
        logger.warn('Failed to fetch attachment metadata', { taskId, attachErr })
      }
    }

    const truncatedTask = {
      ...inboxTask,
      bodyText: inboxTask.bodyText?.substring(0, MAX_BODY_LENGTH) ?? null,
      bodyHtml: inboxTask.bodyHtml?.substring(0, MAX_BODY_LENGTH) ?? null,
    }
    const messageContent = formatEmailAsMessage(truncatedTask, attachments)

    const [workspaceContext, integrationTools, userPermission] = await Promise.all([
      generateWorkspaceContext(ws.id, userId),
      buildIntegrationToolSchemas(userId),
      getUserEntityPermissions(userId, 'workspace', ws.id).catch(() => null),
    ])

    const userMessageId = crypto.randomUUID()
    const requestPayload: Record<string, unknown> = {
      message: messageContent,
      userId,
      chatId,
      mode: 'agent',
      messageId: userMessageId,
      isHosted,
      workspaceContext,
      ...(integrationTools.length > 0 ? { integrationTools } : {}),
      ...(userPermission ? { userPermission } : {}),
    }

    const result = await orchestrateCopilotStream(requestPayload, {
      userId,
      workspaceId: ws.id,
      chatId: chatId ?? undefined,
      goRoute: '/api/mothership/execute',
      autoExecuteTools: true,
      interactive: false,
    })

    const cleanContent = stripThinkingTags(result.content)

    if (chatId) {
      await persistChatMessages(chatId, userId, userMessageId, messageContent, {
        ...result,
        content: cleanContent,
      })
    }

    const finalStatus = result.success ? 'completed' : 'failed'
    const updatedTask = { ...inboxTask, chatId }
    const errorStr = result.error || result.errors?.join('; ')

    const responseMessageId = await sendInboxResponse(
      updatedTask,
      { success: result.success, content: cleanContent, error: errorStr },
      { inboxProviderId: ws.inboxProviderId, workspaceId: ws.id }
    )
    responseSent = true

    await db
      .update(mothershipInboxTask)
      .set({
        status: finalStatus,
        resultSummary: cleanContent?.substring(0, 200) || null,
        errorMessage: errorStr || null,
        completedAt: new Date(),
        ...(responseMessageId ? { responseMessageId } : {}),
      })
      .where(eq(mothershipInboxTask.id, taskId))

    if (chatId) {
      taskPubSub?.publishStatusChanged({
        workspaceId: ws.id,
        chatId,
        type: 'completed',
      })
    }

    logger.info('Inbox task execution complete', { taskId, status: finalStatus })
  } catch (error) {
    logger.error('Inbox task execution failed', {
      taskId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    await markTaskFailed(taskId, error instanceof Error ? error.message : 'Execution failed')

    if (!responseSent) {
      try {
        await sendInboxResponse(
          { ...inboxTask, chatId },
          {
            success: false,
            content: '',
            error: error instanceof Error ? error.message : 'Execution failed',
          },
          { inboxProviderId: ws.inboxProviderId, workspaceId: ws.id }
        )
      } catch (emailError) {
        logger.error('Failed to send error email', { taskId, emailError })
      }
    }
  }
}

/**
 * Resolve which user ID to use for execution.
 * Match sender email to a workspace member, fallback to workspace owner.
 */
async function resolveUserId(
  senderEmail: string,
  ws: { id: string; ownerId: string }
): Promise<string> {
  const [member] = await db
    .select({ userId: permissions.userId })
    .from(permissions)
    .innerJoin(user, eq(permissions.userId, user.id))
    .where(
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, ws.id),
        eq(user.email, senderEmail.toLowerCase())
      )
    )
    .limit(1)

  return member?.userId ?? ws.ownerId
}

/**
 * Persist the user message and assistant response to the copilot chat.
 * This is necessary because the orchestrator doesn't persist messages —
 * in the interactive UI flow, the client store handles persistence.
 * For background execution, we write directly to the DB.
 */
async function persistChatMessages(
  chatId: string,
  userId: string,
  userMessageId: string,
  userContent: string,
  result: OrchestratorResult
): Promise<void> {
  try {
    const now = new Date().toISOString()

    const userMessage = {
      id: userMessageId,
      role: 'user' as const,
      content: userContent,
      timestamp: now,
    }

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: result.content || '',
      timestamp: now,
      ...(result.error ? { errorType: 'internal' } : {}),
    }

    const newMessages = JSON.stringify([userMessage, assistantMessage])
    await db
      .update(copilotChats)
      .set({
        messages: sql`COALESCE(${copilotChats.messages}, '[]'::jsonb) || ${newMessages}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(copilotChats.id, chatId))
  } catch (err) {
    logger.warn('Failed to persist chat messages', {
      chatId,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

function stripThinkingTags(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?thinking[^>]*>/gi, '')
    .trim()
}

async function markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
  await db
    .update(mothershipInboxTask)
    .set({
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(mothershipInboxTask.id, taskId))
}
