import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  createChat,
  deleteChat,
  generateChatTitle,
  getChat,
  listChats,
  sendMessage,
  updateChat,
} from '@/lib/copilot/service'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('CopilotAPI')

// Interface for StreamingExecution response
interface StreamingExecution {
  stream: ReadableStream
  execution: Promise<any>
}

// Schema for sending messages
const SendMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  mode: z.enum(['ask', 'agent']).optional().default('ask'),
  createNewChat: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(false),
})

// Schema for docs queries
const DocsQuerySchema = z.object({
  query: z.string().min(1, 'Query is required'),
  topK: z.number().min(1).max(20).default(5),
  provider: z.string().optional(),
  model: z.string().optional(),
  stream: z.boolean().optional().default(false),
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  createNewChat: z.boolean().optional().default(false),
})

// Schema for creating chats
const CreateChatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  title: z.string().optional(),
  initialMessage: z.string().optional(),
})

// Schema for updating chats
const UpdateChatSchema = z.object({
  chatId: z.string().min(1, 'Chat ID is required'),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.string(),
        citations: z
          .array(
            z.object({
              id: z.number(),
              title: z.string(),
              url: z.string(),
              similarity: z.number().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  title: z.string().optional(),
})

// Schema for listing chats
const ListChatsSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  limit: z.number().min(1).max(100).optional().default(50),
  offset: z.number().min(0).optional().default(0),
})

/**
 * POST /api/copilot
 * Send a message to the copilot
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const body = await req.json()
    const { message, chatId, workflowId, mode, createNewChat, stream } =
      SendMessageSchema.parse(body)

    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info(`[${requestId}] Copilot message: "${message}"`, {
      chatId,
      workflowId,
      mode,
      createNewChat,
      stream,
      userId: session.user.id,
    })

    // Send message using the service
    const result = await sendMessage({
      message,
      chatId,
      workflowId,
      mode,
      createNewChat,
      stream,
      userId: session.user.id,
    })

    // Handle streaming response (ReadableStream or StreamingExecution)
    let streamToRead: ReadableStream | null = null

    // Debug logging to see what we actually got
    logger.info(`[${requestId}] Response type analysis:`, {
      responseType: typeof result.response,
      isReadableStream: result.response instanceof ReadableStream,
      hasStreamProperty:
        typeof result.response === 'object' && result.response && 'stream' in result.response,
      hasExecutionProperty:
        typeof result.response === 'object' && result.response && 'execution' in result.response,
      responseKeys:
        typeof result.response === 'object' && result.response ? Object.keys(result.response) : [],
    })

    if (result.response instanceof ReadableStream) {
      logger.info(`[${requestId}] Direct ReadableStream detected`)
      streamToRead = result.response
    } else if (
      typeof result.response === 'object' &&
      result.response &&
      'stream' in result.response &&
      'execution' in result.response
    ) {
      // Handle StreamingExecution (from providers with tool calls)
      logger.info(`[${requestId}] StreamingExecution detected`)
      const streamingExecution = result.response as StreamingExecution
      streamToRead = streamingExecution.stream

      // No need to extract citations - LLM generates direct markdown links
    }

    if (streamToRead) {
      logger.info(`[${requestId}] Returning streaming response`)

      const encoder = new TextEncoder()

      return new Response(
        new ReadableStream({
          async start(controller) {
            const reader = streamToRead!.getReader()
            let accumulatedResponse = ''

            // Send initial metadata
            const metadata = {
              type: 'metadata',
              chatId: result.chatId,
              metadata: {
                requestId,
                message,
              },
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`))

            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunkText = new TextDecoder().decode(value)
                accumulatedResponse += chunkText

                const contentChunk = {
                  type: 'content',
                  content: chunkText,
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`))
              }

              // Send completion signal
              const completion = {
                type: 'complete',
                finalContent: accumulatedResponse,
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(completion)}\n\n`))
              controller.close()
            } catch (error) {
              logger.error(`[${requestId}] Streaming error:`, error)
              const errorChunk = {
                type: 'error',
                error: 'Streaming failed',
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`))
              controller.close()
            }
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }
      )
    }

    // Handle non-streaming response
    logger.info(`[${requestId}] Chat response generated successfully`)

    return NextResponse.json({
      success: true,
      response: result.response,
      chatId: result.chatId,
      metadata: {
        requestId,
        message,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Copilot error:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/copilot
 * List chats or get a specific chat
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('chatId')

    // If chatId is provided, get specific chat
    if (chatId) {
      const chat = await getChat(chatId, session.user.id)
      if (!chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        chat,
      })
    }

    // Otherwise, list chats
    const workflowId = searchParams.get('workflowId')
    const limit = Number.parseInt(searchParams.get('limit') || '50')
    const offset = Number.parseInt(searchParams.get('offset') || '0')

    if (!workflowId) {
      return NextResponse.json(
        { error: 'workflowId is required for listing chats' },
        { status: 400 }
      )
    }

    const chats = await listChats(session.user.id, workflowId, { limit, offset })

    return NextResponse.json({
      success: true,
      chats,
    })
  } catch (error) {
    logger.error('Failed to handle GET request:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/copilot
 * Create a new chat
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { workflowId, title, initialMessage } = CreateChatSchema.parse(body)

    logger.info(`Creating new chat for user ${session.user.id}, workflow ${workflowId}`)

    const chat = await createChat(session.user.id, workflowId, {
      title,
      initialMessage,
    })

    logger.info(`Created chat ${chat.id} for user ${session.user.id}`)

    return NextResponse.json({
      success: true,
      chat,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to create chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/copilot
 * Update a chat with new messages
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { chatId, messages, title } = UpdateChatSchema.parse(body)

    logger.info(`Updating chat ${chatId} for user ${session.user.id}`)

    // Get the current chat to check if it has a title
    const existingChat = await getChat(chatId, session.user.id)

    let titleToUse = title

    // Generate title if chat doesn't have one and we have messages
    if (!titleToUse && existingChat && !existingChat.title && messages && messages.length > 0) {
      const firstUserMessage = messages.find((msg) => msg.role === 'user')
      if (firstUserMessage) {
        logger.info('Generating LLM-based title for chat without title')
        try {
          titleToUse = await generateChatTitle(firstUserMessage.content)
          logger.info(`Generated title: ${titleToUse}`)
        } catch (error) {
          logger.error('Failed to generate chat title:', error)
          titleToUse = 'New Chat'
        }
      }
    }

    const chat = await updateChat(chatId, session.user.id, {
      messages,
      title: titleToUse,
    })

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      chat,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error('Failed to update chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/copilot
 * Delete a chat
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('chatId')

    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 })
    }

    const success = await deleteChat(chatId, session.user.id)

    if (!success) {
      return NextResponse.json({ error: 'Chat not found or access denied' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Chat deleted successfully',
    })
  } catch (error) {
    logger.error('Failed to delete chat:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
