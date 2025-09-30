import { NextResponse } from 'next/server'
import { generateInternalToken } from '@/lib/auth/internal'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { validateProxyUrl } from '@/lib/security/url-validation'
import { getBaseUrl } from '@/lib/urls/utils'
import { generateRequestId } from '@/lib/utils'
import { executeTool } from '@/tools'
import { getTool, validateRequiredParametersAfterMerge } from '@/tools/utils'

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
  const requestId = generateRequestId()

  // Vault download proxy: /api/proxy?vaultDownload=1&bucket=...&object=...&credentialId=...
  const vaultDownload = url.searchParams.get('vaultDownload')
  if (vaultDownload === '1') {
    try {
      const bucket = url.searchParams.get('bucket')
      const objectParam = url.searchParams.get('object')
      const credentialId = url.searchParams.get('credentialId')

      if (!bucket || !objectParam || !credentialId) {
        return createErrorResponse('Missing bucket, object, or credentialId', 400)
      }

      // Fetch access token using existing token API
      const baseUrl = new URL(getBaseUrl())
      const tokenUrl = new URL('/api/auth/oauth/token', baseUrl)

      // Build headers: forward session cookies if present; include internal auth for server-side
      const tokenHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      const incomingCookie = request.headers.get('cookie')
      if (incomingCookie) tokenHeaders.Cookie = incomingCookie
      try {
        const internalToken = await generateInternalToken()
        tokenHeaders.Authorization = `Bearer ${internalToken}`
      } catch (_e) {
        // best-effort internal auth
      }

      // Optional workflow context for collaboration auth
      const workflowId = url.searchParams.get('workflowId') || undefined

      const tokenRes = await fetch(tokenUrl.toString(), {
        method: 'POST',
        headers: tokenHeaders,
        body: JSON.stringify({ credentialId, workflowId }),
      })

      if (!tokenRes.ok) {
        const err = await tokenRes.text()
        return createErrorResponse(`Failed to fetch access token: ${err}`, 401)
      }

      const tokenJson = await tokenRes.json()
      const accessToken = tokenJson.accessToken
      if (!accessToken) {
        return createErrorResponse('No access token available', 401)
      }

      // Avoid double-encoding: incoming object may already be percent-encoded
      const objectDecoded = decodeURIComponent(objectParam)
      const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(
        bucket
      )}/o/${encodeURIComponent(objectDecoded)}?alt=media`

      const fileRes = await fetch(gcsUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!fileRes.ok) {
        const errText = await fileRes.text()
        return createErrorResponse(errText || 'Failed to download file', fileRes.status)
      }

      const headers = new Headers()
      fileRes.headers.forEach((v, k) => headers.set(k, v))
      return new NextResponse(fileRes.body, { status: 200, headers })
    } catch (error: any) {
      logger.error(`[${requestId}] Vault download proxy failed`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return createErrorResponse('Vault download failed', 500)
    }
  }

  if (!targetUrl) {
    logger.error(`[${requestId}] Missing 'url' parameter`)
    return createErrorResponse("Missing 'url' parameter", 400)
  }

  const urlValidation = validateProxyUrl(targetUrl)
  if (!urlValidation.isValid) {
    logger.warn(`[${requestId}] Blocked proxy request`, {
      url: targetUrl.substring(0, 100),
      error: urlValidation.error,
    })
    return createErrorResponse(urlValidation.error || 'Invalid URL', 403)
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
    const response = await fetch(targetUrl, {
      method: method,
      headers: {
        ...getProxyHeaders(),
        ...customHeaders,
      },
      body: body || undefined,
    })

    const contentType = response.headers.get('content-type') || ''
    let data

    if (contentType.includes('application/json')) {
      data = await response.json()
    } else {
      data = await response.text()
    }

    const errorMessage = !response.ok
      ? data && typeof data === 'object' && data.error
        ? `${data.error.message || JSON.stringify(data.error)}`
        : response.statusText || `HTTP error ${response.status}`
      : undefined

    if (!response.ok) {
      logger.error(`[${requestId}] External API error: ${response.status} ${response.statusText}`)
    }

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
  const requestId = generateRequestId()
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()

  try {
    let requestBody
    try {
      requestBody = await request.json()
    } catch (parseError) {
      logger.error(`[${requestId}] Failed to parse request body`, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
      })
      throw new Error('Invalid JSON in request body')
    }

    const { toolId, params, executionContext } = requestBody

    if (!toolId) {
      logger.error(`[${requestId}] Missing toolId in request`)
      throw new Error('Missing toolId in request')
    }

    logger.info(`[${requestId}] Processing tool: ${toolId}`)

    const tool = getTool(toolId)

    if (!tool) {
      logger.error(`[${requestId}] Tool not found: ${toolId}`)
      throw new Error(`Tool not found: ${toolId}`)
    }

    try {
      validateRequiredParametersAfterMerge(toolId, tool, params)
    } catch (validationError) {
      logger.warn(`[${requestId}] Tool validation failed for ${toolId}`, {
        error: validationError instanceof Error ? validationError.message : String(validationError),
      })

      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()

      return createErrorResponse(validationError, 400, {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      })
    }

    const hasFileOutputs =
      tool.outputs &&
      Object.values(tool.outputs).some(
        (output) => output.type === 'file' || output.type === 'file[]'
      )

    const result = await executeTool(
      toolId,
      params,
      true, // skipProxy (we're already in the proxy)
      !hasFileOutputs, // skipPostProcess (don't skip if tool has file outputs)
      executionContext // pass execution context for file processing
    )

    if (!result.success) {
      logger.warn(`[${requestId}] Tool execution failed for ${toolId}`, {
        error: result.error || 'Unknown error',
      })

      // Let the main executeTool handle error transformation to avoid double transformation
      throw new Error(result.error || 'Tool execution failed')
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
