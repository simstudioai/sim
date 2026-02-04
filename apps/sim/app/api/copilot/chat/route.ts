import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { generateChatTitle } from '@/lib/copilot/chat-title'
import { getCopilotModel } from '@/lib/copilot/config'
import { SIM_AGENT_VERSION } from '@/lib/copilot/constants'
import { COPILOT_MODEL_IDS, COPILOT_REQUEST_MODES } from '@/lib/copilot/models'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request-helpers'
import { getCredentialsServerTool } from '@/lib/copilot/tools/server/user/get-credentials'
import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { env } from '@/lib/core/config/env'
import { CopilotFiles } from '@/lib/uploads'
import { createFileContent } from '@/lib/uploads/utils/file-utils'
import { resolveWorkflowIdForUser } from '@/lib/workflows/utils'
import { tools } from '@/tools/registry'
import { getLatestVersionTools, stripVersionSuffix } from '@/tools/utils'
import { orchestrateCopilotStream } from '@/lib/copilot/orchestrator'
import {
  createStreamEventWriter,
  resetStreamBuffer,
  setStreamMeta,
} from '@/lib/copilot/orchestrator/stream-buffer'

const logger = createLogger('CopilotChatAPI')


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
  model: z.enum(COPILOT_MODEL_IDS).optional().default('claude-4.5-opus'),
  mode: z.enum(COPILOT_REQUEST_MODES).optional().default('agent'),
  prefetch: z.boolean().optional(),
  createNewChat: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(true),
  implicitFeedback: z.string().optional(),
  fileAttachments: z.array(FileAttachmentSchema).optional(),
  provider: z.string().optional().default('openai'),
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

    if (chatId) {
      // Load existing chat
      const [chat] = await db
        .select()
        .from(copilotChats)
        .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, authenticatedUserId)))
        .limit(1)

      if (chat) {
        currentChat = chat
        conversationHistory = Array.isArray(chat.messages) ? chat.messages : []
      }
    } else if (createNewChat && workflowId) {
      // Create new chat
      const { provider, model } = getCopilotModel('chat')
      const [newChat] = await db
        .insert(copilotChats)
        .values({
          userId: authenticatedUserId,
          workflowId,
          title: null,
          model,
          messages: [],
        })
        .returning()

      if (newChat) {
        currentChat = newChat
        actualChatId = newChat.id
      }
    }

    // Process file attachments if present
    const processedFileContents: any[] = []
    if (fileAttachments && fileAttachments.length > 0) {
      const processedAttachments = await CopilotFiles.processCopilotAttachments(
        fileAttachments,
        tracker.requestId
      )

      for (const { buffer, attachment } of processedAttachments) {
        const fileContent = createFileContent(buffer, attachment.media_type)
        if (fileContent) {
          processedFileContents.push(fileContent)
        }
      }
    }

    // Build messages array for sim agent with conversation history
    const messages: any[] = []

    // Add conversation history (need to rebuild these with file support if they had attachments)
    for (const msg of conversationHistory) {
      if (msg.fileAttachments && msg.fileAttachments.length > 0) {
        // This is a message with file attachments - rebuild with content array
        const content: any[] = [{ type: 'text', text: msg.content }]

        const processedHistoricalAttachments = await CopilotFiles.processCopilotAttachments(
          msg.fileAttachments,
          tracker.requestId
        )

        for (const { buffer, attachment } of processedHistoricalAttachments) {
          const fileContent = createFileContent(buffer, attachment.media_type)
          if (fileContent) {
            content.push(fileContent)
          }
        }

        messages.push({
          role: msg.role,
          content,
        })
      } else {
        // Regular text-only message
        messages.push({
          role: msg.role,
          content: msg.content,
        })
      }
    }

    // Add implicit feedback if provided
    if (implicitFeedback) {
      messages.push({
        role: 'system',
        content: implicitFeedback,
      })
    }

    // Add current user message with file attachments
    if (processedFileContents.length > 0) {
      // Message with files - use content array format
      const content: any[] = [{ type: 'text', text: message }]

      // Add file contents
      for (const fileContent of processedFileContents) {
        content.push(fileContent)
      }

      messages.push({
        role: 'user',
        content,
      })
    } else {
      // Text-only message
      messages.push({
        role: 'user',
        content: message,
      })
    }

    const defaults = getCopilotModel('chat')
    const selectedModel = model || defaults.model
    const envModel = env.COPILOT_MODEL || defaults.model

    let providerConfig: CopilotProviderConfig | undefined
    const providerEnv = env.COPILOT_PROVIDER as any

    if (providerEnv) {
      if (providerEnv === 'azure-openai') {
        providerConfig = {
          provider: 'azure-openai',
          model: envModel,
          apiKey: env.AZURE_OPENAI_API_KEY,
          apiVersion: 'preview',
          endpoint: env.AZURE_OPENAI_ENDPOINT,
        }
      } else if (providerEnv === 'azure-anthropic') {
        providerConfig = {
          provider: 'azure-anthropic',
          model: envModel,
          apiKey: env.AZURE_ANTHROPIC_API_KEY,
          apiVersion: env.AZURE_ANTHROPIC_API_VERSION,
          endpoint: env.AZURE_ANTHROPIC_ENDPOINT,
        }
      } else if (providerEnv === 'vertex') {
        providerConfig = {
          provider: 'vertex',
          model: envModel,
          apiKey: env.COPILOT_API_KEY,
          vertexProject: env.VERTEX_PROJECT,
          vertexLocation: env.VERTEX_LOCATION,
        }
      } else {
        providerConfig = {
          provider: providerEnv,
          model: selectedModel,
          apiKey: env.COPILOT_API_KEY,
        }
      }
    }

    const effectiveMode = mode === 'agent' ? 'build' : mode
    const transportMode = effectiveMode === 'build' ? 'agent' : effectiveMode

    // Determine conversationId to use for this request
    const effectiveConversationId =
      (currentChat?.conversationId as string | undefined) || conversationId

    // For agent/build mode, fetch credentials and build tool definitions
    let integrationTools: any[] = []
    let baseTools: any[] = []
    let credentials: {
      oauth: Record<
        string,
        { accessToken: string; accountId: string; name: string; expiresAt?: string }
      >
      apiKeys: string[]
      metadata?: {
        connectedOAuth: Array<{ provider: string; name: string; scopes?: string[] }>
        configuredApiKeys: string[]
      }
    } | null = null

    if (effectiveMode === 'build') {
      // Build base tools (executed locally, not deferred)
      // Include function_execute for code execution capability
      baseTools = [
        {
          name: 'function_execute',
          description:
            'Execute JavaScript code to perform calculations, data transformations, API calls, or any programmatic task. Code runs in a secure sandbox with fetch() available. Write plain statements (not wrapped in functions). Example: const res = await fetch(url); const data = await res.json(); return data;',
          input_schema: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description:
                  'Raw JavaScript statements to execute. Code is auto-wrapped in async context. Use fetch() for HTTP requests. Write like: const res = await fetch(url); return await res.json();',
              },
            },
            required: ['code'],
          },
          executeLocally: true,
        },
      ]
      // Fetch user credentials (OAuth + API keys) - pass workflowId to get workspace env vars
      try {
        const rawCredentials = await getCredentialsServerTool.execute(
          { workflowId },
          { userId: authenticatedUserId }
        )

        // Transform OAuth credentials to map format: { [provider]: { accessToken, accountId, ... } }
        const oauthMap: Record<
          string,
          { accessToken: string; accountId: string; name: string; expiresAt?: string }
        > = {}
        const connectedOAuth: Array<{ provider: string; name: string; scopes?: string[] }> = []
        for (const cred of rawCredentials?.oauth?.connected?.credentials || []) {
          if (cred.accessToken) {
            oauthMap[cred.provider] = {
              accessToken: cred.accessToken,
              accountId: cred.id,
              name: cred.name,
            }
            connectedOAuth.push({
              provider: cred.provider,
              name: cred.name,
            })
          }
        }

        credentials = {
          oauth: oauthMap,
          apiKeys: rawCredentials?.environment?.variableNames || [],
          metadata: {
            connectedOAuth,
            configuredApiKeys: rawCredentials?.environment?.variableNames || [],
          },
        }

        logger.info(`[${tracker.requestId}] Fetched credentials for build mode`, {
          oauthProviders: Object.keys(oauthMap),
          apiKeyCount: credentials.apiKeys.length,
        })
      } catch (error) {
        logger.warn(`[${tracker.requestId}] Failed to fetch credentials`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // Build tool definitions (schemas only)
      try {
        const { createUserToolSchema } = await import('@/tools/params')

        const latestTools = getLatestVersionTools(tools)

        integrationTools = Object.entries(latestTools).map(([toolId, toolConfig]) => {
          const userSchema = createUserToolSchema(toolConfig)
          const strippedName = stripVersionSuffix(toolId)
          return {
            name: strippedName,
            description: toolConfig.description || toolConfig.name || strippedName,
            input_schema: userSchema,
            defer_loading: true, // Anthropic Advanced Tool Use
            ...(toolConfig.oauth?.required && {
              oauth: {
                required: true,
                provider: toolConfig.oauth.provider,
              },
            }),
          }
        })

        logger.info(`[${tracker.requestId}] Built tool definitions for build mode`, {
          integrationToolCount: integrationTools.length,
        })
      } catch (error) {
        logger.warn(`[${tracker.requestId}] Failed to build tool definitions`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const requestPayload = {
      message: message, // Just send the current user message text
      workflowId,
      userId: authenticatedUserId,
      stream: stream,
      streamToolCalls: true,
      model: selectedModel,
      mode: transportMode,
      messageId: userMessageIdToUse,
      version: SIM_AGENT_VERSION,
      ...(providerConfig ? { provider: providerConfig } : {}),
      ...(effectiveConversationId ? { conversationId: effectiveConversationId } : {}),
      ...(typeof prefetch === 'boolean' ? { prefetch: prefetch } : {}),
      ...(session?.user?.name && { userName: session.user.name }),
      ...(agentContexts.length > 0 && { context: agentContexts }),
      ...(actualChatId ? { chatId: actualChatId } : {}),
      ...(processedFileContents.length > 0 && { fileAttachments: processedFileContents }),
      // For build/agent mode, include tools and credentials
      ...(integrationTools.length > 0 && { tools: integrationTools }),
      ...(baseTools.length > 0 && { baseTools }),
      ...(credentials && { credentials }),
      ...(commands && commands.length > 0 && { commands }),
    }

    try {
      logger.info(`[${tracker.requestId}] About to call Sim Agent`, {
        hasContext: agentContexts.length > 0,
        contextCount: agentContexts.length,
        hasConversationId: !!effectiveConversationId,
        hasFileAttachments: processedFileContents.length > 0,
        messageLength: message.length,
        mode: effectiveMode,
        hasTools: integrationTools.length > 0,
        toolCount: integrationTools.length,
        hasBaseTools: baseTools.length > 0,
        baseToolCount: baseTools.length,
        hasCredentials: !!credentials,
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
            generateChatTitle(message)
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
      provider: providerConfig?.provider || env.COPILOT_PROVIDER || 'openai',
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
        generateChatTitle(message)
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
