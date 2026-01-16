import { createLogger } from '@sim/logger'
import { generateInternalToken } from '@/lib/auth/internal'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { parseMcpToolId } from '@/lib/mcp/utils'
import { isCustomTool, isMcpTool } from '@/executor/constants'
import type { ExecutionContext } from '@/executor/types'
import type { ErrorInfo } from '@/tools/error-extractors'
import { extractErrorMessage } from '@/tools/error-extractors'
import type { OAuthTokenPayload, ToolConfig, ToolResponse } from '@/tools/types'
import {
  formatRequestParams,
  getTool,
  getToolAsync,
  validateRequiredParametersAfterMerge,
} from '@/tools/utils'

const logger = createLogger('Tools')

/**
 * Normalizes a tool ID by stripping resource ID suffix (UUID).
 * Workflow tools: 'workflow_executor_<uuid>' -> 'workflow_executor'
 * Knowledge tools: 'knowledge_search_<uuid>' -> 'knowledge_search'
 */
function normalizeToolId(toolId: string): string {
  // Check for workflow_executor_<uuid> pattern
  if (toolId.startsWith('workflow_executor_') && toolId.length > 'workflow_executor_'.length) {
    return 'workflow_executor'
  }
  // Check for knowledge_<operation>_<uuid> pattern
  const knowledgeOps = ['knowledge_search', 'knowledge_upload_chunk', 'knowledge_create_document']
  for (const op of knowledgeOps) {
    if (toolId.startsWith(`${op}_`) && toolId.length > op.length + 1) {
      return op
    }
  }
  return toolId
}

/**
 * Maximum request body size in bytes before we warn/error about size limits.
 * Next.js 16 has a default middleware/proxy body limit of 10MB.
 */
const MAX_REQUEST_BODY_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

/**
 * User-friendly error message for body size limit exceeded
 */
const BODY_SIZE_LIMIT_ERROR_MESSAGE =
  'Request body size limit exceeded (10MB). The workflow data is too large to process. Try reducing the size of variables, inputs, or data being passed between blocks.'

/**
 * Validates request body size and throws a user-friendly error if exceeded
 * @param body - The request body string to check
 * @param requestId - Request ID for logging
 * @param context - Context string for logging (e.g., toolId)
 * @throws Error if body size exceeds the limit
 */
function validateRequestBodySize(
  body: string | undefined,
  requestId: string,
  context: string
): void {
  if (!body) return

  const bodySize = Buffer.byteLength(body, 'utf8')
  if (bodySize > MAX_REQUEST_BODY_SIZE_BYTES) {
    const bodySizeMB = (bodySize / (1024 * 1024)).toFixed(2)
    const maxSizeMB = (MAX_REQUEST_BODY_SIZE_BYTES / (1024 * 1024)).toFixed(0)
    logger.error(`[${requestId}] Request body size exceeds limit for ${context}:`, {
      bodySize,
      bodySizeMB: `${bodySizeMB}MB`,
      maxSize: MAX_REQUEST_BODY_SIZE_BYTES,
      maxSizeMB: `${maxSizeMB}MB`,
    })
    throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
  }
}

/**
 * Checks if an error message indicates a body size limit issue
 * @param errorMessage - The error message to check
 * @returns true if the error is related to body size limits
 */
function isBodySizeLimitError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase()
  return (
    lowerMessage.includes('body size') ||
    lowerMessage.includes('payload too large') ||
    lowerMessage.includes('entity too large') ||
    lowerMessage.includes('request entity too large') ||
    lowerMessage.includes('body_not_allowed') ||
    lowerMessage.includes('request body larger than')
  )
}

/**
 * Handles body size limit errors by logging and throwing a user-friendly error
 * @param error - The original error
 * @param requestId - Request ID for logging
 * @param context - Context string for logging (e.g., toolId)
 * @throws Error with user-friendly message if it's a size limit error
 * @returns false if not a size limit error (caller should continue handling)
 */
