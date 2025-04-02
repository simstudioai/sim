import { createLogger } from '@/lib/logs/console-logger'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { airtableReadTool, airtableUpdateTool, airtableWriteTool } from './airtable'
import { confluenceListTool, confluenceRetrieveTool, confluenceUpdateTool } from './confluence'
import { docsCreateTool, docsReadTool, docsWriteTool } from './docs'
import { driveDownloadTool, driveListTool, driveUploadTool } from './drive'
import { exaAnswerTool, exaFindSimilarLinksTool, exaGetContentsTool, exaSearchTool } from './exa'
import { fileParseTool } from './file'
import { scrapeTool } from './firecrawl/scrape'
import { functionExecuteTool, webcontainerExecuteTool } from './function'
import {
  githubCommentTool,
  githubLatestCommitTool,
  githubPrTool,
  githubRepoInfoTool,
} from './github'
import { gmailReadTool, gmailSearchTool, gmailSendTool } from './gmail'
import { guestyGuestTool, guestyReservationTool } from './guesty'
import { requestTool as httpRequest } from './http/request'
import { contactsTool as hubspotContacts } from './hubspot/contacts'
import { readUrlTool } from './jina/reader'
import { notionReadTool, notionWriteTool } from './notion'
import { dalleTool } from './openai/dalle'
import { embeddingsTool as openAIEmbeddings } from './openai/embeddings'
import { perplexityChatTool } from './perplexity'
import {
  pineconeFetchTool,
  pineconeGenerateEmbeddingsTool,
  pineconeSearchTextTool,
  pineconeSearchVectorTool,
  pineconeUpsertTextTool,
} from './pinecone'
import { redditHotPostsTool } from './reddit'
import { opportunitiesTool as salesforceOpportunities } from './salesforce/opportunities'
import { searchTool as serperSearch } from './serper/search'
import { sheetsReadTool, sheetsUpdateTool, sheetsWriteTool } from './sheets'
import { slackMessageTool } from './slack/message'
import { supabaseInsertTool, supabaseQueryTool, supabaseUpdateTool } from './supabase'
import { tavilyExtractTool, tavilySearchTool } from './tavily'
import { sendSMSTool } from './twilio/send'
import { typeformFilesTool, typeformInsightsTool, typeformResponsesTool } from './typeform'
import { OAuthTokenPayload, ToolConfig, ToolResponse } from './types'
import { formatRequestParams, validateToolRequest } from './utils'
import { visionTool } from './vision/vision'
import { whatsappSendMessageTool } from './whatsapp'
import { xReadTool, xSearchTool, xUserTool, xWriteTool } from './x'
import { youtubeSearchTool } from './youtube/search'

const logger = createLogger('Tools')

// Registry of all available tools
export const tools: Record<string, ToolConfig> = {
  openai_embeddings: openAIEmbeddings,
  http_request: httpRequest,
  hubspot_contacts: hubspotContacts,
  salesforce_opportunities: salesforceOpportunities,
  function_execute: functionExecuteTool,
  webcontainer_execute: webcontainerExecuteTool,
  vision_tool: visionTool,
  file_parser: fileParseTool,
  firecrawl_scrape: scrapeTool,
  jina_readurl: readUrlTool,
  slack_message: slackMessageTool,
  github_repoinfo: githubRepoInfoTool,
  github_latest_commit: githubLatestCommitTool,
  serper_search: serperSearch,
  tavily_search: tavilySearchTool,
  tavily_extract: tavilyExtractTool,
  supabase_query: supabaseQueryTool,
  supabase_insert: supabaseInsertTool,
  supabase_update: supabaseUpdateTool,
  typeform_responses: typeformResponsesTool,
  typeform_files: typeformFilesTool,
  typeform_insights: typeformInsightsTool,
  youtube_search: youtubeSearchTool,
  notion_read: notionReadTool,
  notion_write: notionWriteTool,
  gmail_send: gmailSendTool,
  gmail_read: gmailReadTool,
  gmail_search: gmailSearchTool,
  whatsapp_send_message: whatsappSendMessageTool,
  x_write: xWriteTool,
  x_read: xReadTool,
  x_search: xSearchTool,
  x_user: xUserTool,
  pinecone_fetch: pineconeFetchTool,
  pinecone_generate_embeddings: pineconeGenerateEmbeddingsTool,
  pinecone_search_text: pineconeSearchTextTool,
  pinecone_search_vector: pineconeSearchVectorTool,
  pinecone_upsert_text: pineconeUpsertTextTool,
  github_pr: githubPrTool,
  github_comment: githubCommentTool,
  exa_search: exaSearchTool,
  exa_get_contents: exaGetContentsTool,
  exa_find_similar_links: exaFindSimilarLinksTool,
  exa_answer: exaAnswerTool,
  reddit_hot_posts: redditHotPostsTool,
  google_drive_download: driveDownloadTool,
  google_drive_list: driveListTool,
  google_drive_upload: driveUploadTool,
  google_docs_read: docsReadTool,
  google_docs_write: docsWriteTool,
  google_docs_create: docsCreateTool,
  google_sheets_read: sheetsReadTool,
  google_sheets_write: sheetsWriteTool,
  google_sheets_update: sheetsUpdateTool,
  guesty_reservation: guestyReservationTool,
  guesty_guest: guestyGuestTool,
  perplexity_chat: perplexityChatTool,
  confluence_retrieve: confluenceRetrieveTool,
  confluence_list: confluenceListTool,
  confluence_update: confluenceUpdateTool,
  twilio_send_sms: sendSMSTool,
  dalle_generate: dalleTool,
  airtable_read: airtableReadTool,
  airtable_write: airtableWriteTool,
  airtable_update: airtableUpdateTool,
}

