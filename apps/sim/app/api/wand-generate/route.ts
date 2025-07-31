import { unstable_noStore as noStore } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'
export const maxDuration = 60

const logger = createLogger('WandGenerateAPI')

const openai = env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    })
  : null

if (!env.OPENAI_API_KEY) {
  logger.warn('OPENAI_API_KEY not found. Wand generation API will not function.')
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface RequestBody {
  prompt: string
  systemPrompt?: string
  stream?: boolean
  history?: ChatMessage[]
}

// The endpoint is now generic - system prompts come from wand configs

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  logger.info(`[${requestId}] Received wand generation request`)

  if (!openai) {
    logger.error(`[${requestId}] OpenAI client not initialized. Missing API key.`)
    return NextResponse.json(
      { success: false, error: 'Wand generation service is not configured.' },
      { status: 503 }
    )
  }

  try {
    noStore()
    const body = (await req.json()) as RequestBody

    const { prompt, systemPrompt, stream = false, history = [] } = body

    if (!prompt) {
      logger.warn(`[${requestId}] Invalid request: Missing prompt.`)
      return NextResponse.json(
        { success: false, error: 'Missing required field: prompt.' },
        { status: 400 }
      )
    }

    // Use provided system prompt or default
    const finalSystemPrompt =
      systemPrompt ||
      'You are a helpful AI assistant. Generate content exactly as requested by the user.'

    // Prepare messages for OpenAI API
    const messages: ChatMessage[] = [{ role: 'system', content: finalSystemPrompt }]

    // Add previous messages from history
    messages.push(...history.filter((msg) => msg.role !== 'system'))

    // Add the current user prompt
    messages.push({ role: 'user', content: prompt })

    logger.debug(`[${requestId}] Calling OpenAI API for wand generation`, {
      stream,
      historyLength: history.length,
    })

    // For streaming responses
    if (stream) {
      try {
        const streamCompletion = await openai?.chat.completions.create({
          model: 'gpt-4o',
          messages: messages,
          temperature: 0.3,
          max_tokens: 10000,
          stream: true,
        })

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder()

              try {
                for await (const chunk of streamCompletion) {
                  const content = chunk.choices[0]?.delta?.content || ''
                  if (content) {
                    // Use the same format as codegen API for consistency
                    controller.enqueue(
                      encoder.encode(`${JSON.stringify({ chunk: content, done: false })}\n`)
                    )
                  }
                }

                // Send completion signal
                controller.enqueue(encoder.encode(`${JSON.stringify({ chunk: '', done: true })}\n`))
                controller.close()
                logger.info(`[${requestId}] Wand generation streaming completed`)
              } catch (streamError: any) {
                logger.error(`[${requestId}] Streaming error`, { error: streamError.message })
                controller.enqueue(
                  encoder.encode(`${JSON.stringify({ error: 'Streaming failed', done: true })}\n`)
                )
                controller.close()
              }
            },
          }),
          {
            headers: {
              'Content-Type': 'text/plain',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            },
          }
        )
      } catch (error: any) {
        logger.error(`[${requestId}] Streaming error`, {
          error: error.message || 'Unknown error',
          stack: error.stack,
        })

        return NextResponse.json(
          { success: false, error: 'An error occurred during wand generation streaming.' },
          { status: 500 }
        )
      }
    }

    // For non-streaming responses
    const completion = await openai?.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
      temperature: 0.3,
      max_tokens: 10000,
    })

    const generatedContent = completion.choices[0]?.message?.content?.trim()

    if (!generatedContent) {
      logger.error(`[${requestId}] OpenAI response was empty or invalid.`)
      return NextResponse.json(
        { success: false, error: 'Failed to generate content. OpenAI response was empty.' },
        { status: 500 }
      )
    }

    logger.info(`[${requestId}] Wand generation successful`)
    return NextResponse.json({ success: true, content: generatedContent })
  } catch (error: any) {
    logger.error(`[${requestId}] Wand generation failed`, {
      error: error.message || 'Unknown error',
      stack: error.stack,
    })

    let clientErrorMessage = 'Wand generation failed. Please try again later.'
    let status = 500

    if (error instanceof OpenAI.APIError) {
      status = error.status || 500
      logger.error(`[${requestId}] OpenAI API Error: ${status} - ${error.message}`)

      if (status === 401) {
        clientErrorMessage = 'Authentication failed. Please check your API key configuration.'
      } else if (status === 429) {
        clientErrorMessage = 'Rate limit exceeded. Please try again later.'
      } else if (status >= 500) {
        clientErrorMessage =
          'The wand generation service is currently unavailable. Please try again later.'
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: clientErrorMessage,
      },
      { status }
    )
  }
}
