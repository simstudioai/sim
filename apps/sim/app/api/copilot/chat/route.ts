import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { buildConversationHistory } from '@/lib/copilot/chat-context'
import { resolveOrCreateChat } from '@/lib/copilot/chat-lifecycle'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat-payload'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { COPILOT_REQUEST_MODES } from '@/lib/copilot/models'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import {
  createStreamEventWriter,
  resetStreamBuffer,
  setStreamMeta,
} from '@/lib/copilot/orchestrator/stream-buffer'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { env } from '@/lib/core/config/env'
import { resolveWorkflowIdForUser } from '@/lib/workflows/utils'

const logger = createLogger('CopilotChatAPI')

async function requestChatTitleFromCopilot(params: {
  message: string
  model: string
  provider?: string
}): Promise<string | null> {
  const { message, model, provider } = params
  if (!message || !model) return null

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (env.COPILOT_API_KEY) {
    headers['x-api-key'] = env.COPILOT_API_KEY
  }

  try {
    const response = await fetch(`${SIM_AGENT_API_URL}/api/generate-chat-title`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        model,
        ...(provider ? { provider } : {}),
      }),
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      logger.warn('Failed to generate chat title via copilot backend', {
        status: response.status,
        error: payload,
      })
      return null
    }

    const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
    return title || null
  } catch (error) {
    logger.error('Error generating chat title:', error)
    return null
  }
}

const FileAttachmentSchema = z.object({
  id: z.string(),
  key: z.string(),
  filename: z.string(),
  media_type: z.string(),
  size: z.number(),
})

const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  userMessageId: z.string().optional(), // ID from frontend for the user message
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  workflowName: z.string().optional(),
  model: z.string().optional().default('claude-opus-4-6'),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  prefetch: z.boolean().optional(),
  createNewChat: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(true),
  implicitFeedback: z.string().optional(),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  provider: z.string().optional(),
  conversationId: z.string().optional(),
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
        templateId: z.string().optional(),
        executionId: z.string().optional(),
        // For workflow_block, provide both workflowId and blockId
      })
    )
    .optional(),
  commands: z.array(z.string()).optional(),
})