// Get a tool by its ID
export function getTool(toolId: string): ToolConfig | undefined {
  // Check for built-in tools
  const builtInTool = tools[toolId]
  if (builtInTool) return builtInTool

  // Check if it's a custom tool
  if (toolId.startsWith('custom_')) {
    return getCustomTool(toolId)
  }

  return undefined
}

// Check if we're running in the browser
function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

// Check if WebContainer is available
function isWebContainerAvailable(): boolean {
  return isBrowser() && !!window.crossOriginIsolated
}

// Create a tool config from a custom tool definition
function getCustomTool(customToolId: string): ToolConfig | undefined {
  // Extract the identifier part (could be UUID or title)
  const identifier = customToolId.replace('custom_', '')

  const customToolsStore = useCustomToolsStore.getState()

  // Try to find the tool directly by ID first
  let customTool = customToolsStore.getTool(identifier)

  // If not found by ID, try to find by title (for backward compatibility)
  if (!customTool) {
    const allTools = customToolsStore.getAllTools()
    customTool = allTools.find((tool) => tool.title === identifier)
  }

  if (!customTool) {
    logger.error(`Custom tool not found: ${identifier}`)
    return undefined
  }

  // Create a parameter schema from the custom tool schema
  const params: Record<string, any> = {}

  if (customTool.schema.function?.parameters?.properties) {
    Object.entries(customTool.schema.function.parameters.properties).forEach(([key, config]) => {
      params[key] = {
        type: config.type || 'string',
        required: customTool.schema.function.parameters.required?.includes(key) || false,
        requiredForToolCall: customTool.schema.function.parameters.required?.includes(key) || false,
        description: config.description || '',
      }
    })
  }

  // Create a tool config for the custom tool
  return {
    id: customToolId,
    name: customTool.title,
    description: customTool.schema.function?.description || '',
    version: '1.0.0',
    params,

    // Request configuration - for custom tools we'll use the execute endpoint
    request: {
      url: '/api/function/execute',
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params: Record<string, any>) => {
        // Get environment variables from the store
        const envStore = useEnvironmentStore.getState()
        const allEnvVars = envStore.getAllVariables()

        // Convert environment variables to a simple key-value object
        const envVars = Object.entries(allEnvVars).reduce(
          (acc, [key, variable]) => {
            acc[key] = variable.value
            return acc
          },
          {} as Record<string, string>
        )

        // Include everything needed for execution
        return {
          code: customTool.code,
          params: params, // These will be available in the VM context
          schema: customTool.schema.function.parameters, // For validation on the client side
          envVars: envVars, // Pass environment variables for server-side resolution
        }
      },
      isInternalRoute: true,
    },

    // Direct execution support for browser environment with WebContainer
    directExecution: async (params: Record<string, any>) => {
      // If there's no code, we can't execute directly
      if (!customTool.code) {
        return {
          success: false,
          output: {},
          error: 'No code provided for tool execution',
        }
      }

      // If we're in a browser with WebContainer available, use it
      if (isWebContainerAvailable()) {
        try {
          // Get environment variables from the store
          const envStore = useEnvironmentStore.getState()
          const envVars = envStore.getAllVariables()

          // Create a merged params object that includes environment variables
          const mergedParams = { ...params }

          // Add environment variables to the params
          Object.entries(envVars).forEach(([key, variable]) => {
            if (variable.value && !mergedParams[key]) {
              mergedParams[key] = variable.value
            }
          })

          // Resolve environment variables and tags in the code
          let resolvedCode = customTool.code

          // Resolve environment variables with {{var_name}} syntax
          const envVarMatches = resolvedCode.match(/\{\{([^}]+)\}\}/g) || []
          for (const match of envVarMatches) {
            const varName = match.slice(2, -2).trim()
            // Look for the variable in our environment store first, then in params
            const envVar = envVars[varName]
            const varValue = envVar ? envVar.value : mergedParams[varName] || ''
            resolvedCode = resolvedCode.replace(match, varValue)
          }

          // Resolve tags with <tag_name> syntax
          const tagMatches = resolvedCode.match(/<([^>]+)>/g) || []
          for (const match of tagMatches) {
            const tagName = match.slice(1, -1).trim()
            const tagValue = mergedParams[tagName] || ''
            resolvedCode = resolvedCode.replace(match, tagValue)
          }

          // Dynamically import the executeCode function
          const { executeCode } = await import('@/lib/webcontainer')

          // Execute the code with resolved variables
          const result = await executeCode(
            resolvedCode,
            mergedParams, // Use the merged params that include env vars
            5000 // Default timeout
          )

          if (!result.success) {
            throw new Error(result.error || 'WebContainer execution failed')
          }

          return {
            success: true,
            output: result.output.result || result.output,
            error: undefined,
          }
        } catch (error: any) {
          logger.warn('WebContainer execution failed, falling back to API:', error.message)
          // Fall back to API route if WebContainer fails
          return undefined
        }
      }

      // No WebContainer or not in browser, return undefined to use regular API route
      return undefined
    },

    // Response handling
    transformResponse: async (response: Response) => {
      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Custom tool execution failed')
      }

      return {
        success: true,
        output: data.output.result || data.output,
        error: undefined,
      }
    },
    transformError: async (error: any) =>
      `Custom tool execution error: ${error.message || 'Unknown error'}`,
  }
}

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
    const tool = getTool(toolId)

    // Validate the tool and its parameters
    validateToolRequest(toolId, tool, params)

    // After validation, we know tool exists
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    // For custom tools, try direct execution in browser first if available
    if (toolId.startsWith('custom_') && tool.directExecution) {
      const directResult = await tool.directExecution(params)
      if (directResult) {
        // Add timing data to the result
        const endTime = new Date()
        const endTimeISO = endTime.toISOString()
        const duration = endTime.getTime() - startTime.getTime()
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
    }

    // For internal routes or when skipProxy is true, call the API directly
    if (tool.request.isInternalRoute || skipProxy) {
      const result = await handleInternalRequest(toolId, tool, params)

      // Apply post-processing if available and not skipped
      if (tool.postProcess && result.success && !skipPostProcess) {
        try {
          const postProcessResult = await tool.postProcess(result, params, executeTool)

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
    const result = await handleProxyRequest(toolId, params)

    // Apply post-processing if available and not skipped
    if (tool.postProcess && result.success && !skipPostProcess) {
      try {
        const postProcessResult = await tool.postProcess(result, params, executeTool)

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

    // For custom tools, provide more helpful error information
    if (toolId.startsWith('custom_')) {
      const identifier = toolId.replace('custom_', '')
      const allTools = useCustomToolsStore.getState().getAllTools()
      const availableTools = allTools.map((t) => ({
        id: t.id,
        title: t.title,
      }))

      logger.error('Available custom tools:', availableTools)
      logger.error(`Looking for custom tool with identifier: ${identifier}`)
    }

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

    const fullUrl = new URL(endpointUrl, baseUrl).toString()

    // For custom tools, validate parameters on the client side before sending
    if (toolId.startsWith('custom_') && tool.request.body) {
      const requestBody = tool.request.body(params)
      if (requestBody.schema && requestBody.params) {
        validateClientSideParams(requestBody.params, requestBody.schema)
      }
    }

    const response = await fetch(fullUrl, {
      method: requestParams.method,
      headers: requestParams.headers,
      body: requestParams.body,
    })

    if (!response.ok) {
      let errorData
      try {
        errorData = await response.json()
      } catch {
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
      return await tool.transformResponse(response)
    }

    // Default response handling
    const data = await response.json()
    return {
      success: true,
      output: data.output || data,
      error: undefined,
    }
  } catch (error: any) {
    logger.error(`Error executing internal tool ${toolId}:`, { error })

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
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!baseUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL environment variable is not set')
  }

  // If we have a credential parameter, fetch the access token
  if (params.credential) {
    try {
      const isServerSide = typeof window === 'undefined'

      // Prepare the token payload
      const tokenPayload: OAuthTokenPayload = {
        credentialId: params.credential,
      }

      // Add workflowId if it exists in params or context
      if (isServerSide) {
        // Try to get workflowId from params or context
        const workflowId = params.workflowId || params._context?.workflowId
        if (workflowId) {
          tokenPayload.workflowId = workflowId
        }
      }

      const response = await fetch(`${baseUrl}/api/auth/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokenPayload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Token fetch failed:', response.status, errorText)
        throw new Error(`Failed to fetch access token: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      params.accessToken = data.accessToken

      // Clean up params we don't need to pass to the actual tool
      delete params.credential
      if (params.workflowId) delete params.workflowId
    } catch (error) {
      logger.error('Error fetching access token:', { error })
      throw error
    }
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
