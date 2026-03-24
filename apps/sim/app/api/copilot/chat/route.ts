import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { getAccessibleCopilotChat, resolveOrCreateChat } from '@/lib/copilot/chat-lifecycle'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat-payload'
import {
  acquirePendingChatStream,
  createSSEStream,
  releasePendingChatStream,
  requestChatTitle,
  SSE_RESPONSE_HEADERS,
} from '@/lib/copilot/chat-streaming'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/models'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import { getStreamMeta, readStreamEvents } from '@/lib/copilot/orchestrator/stream/buffer'
import type { OrchestratorResult } from '@/lib/copilot/orchestrator/types'
import { resolveActiveResourceContext } from '@/lib/copilot/process-contents'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import {
  authorizeWorkflowByWorkspacePermission,
  resolveWorkflowIdForUser,
} from '@/lib/workflows/utils'
import {
  assertActiveWorkspaceAccess,
  getUserEntityPermissions,
} from '@/lib/workspaces/permissions/utils'

export const maxDuration = 3600

const logger = createLogger('CopilotChatAPI')

const FileAttachmentSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size: z.number(),
})

const ResourceAttachmentSchema = z.object({
  type: z.enum(['workflow', 'table', 'file', 'knowledgebase']),
  id: z.string().min(1),
  title: z.string().optional(),
  active: z.boolean().optional(),
})

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  userMessageId: z.string().optional(),
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  workspaceId: z.string().optional(),
  workflowName: z.string().optional(),
  model: z.string().optional().default('claude-opus-4-6'),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  prefetch: z.boolean().optional(),
  createNewChat: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(true),
  implicitFeedback: z.string().optional(),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  resourceAttachments: z.array(ResourceAttachmentSchema).optional(),
  provider: z.string().optional(),
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
          'table',
          'file',
        ]),
        label: z.string(),
        chatId: z.string().optional(),
        workflowId: z.string().optional(),
        knowledgeId: z.string().optional(),
        blockId: z.string().optional(),
        blockIds: z.array(z.string()).optional(),
        templateId: z.string().optional(),
        executionId: z.string().optional(),
        tableId: z.string().optional(),
        fileId: z.string().optional(),
      })
    )
    .optional(),
  commands: z.array(z.string()).optional(),
  userTimezone: z.string().optional(),
})

