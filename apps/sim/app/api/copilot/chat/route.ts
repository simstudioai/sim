import { and, desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { getCopilotModel } from '@/lib/copilot/config'
import type { CopilotProviderConfig } from '@/lib/copilot/types'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { SIM_AGENT_API_URL_DEFAULT } from '@/lib/sim-agent'
import { generateChatTitle } from '@/lib/sim-agent/utils'
import { createFileContent, isSupportedFileType } from '@/lib/uploads/file-utils'
import { S3_COPILOT_CONFIG } from '@/lib/uploads/setup'
import { downloadFile, getStorageProvider } from '@/lib/uploads/storage-client'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'

const logger = createLogger('CopilotChatAPI')

const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || SIM_AGENT_API_URL_DEFAULT

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
  workflowId: z.string().min(1, 'Workflow ID is required'),
  mode: z.enum(['ask', 'agent']).optional().default('agent'),
  depth: z.number().int().min(0).max(3).optional().default(0),
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
      workflowId,
      mode,
      depth,
      prefetch,
      createNewChat,
      stream,
      implicitFeedback,
      fileAttachments,
      provider,
      conversationId,
      contexts,
    } = ChatMessageSchema.parse(body)
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

    // Consolidation mapping: map negative depths to base depth with prefetch=true
    let effectiveDepth: number | undefined = typeof depth === 'number' ? depth : undefined
    let effectivePrefetch: boolean | undefined = prefetch
    if (typeof effectiveDepth === 'number') {
      if (effectiveDepth === -2) {
        effectiveDepth = 1
        effectivePrefetch = true
      } else if (effectiveDepth === -1) {
        effectiveDepth = 0
        effectivePrefetch = true
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
      for (const attachment of fileAttachments) {
        try {
          // Check if file type is supported
          if (!isSupportedFileType(attachment.media_type)) {
            logger.warn(`[${tracker.requestId}] Unsupported file type: ${attachment.media_type}`)
            continue
          }

          const storageProvider = getStorageProvider()
          let fileBuffer: Buffer

          if (storageProvider === 's3') {
            fileBuffer = await downloadFile(attachment.key, {
              bucket: S3_COPILOT_CONFIG.bucket,
              region: S3_COPILOT_CONFIG.region,
            })
          } else if (storageProvider === 'blob') {
            const { BLOB_COPILOT_CONFIG } = await import('@/lib/uploads/setup')
            fileBuffer = await downloadFile(attachment.key, {
              containerName: BLOB_COPILOT_CONFIG.containerName,
              accountName: BLOB_COPILOT_CONFIG.accountName,
              accountKey: BLOB_COPILOT_CONFIG.accountKey,
              connectionString: BLOB_COPILOT_CONFIG.connectionString,
            })
          } else {
            fileBuffer = await downloadFile(attachment.key)
          }

          // Convert to format
          const fileContent = createFileContent(fileBuffer, attachment.media_type)
          if (fileContent) {
            processedFileContents.push(fileContent)
          }
        } catch (error) {
          logger.error(
            `[${tracker.requestId}] Failed to process file ${attachment.filename}:`,
            error
          )
          // Continue processing other files
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

        // Process file attachments for historical messages
        for (const attachment of msg.fileAttachments) {
          try {
            if (isSupportedFileType(attachment.media_type)) {
              const storageProvider = getStorageProvider()
              let fileBuffer: Buffer

              if (storageProvider === 's3') {
                fileBuffer = await downloadFile(attachment.key, {
                  bucket: S3_COPILOT_CONFIG.bucket,
                  region: S3_COPILOT_CONFIG.region,
                })
              } else if (storageProvider === 'blob') {
                const { BLOB_COPILOT_CONFIG } = await import('@/lib/uploads/setup')
                fileBuffer = await downloadFile(attachment.key, {
                  containerName: BLOB_COPILOT_CONFIG.containerName,
                  accountName: BLOB_COPILOT_CONFIG.accountName,
                  accountKey: BLOB_COPILOT_CONFIG.accountKey,
                  connectionString: BLOB_COPILOT_CONFIG.connectionString,
                })
              } else {
                fileBuffer = await downloadFile(attachment.key)
              }
              const fileContent = createFileContent(fileBuffer, attachment.media_type)
              if (fileContent) {
                content.push(fileContent)
              }
            }
          } catch (error) {
            logger.error(
              `[${tracker.requestId}] Failed to process historical file ${attachment.filename}:`,
              error
            )
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
    const modelToUse = env.COPILOT_MODEL || defaults.model

    let providerConfig: CopilotProviderConfig | undefined
    const providerEnv = env.COPILOT_PROVIDER as any

    if (providerEnv) {
      if (providerEnv === 'azure-openai') {
        providerConfig = {
          provider: 'azure-openai',
          model: modelToUse,
          apiKey: env.AZURE_OPENAI_API_KEY,
          apiVersion: 'preview',
          endpoint: env.AZURE_OPENAI_ENDPOINT,
        }
      } else {
        providerConfig = {
          provider: providerEnv,
          model: modelToUse,
          apiKey: env.COPILOT_API_KEY,
        }
      }
    }

    // Determine provider and conversationId to use for this request
    const effectiveConversationId =
      (currentChat?.conversationId as string | undefined) || conversationId

    // If we have a conversationId, only send the most recent user message; else send full history
    const latestUserMessage =
      [...messages].reverse().find((m) => m?.role === 'user') || messages[messages.length - 1]
    const messagesForAgent = effectiveConversationId ? [latestUserMessage] : messages

    const requestPayload = {
      messages: messagesForAgent,
      workflowId,
      userId: authenticatedUserId,
      stream: stream,
      streamToolCalls: true,
      mode: mode,
      messageId: userMessageIdToUse,
      chatId: actualChatId,
      ...(providerConfig ? { provider: providerConfig } : {}),
      ...(effectiveConversationId ? { conversationId: effectiveConversationId } : {}),
      ...(typeof effectiveDepth === 'number' ? { depth: effectiveDepth } : {}),
      ...(typeof effectivePrefetch === 'boolean' ? { prefetch: effectivePrefetch } : {}),
      ...(session?.user?.name && { userName: session.user.name }),
      ...(agentContexts.length > 0 && { context: agentContexts }),
    }

    try {
      logger.info(`[${tracker.requestId}] About to call Sim Agent with context`, {
        context: (requestPayload as any).context,
      })
    } catch {}

    const simAgentResponse = await fetch(`${SIM_AGENT_API_URL}/api/chat-completion-streaming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.COPILOT_API_KEY ? { 'x-api-key': env.COPILOT_API_KEY } : {}),
      },
      body: JSON.stringify(requestPayload),
    })

    if (!simAgentResponse.ok) {
      if (simAgentResponse.status === 401 || simAgentResponse.status === 402) {
        // Rethrow status only; client will render appropriate assistant message
        return new NextResponse(null, { status: simAgentResponse.status })
      }

      const errorText = await simAgentResponse.text().catch(() => '')
      logger.error(`[${tracker.requestId}] Sim agent API error:`, {
        status: simAgentResponse.status,
        error: errorText,
      })

      return NextResponse.json(
        { error: `Sim agent API error: ${simAgentResponse.statusText}` },
        { status: simAgentResponse.status }
      )
    }

    // If streaming is requested, forward the stream and update chat later
    if (stream && simAgentResponse.body) {
      // Create user message to save
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

      // Create a pass-through stream that captures the response
      const transformedStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          let assistantContent = ''
          const toolCalls: any[] = []
          let buffer = ''
          const isFirstDone = true
          let responseIdFromStart: string | undefined
          let responseIdFromDone: string | undefined
          // Track tool call progress to identify a safe done event
          const announcedToolCallIds = new Set<string>()
          const startedToolExecutionIds = new Set<string>()
          const completedToolExecutionIds = new Set<string>()
          let lastDoneResponseId: string | undefined
          let lastSafeDoneResponseId: string | undefined

          // Send chatId as first event
          if (actualChatId) {
            const chatIdEvent = `data: ${JSON.stringify({
              type: 'chat_id',
              chatId: actualChatId,
            })}\n\n`
            controller.enqueue(encoder.encode(chatIdEvent))
            logger.debug(`[${tracker.requestId}] Sent initial chatId event to client`)
          }

          // Start title generation in parallel if needed
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

                  const titleEvent = `data: ${JSON.stringify({
                    type: 'title_updated',
                    title: title,
                  })}\n\n`
                  controller.enqueue(encoder.encode(titleEvent))
                  logger.info(`[${tracker.requestId}] Generated and saved title: ${title}`)
                }
              })
              .catch((error) => {
                logger.error(`[${tracker.requestId}] Title generation failed:`, error)
              })
          } else {
            logger.debug(`[${tracker.requestId}] Skipping title generation`)
          }

          // Forward the sim agent stream and capture assistant response
          const reader = simAgentResponse.body!.getReader()
          const decoder = new TextDecoder()

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                break
              }

              // Decode and parse SSE events for logging and capturing content
              const decodedChunk = decoder.decode(value, { stream: true })
              buffer += decodedChunk

              const lines = buffer.split('\n')
              buffer = lines.pop() || '' // Keep incomplete line in buffer

              for (const line of lines) {
                if (line.trim() === '') continue // Skip empty lines

                if (line.startsWith('data: ') && line.length > 6) {
                  try {
                    const jsonStr = line.slice(6)

                    // Check if the JSON string is unusually large (potential streaming issue)
                    if (jsonStr.length > 50000) {
                      // 50KB limit
                      logger.warn(`[${tracker.requestId}] Large SSE event detected`, {
                        size: jsonStr.length,
                        preview: `${jsonStr.substring(0, 100)}...`,
                      })
                    }

                    const event = JSON.parse(jsonStr)

                    // Log different event types comprehensively
                    switch (event.type) {
                      case 'content':
                        if (event.data) {
                          assistantContent += event.data
                        }
                        break

                      case 'reasoning':
                        logger.debug(
                          `[${tracker.requestId}] Reasoning chunk received (${(event.data || event.content || '').length} chars)`
                        )
                        break

                      case 'tool_call':
                        if (!event.data?.partial) {
                          toolCalls.push(event.data)
                          if (event.data?.id) {
                            announcedToolCallIds.add(event.data.id)
                          }
                        }
                        break

                      case 'tool_generating':
                        if (event.toolCallId) {
                          startedToolExecutionIds.add(event.toolCallId)
                        }
                        break

                      case 'tool_result':
                        if (event.toolCallId) {
                          completedToolExecutionIds.add(event.toolCallId)
                        }
                        break

                      case 'tool_error':
                        logger.error(`[${tracker.requestId}] Tool error:`, {
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          error: event.error,
                          success: event.success,
                        })
                        if (event.toolCallId) {
                          completedToolExecutionIds.add(event.toolCallId)
                        }
                        break

                      case 'start':
                        if (event.data?.responseId) {
                          responseIdFromStart = event.data.responseId
                        }
                        break

                      case 'done':
                        if (event.data?.responseId) {
                          responseIdFromDone = event.data.responseId
                          lastDoneResponseId = responseIdFromDone

                          // Mark this done as safe only if no tool call is currently in progress or pending
                          const announced = announcedToolCallIds.size
                          const completed = completedToolExecutionIds.size
                          const started = startedToolExecutionIds.size
                          const hasToolInProgress = announced > completed || started > completed
                          if (!hasToolInProgress) {
                            lastSafeDoneResponseId = responseIdFromDone
                          }
                        }
                        break

                      case 'error':
                        break

                      default:
                    }

                    // Emit to client: rewrite 'error' events into user-friendly assistant message
                    if (event?.type === 'error') {
                      try {
                        const displayMessage: string =
                          (event?.data && (event.data.displayMessage as string)) ||
                          'Sorry, I encountered an error. Please try again.'
                        const formatted = `_${displayMessage}_`
                        // Accumulate so it persists to DB as assistant content
                        assistantContent += formatted
                        // Send as content chunk
                        try {
                          controller.enqueue(
                            encoder.encode(
                              `data: ${JSON.stringify({ type: 'content', data: formatted })}\n\n`
                            )
                          )
                        } catch (enqueueErr) {
                          reader.cancel()
                          break
                        }
                        // Then close this response cleanly for the client
                        try {
                          controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
                          )
                        } catch (enqueueErr) {
                          reader.cancel()
                          break
                        }
                      } catch {}
                      // Do not forward the original error event
                    } else {
                      // Forward original event to client
                      try {
                        controller.enqueue(encoder.encode(`data: ${jsonStr}\n\n`))
                      } catch (enqueueErr) {
                        reader.cancel()
                        break
                      }
                    }
                  } catch (e) {
                    // Enhanced error handling for large payloads and parsing issues
                    const lineLength = line.length
                    const isLargePayload = lineLength > 10000

                    if (isLargePayload) {
                      logger.error(
                        `[${tracker.requestId}] Failed to parse large SSE event (${lineLength} chars)`,
                        {
                          error: e,
                          preview: `${line.substring(0, 200)}...`,
                          size: lineLength,
                        }
                      )
                    } else {
                      logger.warn(
                        `[${tracker.requestId}] Failed to parse SSE event: "${line.substring(0, 200)}..."`,
                        e
                      )
                    }
                  }
                } else if (line.trim() && line !== 'data: [DONE]') {
                  logger.debug(`[${tracker.requestId}] Non-SSE line from sim agent: "${line}"`)
                }
              }
            }

            // Process any remaining buffer
            if (buffer.trim()) {
              logger.debug(`[${tracker.requestId}] Processing remaining buffer: "${buffer}"`)
              if (buffer.startsWith('data: ')) {
                try {
                  const jsonStr = buffer.slice(6)
                  const event = JSON.parse(jsonStr)
                  if (event.type === 'content' && event.data) {
                    assistantContent += event.data
                  }
                  // Forward remaining event, applying same error rewrite behavior
                  if (event?.type === 'error') {
                    const displayMessage: string =
                      (event?.data && (event.data.displayMessage as string)) ||
                      'Sorry, I encountered an error. Please try again.'
                    const formatted = `_${displayMessage}_`
                    assistantContent += formatted
                    try {
                      controller.enqueue(
                        encoder.encode(
                          `data: ${JSON.stringify({ type: 'content', data: formatted })}\n\n`
                        )
                      )
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
                      )
                    } catch (enqueueErr) {
                      reader.cancel()
                    }
                  } else {
                    try {
                      controller.enqueue(encoder.encode(`data: ${jsonStr}\n\n`))
                    } catch (enqueueErr) {
                      reader.cancel()
                    }
                  }
                } catch (e) {
                  logger.warn(`[${tracker.requestId}] Failed to parse final buffer: "${buffer}"`)
                }
              }
            }

            // Log final streaming summary
            logger.info(`[${tracker.requestId}] Streaming complete summary:`, {
              totalContentLength: assistantContent.length,
              toolCallsCount: toolCalls.length,
              hasContent: assistantContent.length > 0,
              toolNames: toolCalls.map((tc) => tc?.name).filter(Boolean),
            })

            // Save messages to database after streaming completes (including aborted messages)
            if (currentChat) {
              const updatedMessages = [...conversationHistory, userMessage]

              // Save assistant message if there's any content or tool calls (even partial from abort)
              if (assistantContent.trim() || toolCalls.length > 0) {
                const assistantMessage = {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: assistantContent,
                  timestamp: new Date().toISOString(),
                  ...(toolCalls.length > 0 && { toolCalls }),
                }
                updatedMessages.push(assistantMessage)
                logger.info(
                  `[${tracker.requestId}] Saving assistant message with content (${assistantContent.length} chars) and ${toolCalls.length} tool calls`
                )
              } else {
                logger.info(
                  `[${tracker.requestId}] No assistant content or tool calls to save (aborted before response)`
                )
              }

              // Persist only a safe conversationId to avoid continuing from a state that expects tool outputs
              const previousConversationId = currentChat?.conversationId as string | undefined
              const responseId = lastSafeDoneResponseId || previousConversationId || undefined

              // Update chat in database immediately (without title)
              await db
                .update(copilotChats)
                .set({
                  messages: updatedMessages,
                  updatedAt: new Date(),
                  ...(responseId ? { conversationId: responseId } : {}),
                })
                .where(eq(copilotChats.id, actualChatId!))

              logger.info(`[${tracker.requestId}] Updated chat ${actualChatId} with new messages`, {
                messageCount: updatedMessages.length,
                savedUserMessage: true,
                savedAssistantMessage: assistantContent.trim().length > 0,
                updatedConversationId: responseId || null,
              })
            }
          } catch (error) {
            logger.error(`[${tracker.requestId}] Error processing stream:`, error)
            controller.error(error)
          } finally {
            controller.close()
          }
        },
      })

      const response = new Response(transformedStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })

      logger.info(`[${tracker.requestId}] Returning streaming response to client`, {
        duration: tracker.getDuration(),
        chatId: actualChatId,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })

      return response
    }

    // For non-streaming responses
    const responseData = await simAgentResponse.json()
    logger.info(`[${tracker.requestId}] Non-streaming response from sim agent:`, {
      hasContent: !!responseData.content,
      contentLength: responseData.content?.length || 0,
      model: responseData.model,
      provider: responseData.provider,
      toolCallsCount: responseData.toolCalls?.length || 0,
      hasTokens: !!responseData.tokens,
    })

    // Log tool calls if present
    if (responseData.toolCalls?.length > 0) {
      responseData.toolCalls.forEach((toolCall: any) => {
        logger.info(`[${tracker.requestId}] Tool call in response:`, {
          id: toolCall.id,
          name: toolCall.name,
          success: toolCall.success,
          result: `${JSON.stringify(toolCall.result).substring(0, 200)}...`,
        })
      })
    }

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

    if (!workflowId) {
      return createBadRequestResponse('workflowId is required')
    }

    // Get authenticated user using consolidated helper
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()
    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    // Fetch chats for this user and workflow
    const chats = await db
      .select({
        id: copilotChats.id,
        title: copilotChats.title,
        model: copilotChats.model,
        messages: copilotChats.messages,
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
      previewYaml: null, // Not needed for chat list
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
