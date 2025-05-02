import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { executeProviderRequest } from '@/providers'
import { getApiKey } from '@/providers/utils'
import { StreamingExecution } from '@/executor/types'

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

    // Check if the response is a StreamingExecution
    if (response && typeof response === 'object' && 'stream' in response && 'execution' in response) {
      const streamingExec = response as StreamingExecution
      logger.info('Received StreamingExecution from provider')

      // Extract the stream and execution data
      const stream = streamingExec.stream
      const executionData = streamingExec.execution

      // Attach the execution data as a custom header
      // We need to safely serialize the execution data to avoid circular references
      let executionDataHeader
      try {
        // Create a safe version of execution data with the most important fields
        const safeExecutionData = {
          success: executionData.success,
          output: {
            response: {
              content: executionData.output?.response?.content || '',
              model: executionData.output?.response?.model,
              tokens: executionData.output?.response?.tokens || {
                prompt: 0,
                completion: 0,
                total: 0
              },
              toolCalls: executionData.output?.response?.toolCalls
            }
          },
          error: executionData.error,
          logs: executionData.logs || [],
          metadata: {
            startTime: executionData.metadata?.startTime,
            endTime: executionData.metadata?.endTime,
            duration: executionData.metadata?.duration
          },
          isStreaming: true, // Always mark streaming execution data as streaming
        }
        executionDataHeader = JSON.stringify(safeExecutionData)
      } catch (error) {
        logger.error('Failed to serialize execution data:', error)
        executionDataHeader = JSON.stringify({
          success: executionData.success,
          error: 'Failed to serialize full execution data'
        })
      }
      
      // Return the stream with execution data in a header
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Execution-Data': executionDataHeader
        },
      })
    }
    
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