/**
 * POST /api/copilot/chat
 * Send messages to sim agent and handle chat persistence
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()
  let actualChatId: string | undefined
  let pendingChatStreamAcquired = false
  let pendingChatStreamHandedOff = false
  let pendingChatStreamID: string | undefined

  try {
    // Get session to access user information including name
    const session = await getSession()

    if (!session?.user?.id) {
      return createUnauthorizedResponse()
    }

    const authenticatedUserId = session.user.id

    const body = await req.json()
    const {
      message,
      userMessageId,
      chatId,
      workflowId: providedWorkflowId,
      workspaceId: requestedWorkspaceId,
      workflowName,
      model,
      mode,
      prefetch,
      createNewChat,
      stream,
      implicitFeedback,
      fileAttachments,
      resourceAttachments,
      provider,
      contexts,
      commands,
      userTimezone,
    } = ChatMessageSchema.parse(body)

    const normalizedContexts = Array.isArray(contexts)
      ? contexts.map((ctx) => {
          if (ctx.kind !== 'blocks') return ctx
          if (Array.isArray(ctx.blockIds) && ctx.blockIds.length > 0) return ctx
          if (ctx.blockId) {
            return {
              ...ctx,
              blockIds: [ctx.blockId],
            }
          }
          return ctx
        })
      : contexts

    // Copilot route always requires a workflow scope
    const resolved = await resolveWorkflowIdForUser(
      authenticatedUserId,
      providedWorkflowId,
      workflowName,
      requestedWorkspaceId
    )
    if (!resolved) {
      return createBadRequestResponse(
        'No workflows found. Create a workflow first or provide a valid workflowId.'
      )
    }
    const workflowId = resolved.workflowId
    const workflowResolvedName = resolved.workflowName

    // Resolve workspace from workflow so it can be sent as implicit context to the Go backend.
    let resolvedWorkspaceId: string | undefined
    try {
      const { getWorkflowById } = await import('@/lib/workflows/utils')
      const wf = await getWorkflowById(workflowId)
      resolvedWorkspaceId = wf?.workspaceId ?? undefined
    } catch {
      logger.warn(`[${tracker.requestId}] Failed to resolve workspaceId from workflow`)
    }

    const userMessageIdToUse = userMessageId || crypto.randomUUID()
    try {
      logger.info(`[${tracker.requestId}] Received chat POST`, {
        workflowId,
        hasContexts: Array.isArray(normalizedContexts),
        contextsCount: Array.isArray(normalizedContexts) ? normalizedContexts.length : 0,
        contextsPreview: Array.isArray(normalizedContexts)
          ? normalizedContexts.map((c: any) => ({
              kind: c?.kind,
              chatId: c?.chatId,
              workflowId: c?.workflowId,
              executionId: (c as any)?.executionId,
              label: c?.label,
            }))
          : undefined,
      })
    } catch {}

    let currentChat: any = null
    let conversationHistory: any[] = []
    actualChatId = chatId
    const selectedModel = model || 'claude-opus-4-6'

    if (chatId || createNewChat) {
      const chatResult = await resolveOrCreateChat({
        chatId,
        userId: authenticatedUserId,
        workflowId,
        model: selectedModel,
      })
      currentChat = chatResult.chat
      actualChatId = chatResult.chatId || chatId
      conversationHistory = Array.isArray(chatResult.conversationHistory)
        ? chatResult.conversationHistory
        : []

      if (chatId && !currentChat) {
        return createBadRequestResponse('Chat not found')
      }
    }

    let agentContexts: Array<{ type: string; content: string }> = []
    if (Array.isArray(normalizedContexts) && normalizedContexts.length > 0) {
      try {
        const { processContextsServer } = await import('@/lib/copilot/process-contents')
        const processed = await processContextsServer(
          normalizedContexts as any,
          authenticatedUserId,
          message,
          resolvedWorkspaceId,
          actualChatId
        )
        agentContexts = processed
        logger.info(`[${tracker.requestId}] Contexts processed for request`, {
          processedCount: agentContexts.length,
          kinds: agentContexts.map((c) => c.type),
          lengthPreview: agentContexts.map((c) => c.content?.length ?? 0),
        })
        if (
          Array.isArray(normalizedContexts) &&
          normalizedContexts.length > 0 &&
          agentContexts.length === 0
        ) {
          logger.warn(
            `[${tracker.requestId}] Contexts provided but none processed. Check executionId for logs contexts.`
          )
        }
      } catch (e) {
        logger.error(`[${tracker.requestId}] Failed to process contexts`, e)
      }
    }

    if (
      Array.isArray(resourceAttachments) &&
      resourceAttachments.length > 0 &&
      resolvedWorkspaceId
    ) {
      const results = await Promise.allSettled(
        resourceAttachments.map(async (r) => {
          const ctx = await resolveActiveResourceContext(
            r.type,
            r.id,
            resolvedWorkspaceId!,
            authenticatedUserId,
            actualChatId
          )
          if (!ctx) return null
          return {
            ...ctx,
            tag: r.active ? '@active_tab' : '@open_tab',
          }
        })
      )
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          agentContexts.push(result.value)
        } else if (result.status === 'rejected') {
          logger.error(
            `[${tracker.requestId}] Failed to resolve resource attachment`,
            result.reason
          )
        }
      }
    }

    const effectiveMode = mode === 'agent' ? 'build' : mode

    const userPermission = resolvedWorkspaceId
      ? await getUserEntityPermissions(authenticatedUserId, 'workspace', resolvedWorkspaceId).catch(
          () => null
        )
      : null

    const requestPayload = await buildCopilotRequestPayload(
      {
        message,
        workflowId: workflowId || '',
        workflowName: workflowResolvedName,
        workspaceId: resolvedWorkspaceId,
        userId: authenticatedUserId,
        userMessageId: userMessageIdToUse,
        mode,
        model: selectedModel,
        provider,
        contexts: agentContexts,
        fileAttachments,
        commands,
        chatId: actualChatId,
        prefetch,
        implicitFeedback,
        userPermission: userPermission ?? undefined,
        userTimezone,
      },
      {
        selectedModel,
      }
    )

    try {
      logger.info(`[${tracker.requestId}] About to call Sim Agent`, {
        hasContext: agentContexts.length > 0,
        contextCount: agentContexts.length,
        hasFileAttachments: Array.isArray(requestPayload.fileAttachments),
        messageLength: message.length,
        mode: effectiveMode,
        hasTools: Array.isArray(requestPayload.tools),
        toolCount: Array.isArray(requestPayload.tools) ? requestPayload.tools.length : 0,
        hasBaseTools: Array.isArray(requestPayload.baseTools),
        baseToolCount: Array.isArray(requestPayload.baseTools)
          ? requestPayload.baseTools.length
          : 0,
        hasCredentials: !!requestPayload.credentials,
      })
    } catch {}

    if (stream && actualChatId) {
      const acquired = await acquirePendingChatStream(actualChatId, userMessageIdToUse)
      if (!acquired) {
        return NextResponse.json(
          {
            error:
              'A response is already in progress for this chat. Wait for it to finish or use Stop.',
          },
          { status: 409 }
        )
      }
      pendingChatStreamAcquired = true
      pendingChatStreamID = userMessageIdToUse
    }

    if (actualChatId) {
      const userMsg = {
        id: userMessageIdToUse,
        role: 'user' as const,
        content: message,
        timestamp: new Date().toISOString(),
        ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
        ...(Array.isArray(normalizedContexts) &&
          normalizedContexts.length > 0 && {
            contexts: normalizedContexts,
          }),
      }

      const [updated] = await db
        .update(copilotChats)
        .set({
          messages: sql`${copilotChats.messages} || ${JSON.stringify([userMsg])}::jsonb`,
          conversationId: userMessageIdToUse,
          updatedAt: new Date(),
        })
        .where(eq(copilotChats.id, actualChatId))
        .returning({ messages: copilotChats.messages })

      if (updated) {
        const freshMessages: any[] = Array.isArray(updated.messages) ? updated.messages : []
        conversationHistory = freshMessages.filter((m: any) => m.id !== userMessageIdToUse)
      }
    }

    if (stream) {
      const executionId = crypto.randomUUID()
      const runId = crypto.randomUUID()
      const sseStream = createSSEStream({
        requestPayload,
        userId: authenticatedUserId,
        streamId: userMessageIdToUse,
        executionId,
        runId,
        chatId: actualChatId,
        currentChat,
        isNewChat: conversationHistory.length === 0,
        message,
        titleModel: selectedModel,
        titleProvider: provider,
        requestId: tracker.requestId,
        workspaceId: resolvedWorkspaceId,
        pendingChatStreamAlreadyRegistered: Boolean(actualChatId && stream),
        orchestrateOptions: {
          userId: authenticatedUserId,
          workflowId,
          chatId: actualChatId,
          executionId,
          runId,
          goRoute: '/api/copilot',
          autoExecuteTools: true,
          interactive: true,
          onComplete: async (result: OrchestratorResult) => {
            if (!actualChatId) return
            if (!result.success) return

            const assistantMessage: Record<string, unknown> = {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: result.content,
              timestamp: new Date().toISOString(),
              ...(result.requestId ? { requestId: result.requestId } : {}),
            }
            if (result.toolCalls.length > 0) {
              assistantMessage.toolCalls = result.toolCalls
            }
            if (result.contentBlocks.length > 0) {
              assistantMessage.contentBlocks = result.contentBlocks.map((block) => {
                const stored: Record<string, unknown> = { type: block.type }
                if (block.content) stored.content = block.content
                if (block.type === 'tool_call' && block.toolCall) {
                  const state =
                    block.toolCall.result?.success !== undefined
                      ? block.toolCall.result.success
                        ? 'success'
                        : 'error'
                      : block.toolCall.status
                  const isSubagentTool = !!block.calledBy
                  const isNonTerminal =
                    state === 'cancelled' || state === 'pending' || state === 'executing'
                  stored.toolCall = {
                    id: block.toolCall.id,
                    name: block.toolCall.name,
                    state,
                    ...(isSubagentTool && isNonTerminal ? {} : { result: block.toolCall.result }),
                    ...(isSubagentTool && isNonTerminal
                      ? {}
                      : block.toolCall.params
                        ? { params: block.toolCall.params }
                        : {}),
                    ...(block.calledBy ? { calledBy: block.calledBy } : {}),
                  }
                }
                return stored
              })
            }

            try {
              const [row] = await db
                .select({ messages: copilotChats.messages })
                .from(copilotChats)
                .where(eq(copilotChats.id, actualChatId))
                .limit(1)

              const msgs: any[] = Array.isArray(row?.messages) ? row.messages : []
              const userIdx = msgs.findIndex((m: any) => m.id === userMessageIdToUse)
              const alreadyHasResponse =
                userIdx >= 0 &&
                userIdx + 1 < msgs.length &&
                (msgs[userIdx + 1] as any)?.role === 'assistant'

              if (!alreadyHasResponse) {
                await db
                  .update(copilotChats)
                  .set({
                    messages: sql`${copilotChats.messages} || ${JSON.stringify([assistantMessage])}::jsonb`,
                    conversationId: sql`CASE WHEN ${copilotChats.conversationId} = ${userMessageIdToUse} THEN NULL ELSE ${copilotChats.conversationId} END`,
                    updatedAt: new Date(),
                  })
                  .where(eq(copilotChats.id, actualChatId))
              }
            } catch (error) {
              logger.error(`[${tracker.requestId}] Failed to persist chat messages`, {
                chatId: actualChatId,
                error: error instanceof Error ? error.message : 'Unknown error',
              })
            }
          },
        },
      })
      pendingChatStreamHandedOff = true

      return new Response(sseStream, { headers: SSE_RESPONSE_HEADERS })
    }

    const nonStreamingResult = await orchestrateCopilotStream(requestPayload, {
      userId: authenticatedUserId,
      workflowId,
      chatId: actualChatId,
      goRoute: '/api/copilot',
      autoExecuteTools: true,
      interactive: true,
    })

    const responseData = {
      content: nonStreamingResult.content,
      toolCalls: nonStreamingResult.toolCalls,
      model: selectedModel,
      provider: typeof requestPayload?.provider === 'string' ? requestPayload.provider : undefined,
    }

    logger.info(`[${tracker.requestId}] Non-streaming response from orchestrator:`, {
      hasContent: !!responseData.content,
      contentLength: responseData.content?.length || 0,
      model: responseData.model,
      provider: responseData.provider,
      toolCallsCount: responseData.toolCalls?.length || 0,
    })

    // Save messages if we have a chat
    if (currentChat && responseData.content) {
      const userMessage = {
        id: userMessageIdToUse, // Consistent ID used for request and persistence
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
        ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
        ...(Array.isArray(normalizedContexts) &&
          normalizedContexts.length > 0 && {
            contexts: normalizedContexts,
          }),
        ...(Array.isArray(normalizedContexts) &&
          normalizedContexts.length > 0 && {
            contentBlocks: [
              { type: 'contexts', contexts: normalizedContexts as any, timestamp: Date.now() },
            ],
          }),
      }

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: responseData.content,
        timestamp: new Date().toISOString(),
      }

      const updatedMessages = [...conversationHistory, userMessage, assistantMessage]

      // Start title generation in parallel if this is first message (non-streaming)
      if (actualChatId && !currentChat.title && conversationHistory.length === 0) {
        logger.info(`[${tracker.requestId}] Starting title generation for non-streaming response`)
        requestChatTitle({ message, model: selectedModel, provider })
          .then(async (title) => {
            if (title) {
              await db
                .update(copilotChats)
                .set({
                  title,
                  updatedAt: new Date(),
                })
                .where(eq(copilotChats.id, actualChatId!))
              logger.info(`[${tracker.requestId}] Generated and saved title: ${title}`)
            }
          })
          .catch((error) => {
            logger.error(`[${tracker.requestId}] Title generation failed:`, error)
          })
      }

      // Update chat in database immediately (without blocking for title)
      await db
        .update(copilotChats)
        .set({
          messages: updatedMessages,
          updatedAt: new Date(),
        })
        .where(eq(copilotChats.id, actualChatId!))
    }

    logger.info(`[${tracker.requestId}] Returning non-streaming response`, {
      duration: tracker.getDuration(),
      chatId: actualChatId,
      responseLength: responseData.content?.length || 0,
    })

    return NextResponse.json({
      success: true,
      response: responseData,
      chatId: actualChatId,
      metadata: {
        requestId: tracker.requestId,
        message,
        duration: tracker.getDuration(),
      },
    })
  } catch (error) {
    if (
      actualChatId &&
      pendingChatStreamAcquired &&
      !pendingChatStreamHandedOff &&
      pendingChatStreamID
    ) {
      await releasePendingChatStream(actualChatId, pendingChatStreamID).catch(() => {})
    }
    const duration = tracker.getDuration()

    if (error instanceof z.ZodError) {
      logger.error(`[${tracker.requestId}] Validation error:`, {
        duration,
        errors: error.errors,
      })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${tracker.requestId}] Error handling copilot chat:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const workflowId = searchParams.get('workflowId')
    const workspaceId = searchParams.get('workspaceId')
    const chatId = searchParams.get('chatId')

    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    if (chatId) {
      const chat = await getAccessibleCopilotChat(chatId, authenticatedUserId)

      if (!chat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      let streamSnapshot: {
        events: Array<{ eventId: number; streamId: string; event: Record<string, unknown> }>
        status: string
      } | null = null

      if (chat.conversationId) {
        try {
          const [meta, events] = await Promise.all([
            getStreamMeta(chat.conversationId),
            readStreamEvents(chat.conversationId, 0),
          ])
          streamSnapshot = {
            events: events || [],
            status: meta?.status || 'unknown',
          }
        } catch (err) {
          logger.warn('Failed to read stream snapshot for chat', {
            chatId,
            conversationId: chat.conversationId,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const transformedChat = {
        id: chat.id,
        title: chat.title,
        model: chat.model,
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
        planArtifact: chat.planArtifact || null,
        config: chat.config || null,
        conversationId: chat.conversationId || null,
        resources: Array.isArray(chat.resources) ? chat.resources : [],
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        ...(streamSnapshot ? { streamSnapshot } : {}),
      }

      logger.info(`Retrieved chat ${chatId}`)
      return NextResponse.json({ success: true, chat: transformedChat })
    }

    if (!workflowId && !workspaceId) {
      return createBadRequestResponse('workflowId, workspaceId, or chatId is required')
    }

    if (workspaceId) {
      await assertActiveWorkspaceAccess(workspaceId, authenticatedUserId)
    }

    if (workflowId) {
      const authorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: authenticatedUserId,
        action: 'read',
      })
      if (!authorization.allowed) {
        return createUnauthorizedResponse()
      }
    }

    const scopeFilter = workflowId
      ? eq(copilotChats.workflowId, workflowId)
      : eq(copilotChats.workspaceId, workspaceId!)

    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        model: copilotChats.model,
        messages: copilotChats.messages,
        planArtifact: copilotChats.planArtifact,
        config: copilotChats.config,
        createdAt: copilotChats.createdAt,
        updatedAt: copilotChats.updatedAt,
      })
      .from(copilotChats)
      .where(and(eq(copilotChats.userId, authenticatedUserId), scopeFilter))
      .orderBy(desc(copilotChats.updatedAt))

    const transformedChats = chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      model: chat.model,
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
      planArtifact: chat.planArtifact || null,
      config: chat.config || null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }))

    const scope = workflowId ? `workflow ${workflowId}` : `workspace ${workspaceId}`
    logger.info(`Retrieved ${transformedChats.length} chats for ${scope}`)

    return NextResponse.json({
      success: true,
      chats: transformedChats,
    })
  } catch (error) {
    logger.error('Error fetching copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch chats')
  }
}
