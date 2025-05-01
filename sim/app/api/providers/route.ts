import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { executeProviderRequest } from '@/providers'
import { getApiKey } from '@/providers/utils'

const logger = createLogger('ProvidersAPI')

export const dynamic = 'force-dynamic'

/**
 * Server-side proxy for provider requests
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      provider,
      model,
      systemPrompt,
      context,
      tools,
      temperature,
      maxTokens,
      apiKey,
      responseFormat,
      workflowId,
      stream,
    } = body

    let finalApiKey: string
    try {
      finalApiKey = getApiKey(provider, model, apiKey)
    } catch (error) {
      logger.error('Failed to get API key:', error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'API key error' },
        { status: 400 }
      )
    }

    // Execute provider request directly with the managed key
    const response = await executeProviderRequest(provider, {
      model,
      systemPrompt,
      context,
      tools,
      temperature,
      maxTokens,
      apiKey: finalApiKey,
      responseFormat,
      workflowId,
      stream,
    })

    // Check if the response is a ReadableStream for streaming
    if (response instanceof ReadableStream) {
      logger.info('Streaming response from provider')
      return new Response(response, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    // Return regular JSON response for non-streaming
    return NextResponse.json(response)
  } catch (error) {
    logger.error('Provider request failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
