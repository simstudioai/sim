import { NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { executeTool } from '@/tools'
import { getTool } from '@/tools/utils'
import { validateToolRequest } from '@/tools/utils'

const logger = createLogger('ProxyAPI')

/**
 * Creates a minimal set of default headers for proxy requests
 * @returns Record of HTTP headers
 */
const getProxyHeaders = (): Record<string, string> => {
  return {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }
}

/**
 * Formats a response with CORS headers
 * @param responseData Response data object
 * @param status HTTP status code
 * @returns NextResponse with CORS headers
 */
const formatResponse = (responseData: any, status = 200) => {
  return NextResponse.json(responseData, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

/**
 * Creates an error response with consistent formatting
 * @param error Error object or message
 * @param status HTTP status code
 * @param additionalData Additional data to include in the response
 * @returns Formatted error response
 */
const createErrorResponse = (error: any, status = 500, additionalData = {}) => {
  const errorMessage = error instanceof Error ? error.message : String(error)

  return formatResponse(
    {
      success: false,
      error: errorMessage,
      ...additionalData,
    },
    status
  )
}

/**
 * GET handler for direct external URL proxying
 * This allows for GET requests to external APIs
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')
  const requestId = crypto.randomUUID().slice(0, 8)

  if (!targetUrl) {
    return createErrorResponse("Missing 'url' parameter", 400)
  }

  const method = url.searchParams.get('method') || 'GET'

  const bodyParam = url.searchParams.get('body')
  let body: string | undefined = undefined

  if (bodyParam && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    try {
      body = decodeURIComponent(bodyParam)
    } catch (error) {
      logger.warn(`[${requestId}] Failed to decode body parameter`, error)
    }
  }

  const customHeaders: Record<string, string> = {}

  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('header.')) {
      const headerName = key.substring(7)
      customHeaders[headerName] = value
    }
  }

  if (body && !customHeaders['Content-Type']) {
    customHeaders['Content-Type'] = 'application/json'
  }

  logger.info(`[${requestId}] Proxying ${method} request to: ${targetUrl}`)

  try {
    // Forward the request to the target URL with all specified headers
    const response = await fetch(targetUrl, {
      method: method,
      headers: {
        ...getProxyHeaders(),
        ...customHeaders,
      },
      body: body || undefined,
    })

    // Get response data
    const contentType = response.headers.get('content-type') || ''
    let data

    if (contentType.includes('application/json')) {
      data = await response.json()
    } else {
      data = await response.text()
    }

    // For error responses, include a more descriptive error message
    const errorMessage = !response.ok
      ? data && typeof data === 'object' && data.error
        ? `${data.error.message || JSON.stringify(data.error)}`
        : response.statusText || `HTTP error ${response.status}`
      : undefined

    // Return the proxied response
    return formatResponse({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data,
      error: errorMessage,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Proxy GET request failed`, {
      url: targetUrl,
      error: error instanceof Error ? error.message : String(error),
    })

    return createErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()

  try {
    const { toolId, params } = await request.json()

    logger.debug(`[${requestId}] Proxy request for tool`, {
      toolId,
      hasParams: !!params && Object.keys(params).length > 0,
    })

    const tool = getTool(toolId)

    // Validate the tool and its parameters
    try {
      validateToolRequest(toolId, tool, params)
    } catch (error) {
      logger.warn(`[${requestId}] Tool validation failed`, {
        toolId,
        error: error instanceof Error ? error.message : String(error),
      })

      // Add timing information even to error responses
      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      return createErrorResponse(error, 400, {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      })
    }

    try {
      if (!tool) {
        logger.error(`[${requestId}] Tool not found`, { toolId })
        throw new Error(`Tool not found: ${toolId}`)
      }

      // Use executeTool with skipProxy=true to prevent recursive proxy calls, and skipPostProcess=true to prevent duplicate post-processing
      const result = await executeTool(toolId, params, true, true)

      if (!result.success) {
        logger.warn(`[${requestId}] Tool execution failed`, {
          toolId,
          error: result.error || 'Unknown error',
        })

        if (tool.transformError) {
          try {
            const errorResult = tool.transformError(result)

            // Handle both string and Promise return types
            if (typeof errorResult === 'string') {
              throw new Error(errorResult)
            } else {
              // It's a Promise, await it
              const transformedError = await errorResult
              // If it's a string or has an error property, use it
              if (typeof transformedError === 'string') {
                throw new Error(transformedError)
              } else if (
                transformedError &&
                typeof transformedError === 'object' &&
                'error' in transformedError
              ) {
                throw new Error(transformedError.error || 'Tool returned an error')
              }
              // Fallback
              throw new Error('Tool returned an error')
            }
          } catch (e) {
            if (e instanceof Error) {
              throw e
            }
            throw new Error('Tool returned an error')
          }
        } else {
          throw new Error('Tool returned an error')
        }
      }

      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      // Add explicit timing information directly to the response
      const responseWithTimingData = {
        ...result,
        // Add timing data both at root level and in nested timing object
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
        timing: {
          startTime: startTimeISO,
          endTime: endTimeISO,
          duration,
        },
      }

      logger.info(`[${requestId}] Tool executed successfully`, {
        toolId,
        duration,
        startTime: startTimeISO,
        endTime: endTimeISO,
      })

      // Return the response with CORS headers
      return formatResponse(responseWithTimingData)
    } catch (error: any) {
      throw error
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Proxy request failed`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Add timing information even to error responses
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - startTime.getTime()

    return createErrorResponse(error, 500, {
      startTime: startTimeISO,
      endTime: endTimeISO,
      duration,
    })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  })
}
