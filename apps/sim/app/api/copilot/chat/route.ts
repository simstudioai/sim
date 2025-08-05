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
import { TITLE_GENERATION_SYSTEM_PROMPT, TITLE_GENERATION_USER_PROMPT } from '@/lib/copilot/prompts'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'
import { executeProviderRequest } from '@/providers'

const logger = createLogger('CopilotChatAPI')

// Schema for chat messages
const ChatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  userMessageId: z.string().optional(), // ID from frontend for the user message
  chatId: z.string().optional(),
  workflowId: z.string().min(1, 'Workflow ID is required'),
  mode: z.enum(['ask', 'agent']).optional().default('agent'),
  createNewChat: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(true),
  implicitFeedback: z.string().optional(),
})

// Sim Agent API configuration
const SIM_AGENT_API_URL = env.SIM_AGENT_API_URL || 'http://localhost:8000'
const SIM_AGENT_API_KEY = env.SIM_AGENT_API_KEY

/**
 * Generate a chat title using LLM
 */
async function generateChatTitle(userMessage: string): Promise<string> {
  try {
    const { provider, model } = getCopilotModel('title')

    // Get the appropriate API key for the provider
    let apiKey: string | undefined
    if (provider === 'anthropic') {
      // Use rotating API key for Anthropic
      const { getRotatingApiKey } = require('@/lib/utils')
      try {
        apiKey = getRotatingApiKey('anthropic')
        logger.debug(`Using rotating API key for Anthropic title generation`)
      } catch (e) {
        // If rotation fails, let the provider handle it
        logger.warn(`Failed to get rotating API key for Anthropic:`, e)
      }
    }

    const response = await executeProviderRequest(provider, {
      model,
      systemPrompt: TITLE_GENERATION_SYSTEM_PROMPT,
      context: TITLE_GENERATION_USER_PROMPT(userMessage),
      temperature: 0.3,
      maxTokens: 50,
      apiKey: apiKey || '',
      stream: false,
    })

    if (typeof response === 'object' && 'content' in response) {
      return response.content?.trim() || 'New Chat'
    }

    return 'New Chat'
  } catch (error) {
    logger.error('Failed to generate chat title:', error)
    return 'New Chat'
  }
}

/**
 * Generate chat title asynchronously and update the database
 */