function handleBodySizeLimitError(error: unknown, requestId: string, context: string): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error)

  if (isBodySizeLimitError(errorMessage)) {
    logger.error(`[${requestId}] Request body size limit exceeded for ${context}:`, {
      originalError: errorMessage,
    })
    throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
  }

  return false
}

/**
 * System parameters that should be filtered out when extracting tool arguments
 * These are internal parameters used by the execution framework, not tool inputs
 */
const MCP_SYSTEM_PARAMETERS = new Set([
  'serverId',
  'serverUrl',
  'toolName',
  'serverName',
  '_context',
  'envVars',
  'workflowVariables',
  'blockData',
  'blockNameMapping',
  '_toolSchema',
])

/**
 * Create an Error instance from errorInfo and attach useful context
 * Uses the error extractor registry to find the best error message
 */
function createTransformedErrorFromErrorInfo(errorInfo?: ErrorInfo, extractorId?: string): Error {
  const message = extractErrorMessage(errorInfo, extractorId)
  const transformed = new Error(message)
  Object.assign(transformed, {
    status: errorInfo?.status,
    statusText: errorInfo?.statusText,
    data: errorInfo?.data,
  })
  return transformed
}

/**
 * Process file outputs for a tool result if execution context is available
 * Uses dynamic imports to avoid client-side bundling issues
 */
async function processFileOutputs(
  result: ToolResponse,
  tool: ToolConfig,
  executionContext?: ExecutionContext
): Promise<ToolResponse> {
  // Skip file processing if no execution context or not successful
  if (!executionContext || !result.success) {
    return result
  }

  // Skip file processing on client-side (no Node.js modules available)
  if (typeof window !== 'undefined') {
    return result
  }

  try {
    // Dynamic import to avoid client-side bundling issues
    const { FileToolProcessor } = await import('@/executor/utils/file-tool-processor')

    // Check if tool has file outputs
    if (!FileToolProcessor.hasFileOutputs(tool)) {
      return result
    }

    const processedOutput = await FileToolProcessor.processToolOutputs(
      result.output,
      tool,
      executionContext
    )

    return {
      ...result,
      output: processedOutput,
    }
  } catch (error) {
    logger.error(`Error processing file outputs for tool ${tool.id}:`, error)
    // Return original result if file processing fails
    return result
  }
}

