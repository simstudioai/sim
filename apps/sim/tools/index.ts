import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { ExecutionContext } from '@/executor/types'
import type { OAuthTokenPayload, ToolConfig, ToolResponse } from '@/tools/types'
import {
  formatRequestParams,
  getTool,
  getToolAsync,
  validateRequiredParametersAfterMerge,
} from '@/tools/utils'

const logger = createLogger('Tools')

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

    logger.info(`File processing for tool ${tool.id}: checking outputs`, Object.keys(result.output))
    const processedOutput = await FileToolProcessor.processToolOutputs(
      result.output,
      tool,
      executionContext
    )
    logger.info(
      `File processing for tool ${tool.id}: processed outputs`,
      Object.keys(processedOutput)
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
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    let tool: ToolConfig | undefined

    // If it's a custom tool, use the async version with workflowId
    if (toolId.startsWith('custom_')) {
      const workflowId = params._context?.workflowId
      tool = await getToolAsync(toolId, workflowId)
      if (!tool) {
        logger.error(`[${requestId}] Custom tool not found: ${toolId}`)
      }
    } else {
      // For built-in tools, use the synchronous version
      tool = getTool(toolId)
      if (!tool) {
        logger.error(`[${requestId}] Built-in tool not found: ${toolId}`)
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

        // Prepare the token payload
        const tokenPayload: OAuthTokenPayload = {
          credentialId: contextParams.credential,
        }

        // Add workflowId if it exists in params or context
        const workflowId = contextParams.workflowId || contextParams._context?.workflowId
        if (workflowId) {
          tokenPayload.workflowId = workflowId
        }

        logger.info(`[${requestId}] Fetching access token from ${baseUrl}/api/auth/oauth/token`)

        const tokenUrl = new URL('/api/auth/oauth/token', baseUrl).toString()
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

        logger.info(
          `[${requestId}] Successfully got access token for ${toolId}, length: ${data.accessToken?.length || 0}`
        )

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
 * Handle an internal/direct tool request
 */
async function handleInternalRequest(
  toolId: string,
  tool: ToolConfig,
  params: Record<string, any>
): Promise<ToolResponse> {
  const requestId = crypto.randomUUID().slice(0, 8)

  // Format the request parameters
  const requestParams = formatRequestParams(tool, params)

  try {
    const baseUrl = getBaseUrl()
    // Handle the case where url may be a function or string
    const endpointUrl =
      typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

    const fullUrl = new URL(endpointUrl, baseUrl).toString()

    // For custom tools, validate parameters on the client side before sending
    if (toolId.startsWith('custom_') && tool.request.body) {
      const requestBody = tool.request.body(params)
      if (requestBody.schema && requestBody.params) {
        try {
          validateClientSideParams(requestBody.params, requestBody.schema)
        } catch (validationError) {
          logger.error(`[${requestId}] Custom tool validation failed for ${toolId}:`, {
            error:
              validationError instanceof Error ? validationError.message : String(validationError),
          })
          throw validationError
        }
      }
    }

    // Prepare request options
    const requestOptions = {
      method: requestParams.method,
      headers: new Headers(requestParams.headers),
      body: requestParams.body,
    }

    const response = await fetch(fullUrl, requestOptions)

    // Parse response data once
    let responseData
    try {
      responseData = await response.json()
    } catch (jsonError) {
      logger.error(`[${requestId}] JSON parse error for ${toolId}:`, {
        error: jsonError instanceof Error ? jsonError.message : String(jsonError),
      })
      throw new Error(`Failed to parse response from ${toolId}: ${jsonError}`)
    }

    // Check for error conditions
    const { isError, errorInfo } = isErrorResponse(response, responseData)

    if (isError) {
      // Handle error case
      const errorToTransform = new Error(
        // GraphQL errors (Linear API)
        errorInfo?.data?.errors?.[0]?.message ||
          // X/Twitter API specific pattern
          errorInfo?.data?.errors?.[0]?.detail ||
          // Generic details array
          errorInfo?.data?.details?.[0]?.message ||
          // Hunter API pattern
          errorInfo?.data?.errors?.[0]?.details ||
          // Direct errors array (when errors[0] is a string or simple object)
          (Array.isArray(errorInfo?.data?.errors)
            ? typeof errorInfo.data.errors[0] === 'string'
              ? errorInfo.data.errors[0]
              : errorInfo.data.errors[0]?.message
            : undefined) ||
          // Notion/Discord/GitHub/Twilio pattern
          errorInfo?.data?.message ||
          // SOAP/XML fault patterns
          errorInfo?.data?.fault?.faultstring ||
          errorInfo?.data?.faultstring ||
          // Microsoft/OAuth error descriptions
          errorInfo?.data?.error_description ||
          // Airtable/Google fallback pattern
          (typeof errorInfo?.data?.error === 'object'
            ? errorInfo?.data?.error?.message || JSON.stringify(errorInfo?.data?.error)
            : errorInfo?.data?.error) ||
          // HTTP status text fallback
          errorInfo?.statusText ||
          // Final fallback
          `Request failed with status ${errorInfo?.status || 'unknown'}`
      )

      // Add error context
      Object.assign(errorToTransform, {
        status: errorInfo?.status,
        statusText: errorInfo?.statusText,
        data: errorInfo?.data,
      })

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
          json: async () => responseData,
          text: async () =>
            typeof responseData === 'string' ? responseData : JSON.stringify(responseData),
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
  const internalParamSet = new Set(['_context', 'workflowId', 'envVars'])

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
  const requestId = crypto.randomUUID().slice(0, 8)

  const baseUrl = getBaseUrl()
  const proxyUrl = new URL('/api/proxy', baseUrl).toString()

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, params, executionContext }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Proxy request failed for ${toolId}:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 200), // Limit error text length
      })

      let errorMessage = `HTTP error ${response.status}: ${response.statusText}`

      try {
        // Try to parse as JSON for more details
        const errorJson = JSON.parse(errorText)
        // Enhanced error extraction to match internal API patterns
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
