import { createLogger } from '@/lib/logs/console-logger'
import { OAuthTokenPayload, ToolConfig, ToolResponse } from './types'
import { getTool, getToolAsync } from './utils'
import { formatRequestParams, validateToolRequest } from './utils'

const logger = createLogger('Tools')

// Execute a tool by calling either the proxy for external APIs or directly for internal routes
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  skipProxy = false,
  skipPostProcess = false
): Promise<ToolResponse> {
  // Capture start time for precise timing
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()

  try {
    let tool: ToolConfig | undefined

    // If it's a custom tool, use the async version with workflowId
    if (toolId.startsWith('custom_')) {
      const workflowId = params._context?.workflowId
      tool = await getToolAsync(toolId, workflowId)
    } else {
      // For built-in tools, use the synchronous version
      tool = getTool(toolId)
    }

    // Ensure context is preserved if it exists
    const contextParams = { ...params }

    // Validate the tool and its parameters
    validateToolRequest(toolId, tool, contextParams)

    // After validation, we know tool exists
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    // If we have a credential parameter, fetch the access token
    if (contextParams.credential) {
      logger.info(`[executeTool] Credential found for ${toolId}, fetching access token.`)
      try {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL
        if (!baseUrl) {
          throw new Error('NEXT_PUBLIC_APP_URL environment variable is not set')
        }

        const isServerSide = typeof window === 'undefined'

        // Prepare the token payload
        const tokenPayload: OAuthTokenPayload = {
          credentialId: contextParams.credential,
        }

        // Add workflowId if it exists in params or context (only server-side)
        if (isServerSide) {
          const workflowId = contextParams.workflowId || contextParams._context?.workflowId
          if (workflowId) {
            tokenPayload.workflowId = workflowId
            logger.info(
              `[executeTool] Added workflowId ${workflowId} to token payload for ${toolId}`
            )
          }
        }

        const tokenUrl = new URL('/api/auth/oauth/token', baseUrl).toString()
        const response = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokenPayload),
        })

        if (!response.ok) {
          const errorText = await response.text()
          logger.error('[executeTool] Token fetch failed:', response.status, errorText)
          throw new Error(`Failed to fetch access token: ${response.status} ${errorText}`)
        }

        const data = await response.json()
        contextParams.accessToken = data.accessToken
        logger.info(`[executeTool] Successfully fetched access token for ${toolId}`)

        // Clean up params we don't need to pass to the actual tool
        delete contextParams.credential
        if (contextParams.workflowId) delete contextParams.workflowId
      } catch (error) {
        logger.error('[executeTool] Error fetching access token:', { error })
        // Re-throw the error to fail the tool execution if token fetching fails
        throw new Error(
          `Failed to obtain credential for tool ${toolId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    // For any tool with direct execution capability, try it first
    if (tool.directExecution) {
      try {
        const directResult = await tool.directExecution(contextParams)
        if (directResult) {
          // Add timing data to the result
          const endTime = new Date()
          const endTimeISO = endTime.toISOString()
          const duration = endTime.getTime() - startTime.getTime()

          // Apply post-processing if available and not skipped
          if (tool.postProcess && directResult.success && !skipPostProcess) {
            try {
              const postProcessResult = await tool.postProcess(
                directResult,
                contextParams,
                executeTool
              )
              return {
                ...postProcessResult,
                timing: {
                  startTime: startTimeISO,
                  endTime: endTimeISO,
                  duration,
                },
              }
            } catch (error) {
              logger.error(`Error in post-processing for tool ${toolId}:`, { error })
              return {
                ...directResult,
                timing: {
                  startTime: startTimeISO,
                  endTime: endTimeISO,
                  duration,
                },
              }
            }
          }

          return {
            ...directResult,
            timing: {
              startTime: startTimeISO,
              endTime: endTimeISO,
              duration,
            },
          }
        }
        // If directExecution returns undefined, fall back to API route
      } catch (error) {
        logger.warn(`Direct execution failed for tool ${toolId}, falling back to API:`, error)
        // Fall back to API route if direct execution fails
      }
    }

    // For internal routes or when skipProxy is true, call the API directly
    if (tool.request.isInternalRoute || skipProxy) {
      const result = await handleInternalRequest(toolId, tool, contextParams)

      // Apply post-processing if available and not skipped
      if (tool.postProcess && result.success && !skipPostProcess) {
        try {
          const postProcessResult = await tool.postProcess(result, contextParams, executeTool)

          // Add timing data to the post-processed result
          const endTime = new Date()
          const endTimeISO = endTime.toISOString()
          const duration = endTime.getTime() - startTime.getTime()
          return {
            ...postProcessResult,
            timing: {
              startTime: startTimeISO,
              endTime: endTimeISO,
              duration,
            },
          }
        } catch (error) {
          logger.error(`Error in post-processing for tool ${toolId}:`, { error })
          // Return original result if post-processing fails
          // Still include timing data
          const endTime = new Date()
          const endTimeISO = endTime.toISOString()
          const duration = endTime.getTime() - startTime.getTime()
          return {
            ...result,
            timing: {
              startTime: startTimeISO,
              endTime: endTimeISO,
              duration,
            },
          }
        }
      }

      // Add timing data to the result
      const endTime = new Date()
      const endTimeISO = endTime.toISOString()
      const duration = endTime.getTime() - startTime.getTime()
      return {
        ...result,
        timing: {
          startTime: startTimeISO,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    // For external APIs, use the proxy
    logger.info(`[executeTool] Using handleProxyRequest for toolId=${toolId}`)
    const result = await handleProxyRequest(toolId, contextParams)

    // Apply post-processing if available and not skipped
    if (tool.postProcess && result.success && !skipPostProcess) {
      try {
        const postProcessResult = await tool.postProcess(result, contextParams, executeTool)

        // Add timing data to the post-processed result
        const endTime = new Date()
        const endTimeISO = endTime.toISOString()
        const duration = endTime.getTime() - startTime.getTime()
        return {
          ...postProcessResult,
          timing: {
            startTime: startTimeISO,
            endTime: endTimeISO,
            duration,
          },
        }
      } catch (error) {
        logger.error(`Error in post-processing for tool ${toolId}:`, { error })
        // Return original result if post-processing fails, but include timing data
        const endTime = new Date()
        const endTimeISO = endTime.toISOString()
        const duration = endTime.getTime() - startTime.getTime()
        return {
          ...result,
          timing: {
            startTime: startTimeISO,
            endTime: endTimeISO,
            duration,
          },
        }
      }
    }

    // Add timing data to the result
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - startTime.getTime()
    return {
      ...result,
      timing: {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      },
    }
  } catch (error: any) {
    logger.error(`Error executing tool ${toolId}:`, { error })

    // Process the error to ensure we have a useful message
    let errorMessage = 'Unknown error occurred'
    let errorDetails = {}

    if (error instanceof Error) {
      errorMessage = error.message || `Error executing tool ${toolId}`
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      // Handle API response errors
      if (error.response) {
        const response = error.response
        errorMessage = `API Error: ${response.statusText || response.status || 'Unknown status'}`

        // Try to extract more details from the response
        if (response.data) {
          if (typeof response.data === 'string') {
            errorMessage = `${errorMessage} - ${response.data}`
          } else if (response.data.message) {
            errorMessage = `${errorMessage} - ${response.data.message}`
          } else if (response.data.error) {
            errorMessage = `${errorMessage} - ${
              typeof response.data.error === 'string'
                ? response.data.error
                : JSON.stringify(response.data.error)
            }`
          }
        }

        // Include useful debugging information
        errorDetails = {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
        }
      }
      // Handle fetch or other network errors
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

        if (error.cause) {
          errorMessage = `${errorMessage} (${error.cause})`
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
 * Handle an internal/direct tool request
 */
async function handleInternalRequest(
  toolId: string,
  tool: ToolConfig,
  params: Record<string, any>
): Promise<ToolResponse> {
  // Format the request parameters
  const requestParams = formatRequestParams(tool, params)

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || ''
    // Handle the case where url may be a function or string
    const endpointUrl =
      typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

    const fullUrl = new URL(await endpointUrl, baseUrl).toString()

    // For custom tools, validate parameters on the client side before sending
    if (toolId.startsWith('custom_') && tool.request.body) {
      const requestBody = tool.request.body(params)
      if (requestBody.schema && requestBody.params) {
        try {
          validateClientSideParams(requestBody.params, requestBody.schema)
        } catch (validationError) {
          logger.error(`Custom tool params validation failed: ${validationError}`)
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

    if (!response.ok) {
      let errorData
      try {
        errorData = await response.json()
        logger.error(`Error response data: ${JSON.stringify(errorData)}`)
      } catch (e) {
        logger.error(`Failed to parse error response: ${e}`)
        throw new Error(response.statusText || `Request failed with status ${response.status}`)
      }

      // Extract error message from nested error objects (common in API responses)
      const errorMessage =
        typeof errorData.error === 'object'
          ? errorData.error.message || JSON.stringify(errorData.error)
          : errorData.error || `Request failed with status ${response.status}`

      throw new Error(errorMessage)
    }

    // Use the tool's response transformer if available
    if (tool.transformResponse) {
      try {
        const data = await tool.transformResponse(response, params)
        return data
      } catch (transformError) {
        logger.error(`Error in tool.transformResponse: ${transformError}`)
        throw transformError
      }
    }

    // Default response handling
    try {
      const data = await response.json()
      return {
        success: true,
        output: data.output || data,
        error: undefined,
      }
    } catch (jsonError) {
      logger.error(`Error parsing JSON response: ${jsonError}`)
      throw new Error(`Failed to parse response from ${toolId}: ${jsonError}`)
    }
  } catch (error: any) {
    logger.error(`Error executing internal tool ${toolId}:`, {
      error: error.stack || error.message || error,
    })

    // Use the tool's error transformer if available
    if (tool.transformError) {
      try {
        const errorResult = tool.transformError(error)

        // Handle both string and Promise return types
        if (typeof errorResult === 'string') {
          return {
            success: false,
            output: {},
            error: errorResult,
          }
        } else {
          // It's a Promise, await it
          const transformedError = await errorResult
          // If it's a string or has an error property, use it
          if (typeof transformedError === 'string') {
            return {
              success: false,
              output: {},
              error: transformedError,
            }
          } else if (transformedError && typeof transformedError === 'object') {
            // If it's already a ToolResponse, return it directly
            if ('success' in transformedError) {
              return transformedError
            }
            // If it has an error property, use it
            if ('error' in transformedError) {
              return {
                success: false,
                output: {},
                error: transformedError.error,
              }
            }
          }
          // Fallback
          return {
            success: false,
            output: {},
            error: 'Unknown error',
          }
        }
      } catch (transformError) {
        logger.error(`Error transforming error for tool ${toolId}:`, {
          transformError,
        })
        return {
          success: false,
          output: {},
          error: error.message || 'Unknown error',
        }
      }
    }

    return {
      success: false,
      output: {},
      error: error.message || 'Request failed',
    }
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
  const internalParamSet = new Set(['_context', 'workflowId'])

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
    } else if (type === 'number' && typeof paramValue !== 'number') {
      throw new Error(`Parameter ${paramName} should be a number`)
    } else if (type === 'boolean' && typeof paramValue !== 'boolean') {
      throw new Error(`Parameter ${paramName} should be a boolean`)
    } else if (type === 'array' && !Array.isArray(paramValue)) {
      throw new Error(`Parameter ${paramName} should be an array`)
    } else if (type === 'object' && (typeof paramValue !== 'object' || paramValue === null)) {
      throw new Error(`Parameter ${paramName} should be an object`)
    }
  }
}

/**
 * Handle a request via the proxy
 */
async function handleProxyRequest(
  toolId: string,
  params: Record<string, any>
): Promise<ToolResponse> {
  logger.info(`[handleProxyRequest] Entry: toolId=${toolId}`)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL environment variable is not set')
  }

  const proxyUrl = new URL('/api/proxy', baseUrl).toString()
  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, params }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = `HTTP error ${response.status}: ${response.statusText}`
      let errorDetails = { status: response.status, statusText: response.statusText }

      try {
        // Try to parse as JSON for more details
        const errorJson = JSON.parse(errorText)
        if (errorJson.error) {
          errorMessage =
            typeof errorJson.error === 'string'
              ? errorJson.error
              : `API Error: ${response.status} ${response.statusText}`
        }
        errorDetails = { ...errorDetails, ...errorJson }
      } catch {
        // If not JSON, use the raw text
        if (errorText && errorText !== 'undefined (undefined)') {
          errorMessage = `${errorMessage} - ${errorText}`
        }
      }

      return {
        success: false,
        output: errorDetails,
        error: errorMessage,
      }
    }

    const result = await response.json()

    if (!result.success) {
      return {
        success: false,
        output: result.output || {},
        error: result.error || `API request to ${toolId} failed with no error message`,
      }
    }

    return result
  } catch (error: any) {
    // Handle network or other fetch errors
    logger.error(`Error in proxy request for tool ${toolId}:`, { error })

    let errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : `Unknown error in API request to ${toolId}`

    return {
      success: false,
      output: { originalError: error },
      error: errorMessage,
    }
  }
}
