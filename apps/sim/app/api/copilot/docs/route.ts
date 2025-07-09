import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import {
  generateDocsResponse,
  getChat,
  createChat,
  updateChat,
  generateChatTitle,
} from '@/lib/copilot/service'

const logger = createLogger('CopilotDocsAPI')

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

/**
 * POST /api/copilot/docs
 * Ask questions about documentation using RAG
 */
export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { query, topK, provider, model, stream, chatId, workflowId, createNewChat } =
      DocsQuerySchema.parse(body)

    logger.info(`[${requestId}] Docs RAG query: "${query}"`, {
      provider,
      model,
      topK,
      chatId,
      workflowId,
      createNewChat,
      userId: session.user.id,
    })

    // Handle chat context
    let currentChat: any = null
    let conversationHistory: any[] = []

    if (chatId) {
      // Load existing chat
      currentChat = await getChat(chatId, session.user.id)
      if (currentChat) {
        conversationHistory = currentChat.messages
      }
    } else if (createNewChat && workflowId) {
      // Create new chat
      currentChat = await createChat(session.user.id, workflowId)
    }

    // Generate docs response
    const result = await generateDocsResponse(query, conversationHistory, {
      topK,
      provider,
      model,
      stream,
      workflowId,
      requestId,
    })

    if (stream && result.response instanceof ReadableStream) {
      // Handle streaming response with docs sources
      logger.info(`[${requestId}] Returning streaming docs response`)

      const encoder = new TextEncoder()

      return new Response(
        new ReadableStream({
          async start(controller) {
            const reader = (result.response as ReadableStream).getReader()
            let accumulatedResponse = ''

            try {
              // Send initial metadata including sources
              const metadata = {
                type: 'metadata',
                chatId: currentChat?.id,
                sources: result.sources,
                citations: result.sources.map((source, index) => ({
                  id: index + 1,
                  title: source.title,
                  url: source.url,
                })),
                metadata: {
                  requestId,
                  chunksFound: result.sources.length,
                  query,
                  topSimilarity: result.sources[0]?.similarity,
                  provider,
                  model,
                },
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`))

              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = new TextDecoder().decode(value)
                // Clean up any object serialization artifacts in streaming content
                const cleanedChunk = chunk.replace(/\[object Object\],?/g, '')
                accumulatedResponse += cleanedChunk

                const contentChunk = {
                  type: 'content',
                  content: cleanedChunk,
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`))
              }

              // Save conversation to database after streaming completes
              if (currentChat) {
                const userMessage = {
                  id: crypto.randomUUID(),
                  role: 'user',
                  content: query,
                  timestamp: new Date().toISOString(),
                }

                const assistantMessage = {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: accumulatedResponse,
                  timestamp: new Date().toISOString(),
                  citations: result.sources.map((source, index) => ({
                    id: index + 1,
                    title: source.title,
                    url: source.url,
                  })),
                }

                const updatedMessages = [...conversationHistory, userMessage, assistantMessage]

                // Generate title if this is the first message
                let updatedTitle = currentChat.title
                if (!updatedTitle && conversationHistory.length === 0) {
                  updatedTitle = await generateChatTitle(query)
                }

                // Update the chat in database
                await updateChat(currentChat.id, session.user.id, {
                  title: updatedTitle,
                  messages: updatedMessages,
                })

                logger.info(`[${requestId}] Updated chat ${currentChat.id} with new docs messages`)
              }

              // Send completion marker
              controller.enqueue(encoder.encode(`data: {"type":"done"}\n\n`))
            } catch (error) {
              logger.error(`[${requestId}] Docs streaming error:`, error)
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

    // Handle non-streaming response
    logger.info(`[${requestId}] Docs RAG response generated successfully`)

    // Save conversation to database if we have a chat
    if (currentChat) {
      const userMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
        timestamp: new Date().toISOString(),
      }

      const assistantMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: typeof result.response === 'string' ? result.response : '[Streaming Response]',
        timestamp: new Date().toISOString(),
        citations: result.sources.map((source, index) => ({
          id: index + 1,
          title: source.title,
          url: source.url,
        })),
      }

      const updatedMessages = [...conversationHistory, userMessage, assistantMessage]

      // Generate title if this is the first message
      let updatedTitle = currentChat.title
      if (!updatedTitle && conversationHistory.length === 0) {
        updatedTitle = await generateChatTitle(query)
      }

      // Update the chat in database
      await updateChat(currentChat.id, session.user.id, {
        title: updatedTitle,
        messages: updatedMessages,
      })

      logger.info(`[${requestId}] Updated chat ${currentChat.id} with new docs messages`)
    }

    return NextResponse.json({
      success: true,
      response: result.response,
      sources: result.sources,
      chatId: currentChat?.id,
      metadata: {
        requestId,
        chunksFound: result.sources.length,
        query,
        topSimilarity: result.sources[0]?.similarity,
        provider,
        model,
      },
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    logger.error(`[${requestId}] Copilot docs error:`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
} 