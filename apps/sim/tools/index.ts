import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { OAuthTokenPayload, ToolConfig, ToolResponse } from '@/tools/types'
import {
  formatRequestParams,
  getTool,
  getToolAsync,
  validateRequiredParametersAfterMerge,
} from '@/tools/utils'

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
          }
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
              logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
                error: error instanceof Error ? error.message : String(error),
              })
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
      } catch (error: any) {
        logger.warn(`[${requestId}] Direct execution failed for ${toolId}, falling back to API:`, {
          error: error instanceof Error ? error.message : String(error),
        })
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
          logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
            error: error instanceof Error ? error.message : String(error),
          })
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
        logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
          error: error instanceof Error ? error.message : String(error),
        })
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
    logger.error(`[${requestId}] Error executing tool ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })

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

    if (!response.ok) {
      let errorData
      try {
        errorData = await response.json()
        logger.error(`[${requestId}] Internal API error for ${toolId}:`, {
          status: response.status,
          errorData,
        })
      } catch (e) {
        logger.error(`[${requestId}] Failed to parse error response for ${toolId}:`, {
          status: response.status,
          statusText: response.statusText,
        })
        throw new Error(response.statusText || `Request failed with status ${response.status}`)
      }

      // Extract error message from nested error objects (common in API responses)
      // Prioritize detailed validation messages over generic error field
      const errorMessage =
        errorData.details?.[0]?.message ||
        (typeof errorData.error === 'object'
          ? errorData.error.message || JSON.stringify(errorData.error)
          : errorData.error) ||
        `Request failed with status ${response.status}`

      logger.error(`[${requestId}] Internal request error for ${toolId}:`, {
        error: errorMessage,
      })
      throw new Error(errorMessage)
    }

    // Use the tool's response transformer if available
    if (tool.transformResponse) {
      try {
        const data = await tool.transformResponse(response, params)
        return data
      } catch (transformError) {
        logger.error(`[${requestId}] Transform response error for ${toolId}:`, {
          error: transformError instanceof Error ? transformError.message : String(transformError),
        })
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
      logger.error(`[${requestId}] JSON parse error for ${toolId}:`, {
        error: jsonError instanceof Error ? jsonError.message : String(jsonError),
      })
      throw new Error(`Failed to parse response from ${toolId}: ${jsonError}`)
    }
  } catch (error: any) {
    logger.error(`[${requestId}] Internal request error for ${toolId}:`, {
      error: error instanceof Error ? error.message : String(error),
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
        }
        // It's a Promise, await it
        const transformedError = await errorResult
        // If it's a string or has an error property, use it
        if (typeof transformedError === 'string') {
          return {
            success: false,
            output: {},
            error: transformedError,
          }
        }
        if (transformedError && typeof transformedError === 'object') {
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
      } catch (transformError) {
        logger.error(`[${requestId}] Error transform failed for ${toolId}:`, {
          error: transformError instanceof Error ? transformError.message : String(transformError),
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
  params: Record<string, any>
): Promise<ToolResponse> {
  const requestId = crypto.randomUUID().slice(0, 8)

  const baseUrl = getBaseUrl()
  const proxyUrl = new URL('/api/proxy', baseUrl).toString()

  try {
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, params }),
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
        if (errorJson.error) {
          errorMessage =
            typeof errorJson.error === 'string'
              ? errorJson.error
              : `API Error: ${response.status} ${response.statusText}`
        }
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