/**
 * POST /api/copilot/chat
 * Send messages to sim agent and handle chat persistence
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

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
      workflowName,
      model,
      mode,
      prefetch,
      createNewChat,
      stream,
      implicitFeedback,
      fileAttachments,
      provider,
      conversationId,
      contexts,
      commands,
    } = ChatMessageSchema.parse(body)

    // Resolve workflowId - if not provided, use first workflow or find by name
    const resolved = await resolveWorkflowIdForUser(
      authenticatedUserId,
      providedWorkflowId,
      workflowName
    )
    if (!resolved) {
      return createBadRequestResponse(
        'No workflows found. Create a workflow first or provide a valid workflowId.'
      )
    }
    const workflowId = resolved.workflowId

    // Ensure we have a consistent user message ID for this request
    const userMessageIdToUse = userMessageId || crypto.randomUUID()
    try {
      logger.info(`[${tracker.requestId}] Received chat POST`, {
        hasContexts: Array.isArray(contexts),
        contextsCount: Array.isArray(contexts) ? contexts.length : 0,
        contextsPreview: Array.isArray(contexts)
          ? contexts.map((c: any) => ({
              kind: c?.kind,
              chatId: c?.chatId,
              workflowId: c?.workflowId,
              executionId: (c as any)?.executionId,
              label: c?.label,
            }))
          : undefined,
      })
    } catch {}
    // Preprocess contexts server-side
    let agentContexts: Array<{ type: string; content: string }> = []
    if (Array.isArray(contexts) && contexts.length > 0) {
      try {
        const { processContextsServer } = await import('@/lib/copilot/process-contents')
        const processed = await processContextsServer(contexts as any, authenticatedUserId, message)
        agentContexts = processed
        logger.info(`[${tracker.requestId}] Contexts processed for request`, {
          processedCount: agentContexts.length,
          kinds: agentContexts.map((c) => c.type),
          lengthPreview: agentContexts.map((c) => c.content?.length ?? 0),
        })
        if (Array.isArray(contexts) && contexts.length > 0 && agentContexts.length === 0) {
          logger.warn(
            `[${tracker.requestId}] Contexts provided but none processed. Check executionId for logs contexts.`
          )
        }
      } catch (e) {
        logger.error(`[${tracker.requestId}] Failed to process contexts`, e)
      }
    }

    // Handle chat context
    let currentChat: any = null
    let conversationHistory: any[] = []
    let actualChatId = chatId
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
      const history = buildConversationHistory(
        chatResult.conversationHistory,
        (chatResult.chat?.conversationId as string | undefined) || conversationId
      )
      conversationHistory = history.history
    }

    const effectiveMode = mode === 'agent' ? 'build' : mode
    const effectiveConversationId =
      (currentChat?.conversationId as string | undefined) || conversationId

    const requestPayload = await buildCopilotRequestPayload(
      {
        message,
        workflowId,
        userId: authenticatedUserId,
        userMessageId: userMessageIdToUse,
        mode,
        model: selectedModel,
        provider,
        conversationHistory,
        contexts: agentContexts,
        fileAttachments,
        commands,
        chatId: actualChatId,
        implicitFeedback,
      },
      {
        selectedModel,
      }
    )

    try {
      logger.info(`[${tracker.requestId}] About to call Sim Agent`, {
        hasContext: agentContexts.length > 0,
        contextCount: agentContexts.length,
        hasConversationId: !!effectiveConversationId,
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

    if (stream) {
      const streamId = userMessageIdToUse
      let eventWriter: ReturnType<typeof createStreamEventWriter> | null = null
      let clientDisconnected = false
      const transformedStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()

          await resetStreamBuffer(streamId)
          await setStreamMeta(streamId, { status: 'active', userId: authenticatedUserId })
          eventWriter = createStreamEventWriter(streamId)

          const shouldFlushEvent = (event: Record<string, any>) =>
            event.type === 'tool_call' ||
            event.type === 'tool_result' ||
            event.type === 'tool_error' ||
            event.type === 'subagent_end' ||
            event.type === 'structured_result' ||
            event.type === 'subagent_result' ||
            event.type === 'done' ||
            event.type === 'error'

          const pushEvent = async (event: Record<string, any>) => {
            if (!eventWriter) return
            const entry = await eventWriter.write(event)
            if (shouldFlushEvent(event)) {
              await eventWriter.flush()
            }
            const payload = {
              ...event,
              eventId: entry.eventId,
              streamId,
            }
            try {
              if (!clientDisconnected) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
              }
            } catch {
              clientDisconnected = true
              await eventWriter.flush()
            }
          }

          if (actualChatId) {
            await pushEvent({ type: 'chat_id', chatId: actualChatId })
          }

          if (actualChatId && !currentChat?.title && conversationHistory.length === 0) {
            requestChatTitleFromCopilot({ message, model: selectedModel, provider })
              .then(async (title) => {
                if (title) {
                  await db
                    .update(copilotChats)
                    .set({
                      title,
                      updatedAt: new Date(),
                    })
                    .where(eq(copilotChats.id, actualChatId!))
                  await pushEvent({ type: 'title_updated', title })
                }
              })
              .catch((error) => {
                logger.error(`[${tracker.requestId}] Title generation failed:`, error)
              })
          }

          try {
            const result = await orchestrateCopilotStream(requestPayload, {
              userId: authenticatedUserId,
              workflowId,
              chatId: actualChatId,
              autoExecuteTools: true,
              interactive: true,
              onEvent: async (event) => {
                await pushEvent(event)
              },
            })

            if (currentChat && result.conversationId) {
              await db
                .update(copilotChats)
                .set({
                  updatedAt: new Date(),
                  conversationId: result.conversationId,
                })
                .where(eq(copilotChats.id, actualChatId!))
            }
            await eventWriter.close()
            await setStreamMeta(streamId, { status: 'complete', userId: authenticatedUserId })
          } catch (error) {
            logger.error(`[${tracker.requestId}] Orchestration error:`, error)
            await eventWriter.close()
            await setStreamMeta(streamId, {
              status: 'error',
              userId: authenticatedUserId,
              error: error instanceof Error ? error.message : 'Stream error',
            })
            await pushEvent({
              type: 'error',
              data: {
                displayMessage: 'An unexpected error occurred while processing the response.',
              },
            })
          } finally {
            controller.close()
          }
        },
        async cancel() {
          clientDisconnected = true
          if (eventWriter) {
            await eventWriter.flush()
          }
        },
      })

      return new Response(transformedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    const nonStreamingResult = await orchestrateCopilotStream(requestPayload, {
      userId: authenticatedUserId,
      workflowId,
      chatId: actualChatId,
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
        ...(Array.isArray(contexts) && contexts.length > 0 && { contexts }),
        ...(Array.isArray(contexts) &&
          contexts.length > 0 && {
            contentBlocks: [{ type: 'contexts', contexts: contexts as any, timestamp: Date.now() }],
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
        requestChatTitleFromCopilot({ message, model: selectedModel, provider })
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
          ...(nonStreamingResult.conversationId
            ? { conversationId: nonStreamingResult.conversationId }
            : {}),
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
    const chatId = searchParams.get('chatId')

    // Get authenticated user using consolidated helper
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    // If chatId is provided, fetch a single chat
    if (chatId) {
      const [chat] = await db
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
        .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, authenticatedUserId)))
        .limit(1)

      if (!chat) {
        return NextResponse.json({ success: false, error: 'Chat not found' }, { status: 404 })
      }

      const transformedChat = {
        id: chat.id,
        title: chat.title,
        model: chat.model,
        messages: Array.isArray(chat.messages) ? chat.messages : [],
        messageCount: Array.isArray(chat.messages) ? chat.messages.length : 0,
        planArtifact: chat.planArtifact || null,
        config: chat.config || null,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }

      logger.info(`Retrieved chat ${chatId}`)
      return NextResponse.json({ success: true, chat: transformedChat })
    }

    if (!workflowId) {
      return createBadRequestResponse('workflowId or chatId is required')
    }

    // Fetch chats for this user and workflow
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
      .where(
        and(eq(copilotChats.userId, authenticatedUserId), eq(copilotChats.workflowId, workflowId))
      )
      .orderBy(desc(copilotChats.updatedAt))

    // Transform the data to include message count
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

    logger.info(`Retrieved ${transformedChats.length} chats for workflow ${workflowId}`)

    return NextResponse.json({
      success: true,
      chats: transformedChats,
    })
  } catch (error) {
    logger.error('Error fetching copilot chats:', error)
    return createInternalServerErrorResponse('Failed to fetch chats')
  }
}