async function generateChatTitleAsync(
  chatId: string,
  userMessage: string,
  requestId: string,
  streamController?: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  try {
    logger.info(`[${requestId}] Starting async title generation for chat ${chatId}`)

    const title = await generateChatTitle(userMessage)

    // Update the chat with the generated title
    await db
      .update(copilotChats)
      .set({
        title,
        updatedAt: new Date(),
      })
      .where(eq(copilotChats.id, chatId))

    // Send title_updated event to client if streaming
    if (streamController) {
      const encoder = new TextEncoder()
      const titleEvent = `data: ${JSON.stringify({
        type: 'title_updated',
        title: title,
      })}\n\n`
      streamController.enqueue(encoder.encode(titleEvent))
      logger.debug(`[${requestId}] Sent title_updated event to client: "${title}"`)
    }

    logger.info(`[${requestId}] Generated title for chat ${chatId}: "${title}"`)
  } catch (error) {
    logger.error(`[${requestId}] Failed to generate title for chat ${chatId}:`, error)
    // Don't throw - this is a background operation
  }
}

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
      createNewChat,
      stream,
      implicitFeedback,
    } = ChatMessageSchema.parse(body)

    logger.info(`[${tracker.requestId}] Processing copilot chat request`, {
      userId: authenticatedUserId,
      workflowId,
      chatId,
      mode,
      stream,
      createNewChat,
      messageLength: message.length,
      hasImplicitFeedback: !!implicitFeedback,
    })

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

    // Build messages array for sim agent with conversation history
    const messages = []

    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      })
    }

    // Add implicit feedback if provided
    if (implicitFeedback) {
      messages.push({
        role: 'system',
        content: implicitFeedback,
      })
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message,
    })

    // Start title generation in parallel if this is a new chat with first message
    if (actualChatId && !currentChat?.title && conversationHistory.length === 0) {
      logger.info(`[${tracker.requestId}] Will start parallel title generation inside stream`)
    }

    // Forward to sim agent API
    logger.info(`[${tracker.requestId}] Sending request to sim agent API`, {
      messageCount: messages.length,
      endpoint: `${SIM_AGENT_API_URL}/api/chat-completion-streaming`,
    })

    const simAgentResponse = await fetch(`${SIM_AGENT_API_URL}/api/chat-completion-streaming`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SIM_AGENT_API_KEY && { 'x-api-key': SIM_AGENT_API_KEY }),
      },
      body: JSON.stringify({
        messages,
        workflowId,
        userId: authenticatedUserId,
        stream: stream,
        streamToolCalls: true,
        mode: mode,
        ...(session?.user?.name && { userName: session.user.name }),
      }),
    })

    if (!simAgentResponse.ok) {
      const errorText = await simAgentResponse.text()
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
      logger.info(`[${tracker.requestId}] Streaming response from sim agent`)

      // Create user message to save
      const userMessage = {
        id: userMessageId || crypto.randomUUID(), // Use frontend ID if provided
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }

      // Create a pass-through stream that captures the response
      const transformedStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          let assistantContent = ''
          const toolCalls: any[] = []
          let buffer = ''
          let isFirstDone = true

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
            logger.info(`[${tracker.requestId}] Starting title generation with stream updates`, {
              chatId: actualChatId,
              hasTitle: !!currentChat?.title,
              conversationLength: conversationHistory.length,
              message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
            })
            generateChatTitleAsync(actualChatId, message, tracker.requestId, controller).catch(
              (error) => {
                logger.error(`[${tracker.requestId}] Title generation failed:`, error)
              }
            )
          } else {
            logger.debug(`[${tracker.requestId}] Skipping title generation`, {
              chatId: actualChatId,
              hasTitle: !!currentChat?.title,
              conversationLength: conversationHistory.length,
              reason: !actualChatId
                ? 'no chatId'
                : currentChat?.title
                  ? 'already has title'
                  : conversationHistory.length > 0
                    ? 'not first message'
                    : 'unknown',
            })
          }

          // Forward the sim agent stream and capture assistant response
          const reader = simAgentResponse.body!.getReader()
          const decoder = new TextDecoder()

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                logger.info(`[${tracker.requestId}] Stream reading completed`)
                break
              }

              // Check if client disconnected before processing chunk
              try {
                // Forward the chunk to client immediately
                controller.enqueue(value)
              } catch (error) {
                // Client disconnected - stop reading from sim agent
                logger.info(
                  `[${tracker.requestId}] Client disconnected, stopping stream processing`
                )
                reader.cancel() // Stop reading from sim agent
                break
              }
              const chunkSize = value.byteLength

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

                      case 'tool_call':
                        logger.info(
                          `[${tracker.requestId}] Tool call ${event.data?.partial ? '(partial)' : '(complete)'}:`,
                          {
                            id: event.data?.id,
                            name: event.data?.name,
                            arguments: event.data?.arguments,
                            blockIndex: event.data?._blockIndex,
                          }
                        )
                        if (!event.data?.partial) {
                          toolCalls.push(event.data)
                        }
                        break

                      case 'tool_execution':
                        logger.info(`[${tracker.requestId}] Tool execution started:`, {
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          status: event.status,
                        })
                        break

                      case 'tool_result':
                        logger.info(`[${tracker.requestId}] Tool result received:`, {
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          success: event.success,
                          result: `${JSON.stringify(event.result).substring(0, 200)}...`,
                          resultSize: JSON.stringify(event.result).length,
                        })
                        break

                      case 'tool_error':
                        logger.error(`[${tracker.requestId}] Tool error:`, {
                          toolCallId: event.toolCallId,
                          toolName: event.toolName,
                          error: event.error,
                          success: event.success,
                        })
                        break

                      case 'done':
                        if (isFirstDone) {
                          logger.info(
                            `[${tracker.requestId}] Initial AI response complete, tool count: ${toolCalls.length}`
                          )
                          isFirstDone = false
                        } else {
                          logger.info(`[${tracker.requestId}] Conversation round complete`)
                        }
                        break

                      case 'error':
                        logger.error(`[${tracker.requestId}] Stream error event:`, event.error)
                        break

                      default:
                        logger.debug(
                          `[${tracker.requestId}] Unknown event type: ${event.type}`,
                          event
                        )
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
                  const event = JSON.parse(buffer.slice(6))
                  if (event.type === 'content' && event.data) {
                    assistantContent += event.data
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

              // Update chat in database immediately (without title)
              await db
                .update(copilotChats)
                .set({
                  messages: updatedMessages,
                  updatedAt: new Date(),
                })
                .where(eq(copilotChats.id, actualChatId!))

              logger.info(`[${tracker.requestId}] Updated chat ${actualChatId} with new messages`, {
                messageCount: updatedMessages.length,
                savedUserMessage: true,
                savedAssistantMessage: assistantContent.trim().length > 0,
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
        id: userMessageId || crypto.randomUUID(), // Use frontend ID if provided
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
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
        generateChatTitleAsync(actualChatId, message, tracker.requestId).catch((error) => {
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