// Execute a tool by calling either the proxy for external APIs or directly for internal routes
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  skipProxy = false,
  skipPostProcess = false,
  executionContext?: ExecutionContext
): Promise<ToolResponse> {
  // Capture start time for precise timing
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()
  const requestId = generateRequestId()

  try {
    let tool: ToolConfig | undefined

    // Normalize tool ID to strip resource suffixes (e.g., workflow_executor_<uuid> -> workflow_executor)
    const normalizedToolId = normalizeToolId(toolId)

    // If it's a custom tool, use the async version with workflowId
    if (isCustomTool(normalizedToolId)) {
      const workflowId = params._context?.workflowId
      tool = await getToolAsync(normalizedToolId, workflowId)
      if (!tool) {
        logger.error(`[${requestId}] Custom tool not found: ${normalizedToolId}`)
      }
    } else if (isMcpTool(normalizedToolId)) {
      return await executeMcpTool(
        normalizedToolId,
        params,
        executionContext,
        requestId,
        startTimeISO
      )
    } else {
      // For built-in tools, use the synchronous version
      tool = getTool(normalizedToolId)
      if (!tool) {
        logger.error(`[${requestId}] Built-in tool not found: ${normalizedToolId}`)
      }
    }

    // Ensure context is preserved if it exists
    const contextParams = { ...params }

    // Validate the tool and its parameters
    validateRequiredParametersAfterMerge(toolId, tool, contextParams)

    // After validation, we know tool exists
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    // If we have a credential parameter, fetch the access token
    if (contextParams.credential) {
      logger.info(
        `[${requestId}] Tool ${toolId} needs access token for credential: ${contextParams.credential}`
      )
      try {
        const baseUrl = getBaseUrl()

        const tokenPayload: OAuthTokenPayload = {
          credentialId: contextParams.credential as string,
        }

        // Add workflowId if it exists in params, context, or executionContext
        const workflowId =
          contextParams.workflowId ||
          contextParams._context?.workflowId ||
          executionContext?.workflowId
        if (workflowId) {
          tokenPayload.workflowId = workflowId
        }

        logger.info(`[${requestId}] Fetching access token from ${baseUrl}/api/auth/oauth/token`)

        // Build token URL and also include workflowId in query so server auth can read it
        const tokenUrlObj = new URL('/api/auth/oauth/token', baseUrl)
        if (workflowId) {
          tokenUrlObj.searchParams.set('workflowId', workflowId)
        }

        // Always send Content-Type; add internal auth on server-side runs
        const tokenHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (typeof window === 'undefined') {
          try {
            const internalToken = await generateInternalToken()
            tokenHeaders.Authorization = `Bearer ${internalToken}`
          } catch (_e) {
            // Swallow token generation errors; the request will fail and be reported upstream
          }
        }

        const response = await fetch(tokenUrlObj.toString(), {
          method: 'POST',
          headers: tokenHeaders,
          body: JSON.stringify(tokenPayload),
        })

        if (!response.ok) {
          const errorText = await response.text()
          logger.error(`[${requestId}] Token fetch failed for ${toolId}:`, {
            status: response.status,
            error: errorText,
          })
          throw new Error(`Failed to fetch access token: ${response.status} ${errorText}`)
        }

        const data = await response.json()
        contextParams.accessToken = data.accessToken
        if (data.idToken) {
          contextParams.idToken = data.idToken
        }
        if (data.instanceUrl) {
          contextParams.instanceUrl = data.instanceUrl
        }

        logger.info(`[${requestId}] Successfully got access token for ${toolId}`)

        // Preserve credential for downstream transforms while removing it from request payload
        // so we don't leak it to external services.
        if (contextParams.credential) {
          ;(contextParams as any)._credentialId = contextParams.credential
        }
        if (workflowId) {
          ;(contextParams as any)._workflowId = workflowId
        }
        // Clean up params we don't need to pass to the actual tool
        contextParams.credential = undefined
        if (contextParams.workflowId) contextParams.workflowId = undefined
      } catch (error: any) {
        logger.error(`[${requestId}] Error fetching access token for ${toolId}:`, {
          error: error instanceof Error ? error.message : String(error),
        })
        // Re-throw the error to fail the tool execution if token fetching fails
        throw new Error(
          `Failed to obtain credential for tool ${toolId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    // Check for direct execution (no HTTP request needed)
    if (tool.directExecution) {
      logger.info(`[${requestId}] Using directExecution for ${toolId}`)
      const result = await tool.directExecution(contextParams)

      // Apply post-processing if available and not skipped
      let finalResult = result
      if (tool.postProcess && result.success && !skipPostProcess) {
        try {
          finalResult = await tool.postProcess(result, contextParams, executeTool)
        } catch (error) {
          logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
            error: error instanceof Error ? error.message : String(error),
          })
          finalResult = result
        }
      }

      // Process file outputs if execution context is available
      finalResult = await processFileOutputs(finalResult, tool, executionContext)

      // Add timing data to the result
      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()
      return {
        ...finalResult,
        timing: {
          startTime: startTimeISO,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    // For internal routes or when skipProxy is true, call the API directly
    // Internal routes are automatically detected by checking if URL starts with /api/
    const endpointUrl =
      typeof tool.request.url === 'function' ? tool.request.url(contextParams) : tool.request.url
    const isInternalRoute = endpointUrl.startsWith('/api/')

    if (isInternalRoute || skipProxy) {
      const result = await handleInternalRequest(toolId, tool, contextParams)

      // Apply post-processing if available and not skipped
      let finalResult = result
      if (tool.postProcess && result.success && !skipPostProcess) {
        try {
          finalResult = await tool.postProcess(result, contextParams, executeTool)
        } catch (error) {
          logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
            error: error instanceof Error ? error.message : String(error),
          })
          finalResult = result
        }
      }

      // Process file outputs if execution context is available
      finalResult = await processFileOutputs(finalResult, tool, executionContext)

      // Add timing data to the result
      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()
      return {
        ...finalResult,
        timing: {
          startTime: startTimeISO,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    // For external APIs, use the proxy
    const result = await handleProxyRequest(toolId, contextParams, executionContext)

    // Apply post-processing if available and not skipped
    let finalResult = result
    if (tool.postProcess && result.success && !skipPostProcess) {
      try {
        finalResult = await tool.postProcess(result, contextParams, executeTool)
      } catch (error) {
        logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
          error: error instanceof Error ? error.message : String(error),
        })
        finalResult = result
      }
    }

    // Process file outputs if execution context is available
    finalResult = await processFileOutputs(finalResult, tool, executionContext)

    // Add timing data to the result
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - startTime.getTime()
    return {
      ...finalResult,
      timing: {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      },
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing tool ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Default error handling
    let errorMessage = 'Unknown error occurred'
    let errorDetails = {}

    if (error instanceof Error) {
      errorMessage = error.message || `Error executing tool ${toolId}`
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      // Handle HTTP response errors
      if (error.status) {
        errorMessage = `HTTP ${error.status}: ${error.statusText || 'Request failed'}`

        if (error.data) {
          if (typeof error.data === 'string') {
            errorMessage = `${errorMessage} - ${error.data}`
          } else if (error.data.message) {
            errorMessage = `${errorMessage} - ${error.data.message}`
          } else if (error.data.error) {
            errorMessage = `${errorMessage} - ${
              typeof error.data.error === 'string'
                ? error.data.error
                : JSON.stringify(error.data.error)
            }`
          }
        }

        errorDetails = {
          status: error.status,
          statusText: error.statusText,
          data: error.data,
        }
      }
      // Handle other errors with messages
      else if (error.message) {
        // Don't pass along "undefined (undefined)" messages
        if (error.message === 'undefined (undefined)') {
          errorMessage = `Error executing tool ${toolId}`
          // Add status if available
          if (error.status) {
            errorMessage += ` (Status: ${error.status})`
          }
        } else {
          errorMessage = error.message
        }

        if ((error as any).cause) {
          errorMessage = `${errorMessage} (${(error as any).cause})`
        }
      }
    }

    // Add timing data even for errors
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - startTime.getTime()
    return {
      success: false,
      output: errorDetails,
      error: errorMessage,
      timing: {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      },
    }
  }
}

/**
 * Determines if a response or result represents an error condition
 */
function isErrorResponse(
  response: Response | any,
  data?: any
): { isError: boolean; errorInfo?: { status?: number; statusText?: string; data?: any } } {
  // HTTP Response object
  if (response && typeof response === 'object' && 'ok' in response) {
    if (!response.ok) {
      return {
        isError: true,
        errorInfo: {
          status: response.status,
          statusText: response.statusText,
          data: data,
        },
      }
    }
    return { isError: false }
  }

  // ToolResponse object
  if (response && typeof response === 'object' && 'success' in response) {
    return {
      isError: !response.success,
      errorInfo: response.success ? undefined : { data: response },
    }
  }

  // Check for error indicators in data
  if (data && typeof data === 'object') {
    if (data.error || data.success === false) {
      return {
        isError: true,
        errorInfo: { data: data },
      }
    }
  }

  return { isError: false }
}

/**
 * Add internal authentication token to headers if running on server
 * @param headers - Headers object to modify
 * @param isInternalRoute - Whether the target URL is an internal route
 * @param requestId - Request ID for logging
 * @param context - Context string for logging (e.g., toolId or 'proxy')
 */
async function addInternalAuthIfNeeded(
  headers: Headers | Record<string, string>,
  isInternalRoute: boolean,
  requestId: string,
  context: string
): Promise<void> {
  if (typeof window === 'undefined') {
    if (isInternalRoute) {
      try {
        const internalToken = await generateInternalToken()
        if (headers instanceof Headers) {
          headers.set('Authorization', `Bearer ${internalToken}`)
        } else {
          headers.Authorization = `Bearer ${internalToken}`
        }
        logger.info(`[${requestId}] Added internal auth token for ${context}`)
      } catch (error) {
        logger.error(`[${requestId}] Failed to generate internal token for ${context}:`, error)
      }
    } else {
      logger.info(`[${requestId}] Skipping internal auth token for external URL: ${context}`)
    }
  }
}

/**
 * Handle an internal/direct tool request
 */
async function handleInternalRequest(
  toolId: string,
  tool: ToolConfig,
  params: Record<string, any>
): Promise<ToolResponse> {
  const requestId = generateRequestId()

  const requestParams = formatRequestParams(tool, params)

  try {
    const baseUrl = getBaseUrl()
    const endpointUrl =
      typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

    const fullUrlObj = new URL(endpointUrl, baseUrl)
    const isInternalRoute = endpointUrl.startsWith('/api/')

    if (isInternalRoute) {
      const workflowId = params._context?.workflowId
      if (workflowId) {
        fullUrlObj.searchParams.set('workflowId', workflowId)
      }
    }

    const fullUrl = fullUrlObj.toString()

    if (isCustomTool(toolId) && tool.request.body) {
      const requestBody = tool.request.body(params)
      if (
        typeof requestBody === 'object' &&
        requestBody !== null &&
        'schema' in requestBody &&
        'params' in requestBody
      ) {
        try {
          validateClientSideParams(
            requestBody.params as Record<string, any>,
            requestBody.schema as {
              type: string
              properties: Record<string, any>
              required?: string[]
            }
          )
        } catch (validationError) {
          logger.error(`[${requestId}] Custom tool validation failed for ${toolId}:`, {
            error:
              validationError instanceof Error ? validationError.message : String(validationError),
          })
          throw validationError
        }
      }
    }

    const headers = new Headers(requestParams.headers)
    await addInternalAuthIfNeeded(headers, isInternalRoute, requestId, toolId)

    // Check request body size before sending to detect potential size limit issues
    validateRequestBodySize(requestParams.body, requestId, toolId)

    // Prepare request options
    const requestOptions = {
      method: requestParams.method,
      headers: headers,
      body: requestParams.body,
    }

    const response = await fetch(fullUrl, requestOptions)

    // For non-OK responses, attempt JSON first; if parsing fails, fall back to text
    if (!response.ok) {
      // Check for 413 (Entity Too Large) - body size limit exceeded
      if (response.status === 413) {
        logger.error(`[${requestId}] Request body too large for ${toolId} (HTTP 413):`, {
          status: response.status,
          statusText: response.statusText,
        })
        throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
      }

      let errorData: any
      try {
        errorData = await response.json()
      } catch (jsonError) {
        // JSON parsing failed, fall back to reading as text for error extraction
        logger.warn(`[${requestId}] Response is not JSON for ${toolId}, reading as text`)
        try {
          errorData = await response.text()
        } catch (textError) {
          logger.error(`[${requestId}] Failed to read response body for ${toolId}`)
          errorData = null
        }
      }

      const errorInfo: ErrorInfo = {
        status: response.status,
        statusText: response.statusText,
        data: errorData,
      }

      const errorToTransform = createTransformedErrorFromErrorInfo(errorInfo, tool.errorExtractor)

      logger.error(`[${requestId}] Internal API error for ${toolId}:`, {
        status: errorInfo.status,
        errorData: errorInfo.data,
      })

      throw errorToTransform
    }

    // Parse response data once with guard for empty 202 bodies
    let responseData
    const status = response.status
    if (status === 202) {
      // Many APIs (e.g., Microsoft Graph) return 202 with empty body
      responseData = { status }
    } else {
      if (tool.transformResponse) {
        responseData = null
      } else {
        try {
          responseData = await response.json()
        } catch (jsonError) {
          logger.error(`[${requestId}] JSON parse error for ${toolId}:`, {
            error: jsonError instanceof Error ? jsonError.message : String(jsonError),
          })
          throw new Error(`Failed to parse response from ${toolId}: ${jsonError}`)
        }
      }
    }

    // Check for error conditions
    const { isError, errorInfo } = isErrorResponse(response, responseData)

    if (isError) {
      // Handle error case
      const errorToTransform = createTransformedErrorFromErrorInfo(errorInfo, tool.errorExtractor)

      logger.error(`[${requestId}] Internal API error for ${toolId}:`, {
        status: errorInfo?.status,
        errorData: errorInfo?.data,
      })

      throw errorToTransform
    }

    // Success case: use transformResponse if available
    if (tool.transformResponse) {
      try {
        // Create a mock response object that provides the methods transformResponse needs
        const mockResponse = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          url: fullUrl,
          json: () => response.json(),
          text: () => response.text(),
          arrayBuffer: () => response.arrayBuffer(),
          blob: () => response.blob(),
        } as Response

        const data = await tool.transformResponse(mockResponse, params)
        return data
      } catch (transformError) {
        logger.error(`[${requestId}] Transform response error for ${toolId}:`, {
          error: transformError instanceof Error ? transformError.message : String(transformError),
        })
        throw transformError
      }
    }

    // Default success response handling
    return {
      success: true,
      output: responseData.output || responseData,
      error: undefined,
    }
  } catch (error: any) {
    // Check if this is a body size limit error and throw user-friendly message
    handleBodySizeLimitError(error, requestId, toolId)

    logger.error(`[${requestId}] Internal request error for ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
    })

    // Let the error bubble up to be handled in the main executeTool function
    throw error
  }
}

/**
 * Validates parameters on the client side before sending to the execute endpoint
 */
function validateClientSideParams(
  params: Record<string, any>,
  schema: {
    type: string
    properties: Record<string, any>
    required?: string[]
  }
) {
  if (!schema || schema.type !== 'object') {
    throw new Error('Invalid schema format')
  }

  // Internal parameters that should be excluded from validation
  const internalParamSet = new Set([
    '_context',
    '_toolSchema',
    'workflowId',
    'envVars',
    'workflowVariables',
    'blockData',
    'blockNameMapping',
  ])

  // Check required parameters
  if (schema.required) {
    for (const requiredParam of schema.required) {
      if (!(requiredParam in params)) {
        throw new Error(`Required parameter missing: ${requiredParam}`)
      }
    }
  }

  // Check parameter types (basic validation)
  for (const [paramName, paramValue] of Object.entries(params)) {
    // Skip validation for internal parameters
    if (internalParamSet.has(paramName)) {
      continue
    }

    const paramSchema = schema.properties[paramName]
    if (!paramSchema) {
      throw new Error(`Unknown parameter: ${paramName}`)
    }

    // Basic type checking
    const type = paramSchema.type
    if (type === 'string' && typeof paramValue !== 'string') {
      throw new Error(`Parameter ${paramName} should be a string`)
    }
    if (type === 'number' && typeof paramValue !== 'number') {
      throw new Error(`Parameter ${paramName} should be a number`)
    }
    if (type === 'boolean' && typeof paramValue !== 'boolean') {
      throw new Error(`Parameter ${paramName} should be a boolean`)
    }
    if (type === 'array' && !Array.isArray(paramValue)) {
      throw new Error(`Parameter ${paramName} should be an array`)
    }
    if (type === 'object' && (typeof paramValue !== 'object' || paramValue === null)) {
      throw new Error(`Parameter ${paramName} should be an object`)
    }
  }
}

/**
 * Handle a request via the proxy
 */
async function handleProxyRequest(
  toolId: string,
  params: Record<string, any>,
  executionContext?: ExecutionContext
): Promise<ToolResponse> {
  const requestId = generateRequestId()

  const baseUrl = getBaseUrl()
  const proxyUrl = new URL('/api/proxy', baseUrl).toString()

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    await addInternalAuthIfNeeded(headers, true, requestId, `proxy:${toolId}`)

    const body = JSON.stringify({ toolId, params, executionContext })

    // Check request body size before sending
    validateRequestBodySize(body, requestId, `proxy:${toolId}`)

    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers,
      body,
    })

    if (!response.ok) {
      // Check for 413 (Entity Too Large) - body size limit exceeded
      if (response.status === 413) {
        logger.error(`[${requestId}] Request body too large for proxy:${toolId} (HTTP 413)`)
        throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
      }

      const errorText = await response.text()
      logger.error(`[${requestId}] Proxy request failed for ${toolId}:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 200), // Limit error text length
      })

      let errorMessage = `HTTP error ${response.status}: ${response.statusText}`

      try {
        const errorJson = JSON.parse(errorText)
        errorMessage =
          // Primary error patterns
          errorJson.errors?.[0]?.message ||
          errorJson.errors?.[0]?.detail ||
          errorJson.error?.message ||
          (typeof errorJson.error === 'string' ? errorJson.error : undefined) ||
          errorJson.message ||
          errorJson.error_description ||
          errorJson.fault?.faultstring ||
          errorJson.faultstring ||
          // Fallback
          (typeof errorJson.error === 'object'
            ? `API Error: ${response.status} ${response.statusText}`
            : `HTTP error ${response.status}: ${response.statusText}`)
      } catch (parseError) {
        // If not JSON, use the raw text
        if (errorText) {
          errorMessage = `${errorMessage}: ${errorText}`
        }
      }

      throw new Error(errorMessage)
    }

    // Parse the successful response
    const result = await response.json()
    return result
  } catch (error: any) {
    // Check if this is a body size limit error and throw user-friendly message
    handleBodySizeLimitError(error, requestId, `proxy:${toolId}`)

    logger.error(`[${requestId}] Proxy request error for ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      success: false,
      output: {},
      error: error.message || 'Proxy request failed',
    }
  }
}

