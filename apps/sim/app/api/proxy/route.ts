import { NextResponse } from 'next/server'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { executeTool } from '@/tools'
import { getTool, validateToolRequest } from '@/tools/utils'

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
  const errorStack = error instanceof Error ? error.stack : undefined

  logger.error('Creating error response', {
    errorMessage,
    status,
    stack: isDev ? errorStack : undefined,
  })

  return formatResponse(
    {
      success: false,
      error: errorMessage,
      stack: isDev ? errorStack : undefined,
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
    logger.error(`[${requestId}] Missing 'url' parameter`)
    return createErrorResponse("Missing 'url' parameter", 400)
  }

  const method = url.searchParams.get('method') || 'GET'

  const bodyParam = url.searchParams.get('body')
  let body: string | undefined

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

    if (!response.ok) {
      logger.error(`[${requestId}] External API error: ${response.status} ${response.statusText}`)
    }

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
      stack: error instanceof Error ? error.stack : undefined,
    })

    return createErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()

  try {
    // Parse request body
    let requestBody
    try {
      requestBody = await request.json()
    } catch (parseError) {
      logger.error(`[${requestId}] Failed to parse request body`, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
      })
      throw new Error('Invalid JSON in request body')
    }

    const { toolId, params } = requestBody

    if (!toolId) {
      logger.error(`[${requestId}] Missing toolId in request`)
      throw new Error('Missing toolId in request')
    }

    logger.info(`[${requestId}] Processing tool: ${toolId}`)

    // Get tool
    const tool = getTool(toolId)

    if (!tool) {
      logger.error(`[${requestId}] Tool not found: ${toolId}`)
      throw new Error(`Tool not found: ${toolId}`)
    }

    // Validate the tool and its parameters
    try {
      validateToolRequest(toolId, tool, params)
    } catch (validationError) {
      logger.warn(`[${requestId}] Tool validation failed for ${toolId}`, {
        error: validationError instanceof Error ? validationError.message : String(validationError),
      })

      // Add timing information even to error responses
      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      return createErrorResponse(validationError, 400, {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      })
    }

    // Execute tool
    const result = await executeTool(toolId, params, true, true)

    if (!result.success) {
      logger.warn(`[${requestId}] Tool execution failed for ${toolId}`, {
        error: result.error || 'Unknown error',
      })

      if (tool.transformError) {
        try {
          const errorResult = tool.transformError(result)

          // Handle both string and Promise return types
          if (typeof errorResult === 'string') {
            throw new Error(errorResult)
          }
          // It's a Promise, await it
          const transformedError = await errorResult
          // If it's a string or has an error property, use it
          if (typeof transformedError === 'string') {
            throw new Error(transformedError)
          }
          if (
            transformedError &&
            typeof transformedError === 'object' &&
            'error' in transformedError
          ) {
            throw new Error(transformedError.error || 'Tool returned an error')
          }
          // Fallback
          throw new Error('Tool returned an error')
        } catch (transformError) {
          logger.error(`[${requestId}] Error transformation failed for ${toolId}`, {
            error:
              transformError instanceof Error ? transformError.message : String(transformError),
          })
          if (transformError instanceof Error) {
            throw transformError
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

    logger.info(`[${requestId}] Tool executed successfully: ${toolId} (${duration}ms)`)

    // Return the response with CORS headers
    return formatResponse(responseWithTimingData)
  } catch (error: any) {
    logger.error(`[${requestId}] Proxy request failed`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined,
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
