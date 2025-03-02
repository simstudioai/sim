import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { visionTool as crewAIVision } from './crewai/vision'
import { scrapeTool } from './firecrawl/scrape'
import { functionExecuteTool as functionExecute } from './function/execute'
import { webcontainerExecuteTool as webcontainerExecute } from './function/webcontainer'
import { commentTool } from './github/comment'
import { prTool } from './github/pr'
import { repoInfoTool } from './github/repo'
import { gmailReadTool } from './gmail/read'
import { gmailSearchTool } from './gmail/search'
import { gmailSendTool } from './gmail/send'
import { requestTool as httpRequest } from './http/request'
import { contactsTool as hubspotContacts } from './hubspot/contacts'
import { readUrlTool } from './jina/reader'
import { notionReadTool } from './notion/read'
import { notionWriteTool } from './notion/write'
import { embeddingsTool as openAIEmbeddings } from './openai/embeddings'
import { fetchTool as pineconeFetchTool } from './pinecone/fetch'
import { generateEmbeddingsTool as pineconeGenerateEmbeddingsTool } from './pinecone/generate'
import { searchTextTool as pineconeSearchTextTool } from './pinecone/searchText'
import { searchVectorTool as pineconeSearchVectorTool } from './pinecone/searchVector'
import { upsertTextTool as pineconeUpsertTextTool } from './pinecone/upsertText'
import { opportunitiesTool as salesforceOpportunities } from './salesforce/opportunities'
import { searchTool as serperSearch } from './serper/search'
import { slackMessageTool } from './slack/message'
import { extractTool as tavilyExtract } from './tavily/extract'
import { searchTool as tavilySearch } from './tavily/search'
import { ToolConfig, ToolResponse } from './types'
import { executeRequest, formatRequestParams, validateToolRequest } from './utils'
import { readTool as xRead } from './x/read'
import { searchTool as xSearch } from './x/search'
import { userTool as xUser } from './x/user'
import { writeTool as xWrite } from './x/write'
import { youtubeSearchTool } from './youtube/search'

// Registry of all available tools
export const tools: Record<string, ToolConfig> = {
  openai_embeddings: openAIEmbeddings,
  http_request: httpRequest,
  hubspot_contacts: hubspotContacts,
  salesforce_opportunities: salesforceOpportunities,
  function_execute: functionExecute,
  webcontainer_execute: webcontainerExecute,
  crewai_vision: crewAIVision,
  firecrawl_scrape: scrapeTool,
  jina_readurl: readUrlTool,
  slack_message: slackMessageTool,
  github_repoinfo: repoInfoTool,
  serper_search: serperSearch,
  tavily_search: tavilySearch,
  tavily_extract: tavilyExtract,
  youtube_search: youtubeSearchTool,
  notion_read: notionReadTool,
  notion_write: notionWriteTool,
  gmail_send: gmailSendTool,
  gmail_read: gmailReadTool,
  gmail_search: gmailSearchTool,
  x_write: xWrite,
  x_read: xRead,
  x_search: xSearch,
  x_user: xUser,
  pinecone_fetch: pineconeFetchTool,
  pinecone_generate_embeddings: pineconeGenerateEmbeddingsTool,
  pinecone_search_text: pineconeSearchTextTool,
  pinecone_search_vector: pineconeSearchVectorTool,
  pinecone_upsert_text: pineconeUpsertTextTool,
  github_pr: prTool,
  github_comment: commentTool,
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
    console.error(`Custom tool not found: ${identifier}`)
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
      url: '/api/execute',
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
          console.warn('WebContainer execution failed, falling back to API:', error.message)
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
    transformError: (error: any) =>
      `Custom tool execution error: ${error.message || 'Unknown error'}`,
  }
}

// Execute a tool by calling either the proxy for external APIs or directly for internal routes
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  skipProxy = false
): Promise<ToolResponse> {
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
        return directResult
      }
      // If directExecution returns undefined, fall back to API route
    }

    // For internal routes or when skipProxy is true, call the API directly
    if (tool.request.isInternalRoute || skipProxy) {
      const result = await handleInternalRequest(toolId, tool, params)
      return result
    }

    // For external APIs, use the proxy
    return await handleProxyRequest(toolId, params)
  } catch (error: any) {
    console.error(`Error executing tool ${toolId}:`, error)

    // For custom tools, provide more helpful error information
    if (toolId.startsWith('custom_')) {
      const identifier = toolId.replace('custom_', '')
      const allTools = useCustomToolsStore.getState().getAllTools()
      const availableTools = allTools.map((t) => ({ id: t.id, title: t.title }))

      console.error('Available custom tools:', availableTools)
      console.error(`Looking for custom tool with identifier: ${identifier}`)
    }

    return {
      success: false,
      output: {},
      error: error.message || 'Unknown error',
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
      } catch (e) {
        errorData = { error: response.statusText }
      }

      throw new Error(errorData.error || `Request failed with status ${response.status}`)
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
    // Use the tool's error transformer if available
    if (tool.transformError) {
      return {
        success: false,
        output: {},
        error: tool.transformError(error),
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
  schema: { type: string; properties: Record<string, any>; required?: string[] }
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

  const proxyUrl = new URL('/api/proxy', baseUrl).toString()
  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolId, params }),
  })

  const result = await response.json()

  if (!result.success) {
    return {
      success: false,
      output: {},
      error: result.error,
    }
  }

  return result
}
