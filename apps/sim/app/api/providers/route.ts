import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import type { StreamingExecution } from '@/executor/types'
import { executeProviderRequest } from '@/providers'
import { getApiKey } from '@/providers/utils'

const logger = createLogger('ProvidersAPI')

export const dynamic = 'force-dynamic'

/**
 * Server-side proxy for provider requests
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = Date.now()

  try {
    logger.info(`[${requestId}] Provider API request started`, {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('User-Agent'),
      contentType: request.headers.get('Content-Type'),
    })

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
      messages,
    } = body

    logger.info(`[${requestId}] Provider request details`, {
      provider,
      model,
      hasSystemPrompt: !!systemPrompt,
      hasContext: !!context,
      hasTools: !!tools?.length,
      toolCount: tools?.length || 0,
      hasApiKey: !!apiKey,
      hasResponseFormat: !!responseFormat,
      workflowId,
      stream: !!stream,
      hasMessages: !!messages?.length,
      messageCount: messages?.length || 0,
    })

    let finalApiKey: string
    try {
      finalApiKey = getApiKey(provider, model, apiKey)
    } catch (error) {
      logger.error(`[${requestId}] Failed to get API key:`, {
        provider,
        model,
        error: error instanceof Error ? error.message : String(error),
        hasProvidedApiKey: !!apiKey,
      })
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'API key error' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Executing provider request`, {
      provider,
      model,
      workflowId,
      hasApiKey: !!finalApiKey,
    })

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
      messages,
    })

    const executionTime = Date.now() - startTime
    logger.info(`[${requestId}] Provider request completed successfully`, {
      provider,
      model,
      workflowId,
      executionTime,
      responseType:
        response instanceof ReadableStream
          ? 'stream'
          : response && typeof response === 'object' && 'stream' in response
            ? 'streaming-execution'
            : 'json',
    })

    // Check if the response is a StreamingExecution
    if (
      response &&
      typeof response === 'object' &&
      'stream' in response &&
      'execution' in response
    ) {
      const streamingExec = response as StreamingExecution
      logger.info(`[${requestId}] Received StreamingExecution from provider`)

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
              // Sanitize content to remove non-ASCII characters that would cause ByteString errors
              content: executionData.output?.response?.content
                ? String(executionData.output.response.content).replace(/[\u0080-\uFFFF]/g, '')
                : '',
              model: executionData.output?.response?.model,
              tokens: executionData.output?.response?.tokens || {
                prompt: 0,
                completion: 0,
                total: 0,
              },
              // Sanitize any potential Unicode characters in tool calls
              toolCalls: executionData.output?.response?.toolCalls
                ? sanitizeToolCalls(executionData.output.response.toolCalls)
                : undefined,
              providerTiming: executionData.output?.response?.providerTiming,
              cost: executionData.output?.response?.cost,
            },
          },
          error: executionData.error,
          logs: [], // Strip logs from header to avoid encoding issues
          metadata: {
            startTime: executionData.metadata?.startTime,
            endTime: executionData.metadata?.endTime,
            duration: executionData.metadata?.duration,
          },
          isStreaming: true, // Always mark streaming execution data as streaming
          blockId: executionData.logs?.[0]?.blockId,
          blockName: executionData.logs?.[0]?.blockName,
          blockType: executionData.logs?.[0]?.blockType,
        }
        executionDataHeader = JSON.stringify(safeExecutionData)
      } catch (error) {
        logger.error(`[${requestId}] Failed to serialize execution data:`, error)
        executionDataHeader = JSON.stringify({
          success: executionData.success,
          error: 'Failed to serialize full execution data',
        })
      }

      // Return the stream with execution data in a header
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Execution-Data': executionDataHeader,
        },
      })
    }

    // Check if the response is a ReadableStream for streaming
    if (response instanceof ReadableStream) {
      logger.info(`[${requestId}] Streaming response from provider`)
      return new Response(response, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Return regular JSON response for non-streaming
    return NextResponse.json(response)
  } catch (error) {
    const executionTime = Date.now() - startTime
    logger.error(`[${requestId}] Provider request failed:`, {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorStack: error instanceof Error ? error.stack : undefined,
      executionTime,
      timestamp: new Date().toISOString(),
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

/**
 * Helper function to sanitize tool calls to remove Unicode characters
 */
function sanitizeToolCalls(toolCalls: any) {
  // If it's an object with a list property, sanitize the list
  if (toolCalls && typeof toolCalls === 'object' && Array.isArray(toolCalls.list)) {
    return {
      ...toolCalls,
      list: toolCalls.list.map(sanitizeToolCall),
    }
  }

  // If it's an array, sanitize each item
  if (Array.isArray(toolCalls)) {
    return toolCalls.map(sanitizeToolCall)
  }

  return toolCalls
}

/**
 * Sanitize a single tool call to remove Unicode characters
 */
function sanitizeToolCall(toolCall: any) {
  if (!toolCall || typeof toolCall !== 'object') return toolCall

  // Create a sanitized copy
  const sanitized = { ...toolCall }

  // Sanitize any string fields that might contain Unicode
  if (typeof sanitized.name === 'string') {
    sanitized.name = sanitized.name.replace(/[\u0080-\uFFFF]/g, '')
  }

  // Sanitize input/arguments
  if (sanitized.input && typeof sanitized.input === 'object') {
    sanitized.input = sanitizeObject(sanitized.input)
  }

  if (sanitized.arguments && typeof sanitized.arguments === 'object') {
    sanitized.arguments = sanitizeObject(sanitized.arguments)
  }

  // Sanitize output/result
  if (sanitized.output && typeof sanitized.output === 'object') {
    sanitized.output = sanitizeObject(sanitized.output)
  }

  if (sanitized.result && typeof sanitized.result === 'object') {
    sanitized.result = sanitizeObject(sanitized.result)
  }

  // Sanitize error message
  if (typeof sanitized.error === 'string') {
    sanitized.error = sanitized.error.replace(/[\u0080-\uFFFF]/g, '')
  }

  return sanitized
}

/**
 * Recursively sanitize an object to remove Unicode characters from strings
 */
function sanitizeObject(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item))
  }

  // Handle objects
  const result: any = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/[\u0080-\uFFFF]/g, '')
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value)
    } else {
      result[key] = value
    }
  }

  return result
}
