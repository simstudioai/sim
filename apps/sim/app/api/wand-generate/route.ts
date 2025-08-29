import { type NextRequest, NextResponse } from 'next/server'
import OpenAI, { AzureOpenAI } from 'openai'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'
export const maxDuration = 60

const logger = createLogger('WandGenerateAPI')

const azureApiKey = env.AZURE_OPENAI_API_KEY
const azureEndpoint = env.AZURE_OPENAI_ENDPOINT
const azureApiVersion = env.AZURE_OPENAI_API_VERSION
const wandModelName = env.WAND_OPENAI_MODEL_NAME || 'gpt-4o'
const openaiApiKey = env.OPENAI_API_KEY

const useWandAzure = azureApiKey && azureEndpoint && azureApiVersion

const client = useWandAzure
  ? new AzureOpenAI({
      apiKey: azureApiKey,
      apiVersion: azureApiVersion,
      endpoint: azureEndpoint,
    })
  : openaiApiKey
    ? new OpenAI({
        apiKey: openaiApiKey,
      })
    : null

if (!useWandAzure && !openaiApiKey) {
  logger.warn(
    'Neither Azure OpenAI nor OpenAI API key found. Wand generation API will not function.'
  )
} else {
  logger.info(`Using ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} for wand generation`)
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

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  logger.info(`[${requestId}] Received wand generation request`)

  if (!client) {
    logger.error(`[${requestId}] AI client not initialized. Missing API key.`)
    return NextResponse.json(
      { success: false, error: 'Wand generation service is not configured.' },
      { status: 503 }
    )
  }

  try {
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

    logger.debug(
      `[${requestId}] Calling ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} API for wand generation`,
      {
        stream,
        historyLength: history.length,
        endpoint: useWandAzure ? azureEndpoint : 'api.openai.com',
        model: useWandAzure ? wandModelName : 'gpt-4o',
        apiVersion: useWandAzure ? azureApiVersion : 'N/A',
      }
    )

    // For streaming responses
    if (stream) {
      try {
        logger.debug(
          `[${requestId}] Starting streaming request to ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'}`
        )

        logger.info(
          `[${requestId}] About to create stream with model: ${useWandAzure ? wandModelName : 'gpt-4o'}`
        )

        // Add AbortController with timeout
        const abortController = new AbortController()
        const timeoutId = setTimeout(() => {
          abortController.abort('Stream timeout after 30 seconds')
        }, 30000)

        // Forward request abort signal if available
        req.signal?.addEventListener('abort', () => {
          abortController.abort('Request cancelled by client')
        })

        const streamCompletion = await client.chat.completions.create(
          {
            model: useWandAzure ? wandModelName : 'gpt-4o',
            messages: messages,
            temperature: 0.3,
            max_tokens: 10000,
            stream: true,
            stream_options: { include_usage: true },
          },
          {
            signal: abortController.signal, // Add AbortSignal
          }
        )

        clearTimeout(timeoutId) // Clear timeout after successful creation
        logger.info(`[${requestId}] Stream created successfully, starting reader pattern`)

        logger.debug(`[${requestId}] Stream connection established successfully`)

        return new Response(
          new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder()

              try {
                logger.info(`[${requestId}] Starting streaming with timeout protection`)
                let chunkCount = 0
                let hasUsageData = false

                // Use for await with AbortController timeout protection
                for await (const chunk of streamCompletion) {
                  chunkCount++

                  if (chunkCount === 1) {
                    logger.info(`[${requestId}] Received first chunk via for await`)
                  }

                  // Process the chunk
                  const content = chunk.choices?.[0]?.delta?.content || ''
                  if (content) {
                    // Use SSE format identical to chat streaming
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ chunk: content })}\n\n`)
                    )
                  }

                  // Check for usage data
                  if (chunk.usage) {
                    hasUsageData = true
                    logger.info(
                      `[${requestId}] Received usage data: ${JSON.stringify(chunk.usage)}`
                    )
                  }

                  // Log every 5th chunk to avoid spam
                  if (chunkCount % 5 === 0) {
                    logger.debug(`[${requestId}] Processed ${chunkCount} chunks so far`)
                  }
                }

                logger.info(
                  `[${requestId}] Reader pattern completed. Total chunks: ${chunkCount}, Usage data received: ${hasUsageData}`
                )

                // Send completion signal in SSE format
                logger.info(`[${requestId}] Sending completion signal`)
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))

                logger.info(`[${requestId}] Closing controller`)
                controller.close()

                logger.info(`[${requestId}] Wand generation streaming completed successfully`)
              } catch (streamError: any) {
                if (streamError.name === 'AbortError') {
                  logger.info(
                    `[${requestId}] Stream was aborted (timeout or cancel): ${streamError.message}`
                  )
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ error: 'Stream cancelled', done: true })}\n\n`
                    )
                  )
                } else {
                  logger.error(`[${requestId}] Streaming error`, { error: streamError.message })
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ error: 'Streaming failed', done: true })}\n\n`
                    )
                  )
                }
                controller.close()
              }
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
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
    const completion = await client.chat.completions.create({
      model: useWandAzure ? wandModelName : 'gpt-4o',
      messages: messages,
      temperature: 0.3,
      max_tokens: 10000,
    })

    const generatedContent = completion.choices[0]?.message?.content?.trim()

    if (!generatedContent) {
      logger.error(
        `[${requestId}] ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} response was empty or invalid.`
      )
      return NextResponse.json(
        { success: false, error: 'Failed to generate content. AI response was empty.' },
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
      logger.error(
        `[${requestId}] ${useWandAzure ? 'Azure OpenAI' : 'OpenAI'} API Error: ${status} - ${error.message}`
      )

      if (status === 401) {
        clientErrorMessage = 'Authentication failed. Please check your API key configuration.'
      } else if (status === 429) {
        clientErrorMessage = 'Rate limit exceeded. Please try again later.'
      } else if (status >= 500) {
        clientErrorMessage =
          'The wand generation service is currently unavailable. Please try again later.'
      }
    } else if (useWandAzure && error.message?.includes('DeploymentNotFound')) {
      clientErrorMessage =
        'Azure OpenAI deployment not found. Please check your model deployment configuration.'
      status = 404
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
