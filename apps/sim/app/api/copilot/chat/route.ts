import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getRotatingApiKey } from '@/lib/utils'
import { db } from '@/db'
import { copilotChats } from '@/db/schema'
import { executeProviderRequest } from '@/providers'
import type { Message } from '@/providers/types'

const logger = createLogger('CopilotChat')

// Configuration for copilot chat
const COPILOT_CONFIG = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-3-7-sonnet-latest',
  temperature: 0.1,
  maxTokens: 4000, // Increased for more comprehensive documentation responses
} as const

const CopilotChatSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  chatId: z.string().optional(),
  workflowId: z.string().optional(),
  createNewChat: z.boolean().optional().default(false),
  stream: z.boolean().optional().default(false),
})

/**
 * Generate a chat title using LLM based on the first user message
 */
async function generateChatTitle(userMessage: string): Promise<string> {
  try {
    const apiKey = getRotatingApiKey('anthropic')

    const response = await executeProviderRequest('anthropic', {
      model: 'claude-3-haiku-20240307',
      systemPrompt:
        'You are a helpful assistant that generates concise, descriptive titles for chat conversations. Create a title that captures the main topic or question being discussed. Keep it under 50 characters and make it specific and clear.',
      context: `Generate a concise title for a conversation that starts with this user message: "${userMessage}"

Return only the title text, nothing else.`,
      temperature: 0.3,
      maxTokens: 50,
      apiKey,
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
 * Generate chat response with tool calling support
 */
interface StreamingChatResponse {
  stream: ReadableStream
  citations: Array<{
    id: number
    title: string
    url: string
  }>
}

/**
 * Extract citations from provider response that contains tool results
 */
function extractCitationsFromResponse(response: any): Array<{
  id: number
  title: string
  url: string
}> {
  // Handle ReadableStream responses
  if (response instanceof ReadableStream) {
    return []
  }

  // Handle string responses
  if (typeof response === 'string') {
    return []
  }

  // Handle object responses
  if (typeof response !== 'object' || !response) {
    return []
  }

  // Check for tool results
  if (!response.toolResults || !Array.isArray(response.toolResults)) {
    return []
  }

  const docsSearchResult = response.toolResults.find(
    (result: any) => result.sources && Array.isArray(result.sources)
  )

  if (!docsSearchResult || !docsSearchResult.sources) {
    return []
  }

  return docsSearchResult.sources.map((source: any) => ({
    id: source.id,
    title: source.title,
    url: source.link,
  }))
}

async function generateChatResponse(
  message: string,
  conversationHistory: any[] = [],
  stream = false,
  requestId?: string
): Promise<string | ReadableStream | StreamingChatResponse> {
  const apiKey = getRotatingApiKey('anthropic')

  // Build conversation context
  const messages: Message[] = []

  // Add conversation history
  for (const msg of conversationHistory.slice(-10)) {
    // Keep last 10 messages
    messages.push({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    })
  }

  // Add current user message
  messages.push({
    role: 'user',
    content: message,
  })

  const systemPrompt = `You are a helpful AI assistant for Sim Studio, a powerful workflow automation platform. You can help users with questions about:

- Creating and managing workflows
- Using different tools and blocks
- Understanding features and capabilities
- Troubleshooting issues
- Best practices

You have access to the Sim Studio documentation through a search tool. Use it when users ask about Sim Studio features, tools, or functionality.

WHEN TO SEARCH DOCUMENTATION:
- User asks about specific Sim Studio features or tools
- User needs help with workflows or blocks
- User has technical questions about the platform
- User asks "How do I..." questions about Sim Studio

WHEN NOT TO SEARCH:
- Simple greetings or casual conversation
- General programming questions unrelated to Sim Studio
- Thank you messages or small talk

CITATION FORMAT:
When you reference information from documentation sources, use this format:
- Use [1], [2], [3] etc. to cite sources
- Place citations at the end of sentences that reference specific information
- Each source should only be cited once in your response
- Continue your full response after adding citations - don't stop mid-answer

IMPORTANT: Always provide complete, helpful responses. If you add citations, continue writing your full answer. Do not stop your response after adding a citation.`

  // Define the documentation search tool for the LLM
  const tools = [
    {
      id: 'docs_search_internal',
      name: 'Search Documentation',
      description:
        'Search Sim Studio documentation for information about features, tools, workflows, and functionality',
      params: {},
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant documentation',
          },
          topK: {
            type: 'number',
            description: 'Number of results to return (default: 5, max: 10)',
            default: 5,
          },
        },
        required: ['query'],
      },
    },
  ]

  try {
    // For streaming, we always make a non-streaming request first to handle tool calls
    // Then we stream the final response if no tool calls were needed
    const response = await executeProviderRequest('anthropic', {
      model: COPILOT_CONFIG.defaultModel,
      systemPrompt,
      messages,
      tools,
      temperature: COPILOT_CONFIG.temperature,
      maxTokens: COPILOT_CONFIG.maxTokens,
      apiKey,
      stream: false, // Always start with non-streaming to handle tool calls
    })

    // If this is a streaming request and we got a regular response,
    // we need to create a streaming response from the content
    if (stream && typeof response === 'object' && 'content' in response) {
      const content = response.content || 'Sorry, I could not generate a response.'

      // Extract citations from the provider response for later use
      const responseCitations = extractCitationsFromResponse(response)

      // Create a ReadableStream that emits the content in character chunks
      const streamResponse = new ReadableStream({
        start(controller) {
          // Use character-based streaming for more reliable transmission
          const chunkSize = 8 // Stream 8 characters at a time for smooth experience
          let index = 0

          const pushNext = () => {
            if (index < content.length) {
              const chunk = content.slice(index, index + chunkSize)
              controller.enqueue(new TextEncoder().encode(chunk))
              index += chunkSize

              // Add a small delay to simulate streaming
              setTimeout(pushNext, 25)
            } else {
              controller.close()
            }
          }

          pushNext()
        },
      })

      // Store citations for later use in the main streaming handler

      ;(streamResponse as any)._citations = responseCitations

      return streamResponse
    }

    // Handle regular response
    if (typeof response === 'object' && 'content' in response) {
      return response.content || 'Sorry, I could not generate a response.'
    }

    return 'Sorry, I could not generate a response.'
  } catch (error) {
    logger.error('Failed to generate chat response:', error)
    throw new Error(
      `Failed to generate response: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * POST /api/copilot/chat
 * Chat with the copilot using LLM with tool calling
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const body = await req.json()
    const { message, chatId, workflowId, createNewChat, stream } = CopilotChatSchema.parse(body)

    const session = await getSession()

    logger.info(`[${requestId}] Copilot chat message: "${message}"`, {
      chatId,
      workflowId,
      createNewChat,
      stream,
    })

    // Handle chat context
    let currentChat: any = null
    let conversationHistory: any[] = []

    if (chatId && session?.user?.id) {
      // Load existing chat
      const [existingChat] = await db
        .select()
        .from(copilotChats)
        .where(and(eq(copilotChats.id, chatId), eq(copilotChats.userId, session.user.id)))
        .limit(1)

      if (existingChat) {
        currentChat = existingChat
        conversationHistory = Array.isArray(existingChat.messages) ? existingChat.messages : []
      }
    } else if (createNewChat && workflowId && session?.user?.id) {
      // Create new chat
      const [newChat] = await db
        .insert(copilotChats)
        .values({
          userId: session.user.id,
          workflowId,
          title: null,
          model: COPILOT_CONFIG.defaultModel,
          messages: [],
        })
        .returning()

      if (newChat) {
        currentChat = newChat
        conversationHistory = []
      }
    }

    // Generate chat response
    const response = await generateChatResponse(message, conversationHistory, stream, requestId)

    // Handle streaming response
    if (response instanceof ReadableStream) {
      logger.info(`[${requestId}] Returning streaming response`)

      const encoder = new TextEncoder()
      // Extract citations from the stream object if available
      const citations = (response as any)._citations || []

      return new Response(
        new ReadableStream({
          async start(controller) {
            const reader = response.getReader()
            let accumulatedResponse = ''

            // Send initial metadata
            const metadata = {
              type: 'metadata',
              chatId: currentChat?.id,
              citations: citations,
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

              // Save conversation to database after streaming completes
              if (currentChat && session?.user?.id) {
                const userMessage = {
                  id: crypto.randomUUID(),
                  role: 'user',
                  content: message,
                  timestamp: new Date().toISOString(),
                }

                const assistantMessage = {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: accumulatedResponse,
                  timestamp: new Date().toISOString(),
                  citations: citations.length > 0 ? citations : undefined,
                }

                const updatedMessages = [...conversationHistory, userMessage, assistantMessage]

                // Generate title if this is the first message
                let updatedTitle = currentChat.title
                if (!updatedTitle && conversationHistory.length === 0) {
                  updatedTitle = await generateChatTitle(message)
                }

                await db
                  .update(copilotChats)
                  .set({
                    title: updatedTitle,
                    messages: updatedMessages,
                    updatedAt: new Date(),
                  })
                  .where(eq(copilotChats.id, currentChat.id))

                logger.info(`[${requestId}] Updated chat ${currentChat.id} with new messages`)
              }

              controller.enqueue(encoder.encode(`data: {"type":"done"}\n\n`))
            } catch (error) {
              logger.error(`[${requestId}] Streaming error:`, error)
              const errorChunk = {
                type: 'error',
                error: 'Streaming failed',
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`))
            } finally {
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

    // Save conversation to database for non-streaming response
    if (currentChat && session?.user?.id) {
      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: new Date().toISOString(),
      }

      // Extract citations from response if available
      const citations = extractCitationsFromResponse(response)

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          typeof response === 'string'
            ? response
            : (typeof response === 'object' && 'content' in response
                ? response.content
                : '[Error generating response]') || '[Error generating response]',
        timestamp: new Date().toISOString(),
        citations: citations.length > 0 ? citations : undefined,
      }

      const updatedMessages = [...conversationHistory, userMessage, assistantMessage]

      // Generate title if this is the first message
      let updatedTitle = currentChat.title
      if (!updatedTitle && conversationHistory.length === 0) {
        updatedTitle = await generateChatTitle(message)
      }

      await db
        .update(copilotChats)
        .set({
          title: updatedTitle,
          messages: updatedMessages,
          updatedAt: new Date(),
        })
        .where(eq(copilotChats.id, currentChat.id))

      logger.info(`[${requestId}] Updated chat ${currentChat.id} with new messages`)
    }

    logger.info(`[${requestId}] Chat response generated successfully`)

    return NextResponse.json({
      success: true,
      response:
        typeof response === 'string'
          ? response
          : (typeof response === 'object' && 'content' in response
              ? response.content
              : '[Error generating response]') || '[Error generating response]',
      chatId: currentChat?.id,
      citations: extractCitationsFromResponse(response),
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

    logger.error(`[${requestId}] Copilot chat error:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