/**
 * Execute an MCP tool via the server-side proxy
 *
 * @param toolId - MCP tool ID in format "mcp-serverId-toolName"
 * @param params - Tool parameters
 * @param executionContext - Execution context
 * @param requestId - Request ID for logging
 * @param startTimeISO - Start time for timing
 */
async function executeMcpTool(
  toolId: string,
  params: Record<string, any>,
  executionContext?: ExecutionContext,
  requestId?: string,
  startTimeISO?: string
): Promise<ToolResponse> {
  const actualRequestId = requestId || generateRequestId()
  const actualStartTime = startTimeISO || new Date().toISOString()

  try {
    logger.info(`[${actualRequestId}] Executing MCP tool: ${toolId}`)

    const { serverId, toolName } = parseMcpToolId(toolId)

    const baseUrl = getBaseUrl()

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (typeof window === 'undefined') {
      try {
        const internalToken = await generateInternalToken()
        headers.Authorization = `Bearer ${internalToken}`
      } catch (error) {
        logger.error(`[${actualRequestId}] Failed to generate internal token:`, error)
      }
    }

    // Handle two different parameter structures:
    // 1. Direct MCP blocks: arguments are stored as JSON string in 'arguments' field
    // 2. Agent blocks: arguments are passed directly as top-level parameters
    let toolArguments = {}

    // First check if we have the 'arguments' field (direct MCP block usage)
    if (params.arguments) {
      if (typeof params.arguments === 'string') {
        try {
          toolArguments = JSON.parse(params.arguments)
        } catch (error) {
          logger.warn(`[${actualRequestId}] Failed to parse MCP arguments JSON:`, params.arguments)
          toolArguments = {}
        }
      } else {
        toolArguments = params.arguments
      }
    } else {
      // Agent block usage: extract MCP-specific arguments by filtering out system parameters
      toolArguments = Object.fromEntries(
        Object.entries(params).filter(([key]) => !MCP_SYSTEM_PARAMETERS.has(key))
      )
    }

    const workspaceId = params._context?.workspaceId || executionContext?.workspaceId
    const workflowId = params._context?.workflowId || executionContext?.workflowId

    if (!workspaceId) {
      return {
        success: false,
        output: {},
        error: `Missing workspaceId in execution context for MCP tool ${toolName}`,
        timing: {
          startTime: actualStartTime,
          endTime: new Date().toISOString(),
          duration: Date.now() - new Date(actualStartTime).getTime(),
        },
      }
    }

    // Get tool schema if provided (from agent block's cached schema)
    const toolSchema = params._toolSchema

    const requestBody: Record<string, any> = {
      serverId,
      toolName,
      arguments: toolArguments,
      workflowId, // Pass workflow context for user resolution
      workspaceId, // Pass workspace context for scoping
    }

    // Include schema to skip discovery on execution
    if (toolSchema) {
      requestBody.toolSchema = toolSchema
    }

    const body = JSON.stringify(requestBody)

    // Check request body size before sending
    validateRequestBodySize(body, actualRequestId, `mcp:${toolId}`)

    logger.info(`[${actualRequestId}] Making MCP tool request to ${toolName} on ${serverId}`, {
      hasWorkspaceId: !!workspaceId,
      hasWorkflowId: !!workflowId,
      hasToolSchema: !!toolSchema,
    })

    const response = await fetch(`${baseUrl}/api/mcp/tools/execute`, {
      method: 'POST',
      headers,
      body,
    })

    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - new Date(actualStartTime).getTime()

    if (!response.ok) {
      // Check for 413 (Entity Too Large) - body size limit exceeded
      if (response.status === 413) {
        logger.error(`[${actualRequestId}] Request body too large for mcp:${toolId} (HTTP 413)`)
        return {
          success: false,
          output: {},
          error: BODY_SIZE_LIMIT_ERROR_MESSAGE,
          timing: {
            startTime: actualStartTime,
            endTime: endTimeISO,
            duration,
          },
        }
      }

      let errorMessage = `MCP tool execution failed: ${response.status} ${response.statusText}`

      try {
        const errorData = await response.json()
        if (errorData.error) {
          errorMessage = errorData.error
        }
      } catch {
        // Failed to parse error response, use default message
      }

      return {
        success: false,
        output: {},
        error: errorMessage,
        timing: {
          startTime: actualStartTime,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    const result = await response.json()

    if (!result.success) {
      return {
        success: false,
        output: {},
        error: result.error || 'MCP tool execution failed',
        timing: {
          startTime: actualStartTime,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    logger.info(`[${actualRequestId}] MCP tool ${toolId} executed successfully`)

    return {
      success: true,
      output: result.data?.output || result.output || result.data || {},
      timing: {
        startTime: actualStartTime,
        endTime: endTimeISO,
        duration,
      },
    }
  } catch (error) {
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - new Date(actualStartTime).getTime()

    // Check if this is a body size limit error
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (isBodySizeLimitError(errorMsg)) {
      logger.error(`[${actualRequestId}] Request body size limit exceeded for mcp:${toolId}:`, {
        originalError: errorMsg,
      })
      return {
        success: false,
        output: {},
        error: BODY_SIZE_LIMIT_ERROR_MESSAGE,
        timing: {
          startTime: actualStartTime,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    logger.error(`[${actualRequestId}] Error executing MCP tool ${toolId}:`, error)

    const errorMessage =
      error instanceof Error ? error.message : `Failed to execute MCP tool ${toolId}`

    return {
      success: false,
      output: {},
      error: errorMessage,
      timing: {
        startTime: actualStartTime,
        endTime: endTimeISO,
        duration,
      },
    }
  }
}
