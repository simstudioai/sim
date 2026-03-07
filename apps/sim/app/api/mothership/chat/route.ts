import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { resolveOrCreateChat } from '@/lib/copilot/chat-lifecycle'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat-payload'
import { createSSEStream, SSE_RESPONSE_HEADERS } from '@/lib/copilot/chat-streaming'
import type { OrchestratorResult } from '@/lib/copilot/orchestrator/types'
import { createRequestTracker, createUnauthorizedResponse } from '@/lib/copilot/request-helpers'
import { generateWorkspaceContext } from '@/lib/copilot/workspace-context'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('MothershipChatAPI')

const FileAttachmentSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size: z.number(),
})

const MothershipMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  workspaceId: z.string().min(1, 'workspaceId is required'),
  userMessageId: z.string().optional(),
  chatId: z.string().optional(),
  createNewChat: z.boolean().optional().default(false),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  userTimezone: z.string().optional(),
  contexts: z
    .array(
      z.object({
        kind: z.enum([
          'past_chat',
          'workflow',
          'current_workflow',
          'blocks',
          'logs',
          'workflow_block',
          'knowledge',
          'templates',
          'docs',
        ]),
        label: z.string(),
        chatId: z.string().optional(),
        workflowId: z.string().optional(),
        knowledgeId: z.string().optional(),
        blockId: z.string().optional(),
        blockIds: z.array(z.string()).optional(),
        templateId: z.string().optional(),
        executionId: z.string().optional(),
      })
    )
    .optional(),
})

/**
 * POST /api/mothership/chat
 * Workspace-scoped chat — no workflowId, proxies to Go /api/mothership.
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }

    const authenticatedUserId = session.user.id
    const body = await req.json()
    const {
      message,
      workspaceId,
      userMessageId: providedMessageId,
      chatId,
      createNewChat,
      fileAttachments,
      contexts,
      userTimezone,
    } = MothershipMessageSchema.parse(body)

    const userMessageId = providedMessageId || crypto.randomUUID()

    let agentContexts: Array<{ type: string; content: string }> = []
    if (Array.isArray(contexts) && contexts.length > 0) {
      try {
        const { processContextsServer } = await import('@/lib/copilot/process-contents')
        agentContexts = await processContextsServer(contexts as any, authenticatedUserId, message)
      } catch (e) {
        logger.error(`[${tracker.requestId}] Failed to process contexts`, e)
      }
    }

    let currentChat: any = null
    let conversationHistory: any[] = []
    let actualChatId = chatId

    if (chatId || createNewChat) {
      const chatResult = await resolveOrCreateChat({
        chatId,
        userId: authenticatedUserId,
        workspaceId,
        model: 'claude-opus-4-5',
        type: 'mothership',
      })
      currentChat = chatResult.chat
      actualChatId = chatResult.chatId || chatId
      conversationHistory = Array.isArray(chatResult.conversationHistory)
        ? chatResult.conversationHistory
        : []
    }

    if (actualChatId) {
      const userMsg = {
        id: userMessageId,
        role: 'user' as const,
        content: message,
        timestamp: new Date().toISOString(),
      }

      await db
        .update(copilotChats)
        .set({
          messages: [...conversationHistory, userMsg],
          conversationId: userMessageId,
          updatedAt: new Date(),
        })
        .where(eq(copilotChats.id, actualChatId))
    }

    const [workspaceContext, userPermission] = await Promise.all([
      generateWorkspaceContext(workspaceId, authenticatedUserId),
      getUserEntityPermissions(authenticatedUserId, 'workspace', workspaceId).catch(() => null),
    ])

    const requestPayload = await buildCopilotRequestPayload(
      {
        message,
        workspaceId,
        userId: authenticatedUserId,
        userMessageId,
        mode: 'agent',
        model: '',
        conversationHistory,
        contexts: agentContexts,
        fileAttachments,
        chatId: actualChatId,
        userPermission: userPermission ?? undefined,
        workspaceContext,
        userTimezone,
      },
      { selectedModel: '' }
    )

    const stream = createSSEStream({
      requestPayload,
      userId: authenticatedUserId,
      streamId: userMessageId,
      chatId: actualChatId,
      currentChat,
      conversationHistory,
      message,
      titleModel: 'claude-opus-4-5',
      requestId: tracker.requestId,
      orchestrateOptions: {
        userId: authenticatedUserId,
        workspaceId,
        chatId: actualChatId,
        goRoute: '/api/mothership',
        autoExecuteTools: true,
        interactive: false,
        onComplete: async (result: OrchestratorResult) => {
          if (!actualChatId) return

          const userMessage = {
            id: userMessageId,
            role: 'user' as const,
            content: message,
            timestamp: new Date().toISOString(),
          }

          const assistantMessage = {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: result.content,
            timestamp: new Date().toISOString(),
          }

          const updatedMessages = [...conversationHistory, userMessage, assistantMessage]

          try {
            await db
              .update(copilotChats)
              .set({
                messages: updatedMessages,
                conversationId: null,
              })
              .where(eq(copilotChats.id, actualChatId))
          } catch (error) {
            logger.error(`[${tracker.requestId}] Failed to persist chat messages`, {
              chatId: actualChatId,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          }
        },
      },
    })

    return new Response(stream, { headers: SSE_RESPONSE_HEADERS })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${tracker.requestId}] Error handling mothership chat:`, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
