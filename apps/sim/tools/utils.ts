import { createLogger } from '@sim/logger'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import type { CustomToolDefinition } from '@/hooks/queries/custom-tools'
import { environmentKeys } from '@/hooks/queries/environment'
import type { EnvironmentVariable } from '@/stores/settings/environment'
import { tools } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ToolsUtils')

/**
 * Strips version suffix (_v2, _v3, etc.) from a tool ID or name
 * @example stripVersionSuffix('notion_search_v2') => 'notion_search'
 * @example stripVersionSuffix('github_create_pr_v3') => 'github_create_pr'
 */
export function stripVersionSuffix(name: string): string {
  return name.replace(/_v\d+$/, '')
}

/**
 * Filters a tools map to return only the latest version of each tool.
 * If both `notion_search` and `notion_search_v2` exist, only `notion_search_v2` is returned.
 * @param toolsMap Record of tool ID to ToolConfig
 * @returns Filtered record containing only the latest version of each tool
 */
export function getLatestVersionTools(
  toolsMap: Record<string, ToolConfig>
): Record<string, ToolConfig> {
  const latestTools: Record<string, ToolConfig> = {}
  const baseNameToVersions: Record<string, { toolId: string; version: number }[]> = {}

  for (const toolId of Object.keys(toolsMap)) {
    const baseName = stripVersionSuffix(toolId)
    const versionMatch = toolId.match(/_v(\d+)$/)
    const version = versionMatch ? Number.parseInt(versionMatch[1], 10) : 1

    if (!baseNameToVersions[baseName]) {
      baseNameToVersions[baseName] = []
    }
    baseNameToVersions[baseName].push({ toolId, version })
  }

  for (const versions of Object.values(baseNameToVersions)) {
    const latest = versions.reduce((prev, curr) => (curr.version > prev.version ? curr : prev))
    latestTools[latest.toolId] = toolsMap[latest.toolId]
  }

  return latestTools
}

/**
 * Resolves a tool name to its actual tool ID in the registry.
 * Handles both stripped names (e.g., 'notion_search') and versioned names (e.g., 'notion_search_v2').
 * @param toolName The tool name to resolve (may or may not have version suffix)
 * @returns The actual tool ID in the registry, or the original name if not found
 */
export function resolveToolId(toolName: string): string {
  if (tools[toolName]) {
    return toolName
  }

  const latestTools = getLatestVersionTools(tools)
  for (const toolId of Object.keys(latestTools)) {
    if (stripVersionSuffix(toolId) === toolName) {
      return toolId
    }
  }

  return toolName
}

export interface RequestParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  timeout?: number
}

/**
 * Format request parameters based on tool configuration and provided params
 */
export function formatRequestParams(tool: ToolConfig, params: Record<string, any>): RequestParams {
  // Process URL
  const url = typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url

  // Process method
  const method =
    typeof tool.request.method === 'function'
      ? tool.request.method(params)
      : params.method || tool.request.method || 'GET'

  // Process headers
  const headers = tool.request.headers ? tool.request.headers(params) : {}

  // Process body
  const hasBody = method !== 'GET' && method !== 'HEAD' && !!tool.request.body
  const bodyResult = tool.request.body ? tool.request.body(params) : undefined

  // Special handling for NDJSON content type or 'application/x-www-form-urlencoded'
  const isPreformattedContent =
    headers['Content-Type'] === 'application/x-ndjson' ||
    headers['Content-Type'] === 'application/x-www-form-urlencoded'

  let body: string | undefined
  if (hasBody) {
    if (isPreformattedContent) {
      // Check if bodyResult is a string
      if (typeof bodyResult === 'string') {
        body = bodyResult
      }
      // Check if bodyResult is an object with a 'body' property (Twilio pattern)
      else if (bodyResult && typeof bodyResult === 'object' && 'body' in bodyResult) {
        body = bodyResult.body
      }
      // Otherwise JSON stringify it
      else {
        body = JSON.stringify(bodyResult)
      }
    } else {
      body = typeof bodyResult === 'string' ? bodyResult : JSON.stringify(bodyResult)
    }
  }

  const MAX_TIMEOUT_MS = getMaxExecutionTimeout()
  const rawTimeout = params.timeout
  const timeout = rawTimeout != null ? Number(rawTimeout) : undefined
  const validTimeout =
    timeout != null && Number.isFinite(timeout) && timeout > 0
      ? Math.min(timeout, MAX_TIMEOUT_MS)
      : undefined

  return { url, method, headers, body, timeout: validTimeout }
}

/**
 * Formats a parameter name for user-friendly error messages
 * Converts parameter names and descriptions to more readable format
 */
function formatParameterNameForError(paramName: string): string {
  // Split camelCase and snake_case/kebab-case into words, then capitalize first letter of each word
  return paramName
    .split(/(?=[A-Z])|[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Validates required parameters after LLM and user params have been merged
 * This is the final validation before tool execution - ensures all required
 * user-or-llm parameters are present after the merge process
 */
export function validateRequiredParametersAfterMerge(
  toolId: string,
  tool: ToolConfig | undefined,
  params: Record<string, any>,
  parameterNameMap?: Record<string, string>
): void {
  if (!tool) {
    throw new Error(`Tool not found: ${toolId}`)
  }

  // Validate all required user-or-llm parameters after merge
  // user-only parameters should have been validated earlier during serialization
  for (const [paramName, paramConfig] of Object.entries(tool.params)) {
    if (
      (paramConfig as any).visibility === 'user-or-llm' &&
      paramConfig.required &&
      (!(paramName in params) ||
        params[paramName] === null ||
        params[paramName] === undefined ||
        params[paramName] === '')
    ) {
      // Create a more user-friendly error message
      const toolName = tool.name || toolId
      const friendlyParamName =
        parameterNameMap?.[paramName] || formatParameterNameForError(paramName)
      throw new Error(`${friendlyParamName} is required for ${toolName}`)
    }
  }
}

/**
 * Creates parameter schema from custom tool schema
 */
export function createParamSchema(customTool: any): Record<string, any> {
  const params: Record<string, any> = {}

  if (customTool.schema.function?.parameters?.properties) {
    const properties = customTool.schema.function.parameters.properties
    const required = customTool.schema.function.parameters.required || []

    Object.entries(properties).forEach(([key, config]: [string, any]) => {
      const isRequired = required.includes(key)

      // Create the base parameter configuration
      const paramConfig: Record<string, any> = {
        type: config.type || 'string',
        required: isRequired,
        description: config.description || '',
      }

      // Set visibility based on whether it's required
      if (isRequired) {
        paramConfig.visibility = 'user-or-llm'
      } else {
        paramConfig.visibility = 'user-only'
      }

      params[key] = paramConfig
    })
  }

  return params
}

/**
 * Get environment variables from React Query cache (client-side only)
 */
export function getClientEnvVars(): Record<string, string> {
  if (typeof window === 'undefined') return {}

  try {
    const allEnvVars =
      getQueryClient().getQueryData<Record<string, EnvironmentVariable>>(
        environmentKeys.personal()
      ) ?? {}

    // Convert environment variables to a simple key-value object
    return Object.entries(allEnvVars).reduce(
      (acc, [key, variable]) => {
        acc[key] = variable.value
        return acc
      },
      {} as Record<string, string>
    )
  } catch (_error) {
    // In case of any errors (like in testing), return empty object
    return {}
  }
}

/**
 * Creates the request body configuration for custom tools
 * @param customTool The custom tool configuration
 * @param isClient Whether running on client side
 * @param workflowId Optional workflow ID for server-side
 */
export function createCustomToolRequestBody(customTool: any, isClient = true, workflowId?: string) {
  return (params: Record<string, any>) => {
    // Get environment variables - try multiple sources in order of preference:
    // 1. envVars parameter (passed from provider/agent context)
    // 2. Client-side store (if running in browser)
    // 3. Empty object (fallback)
    const envVars = params.envVars || (isClient ? getClientEnvVars() : {})

    // Get workflow variables from params (passed from execution context)
    const workflowVariables = params.workflowVariables || {}

    // Get block data and mapping from params (passed from execution context)
    const blockData = params.blockData || {}
    const blockNameMapping = params.blockNameMapping || {}

    // Include everything needed for execution
    return {
      code: customTool.code,
      params: params, // These will be available in the VM context
      schema: customTool.schema.function.parameters, // For validation
      envVars: envVars, // Environment variables
      workflowVariables: workflowVariables, // Workflow variables for <variable.name> resolution
      blockData: blockData, // Runtime block outputs for <block.field> resolution
      blockNameMapping: blockNameMapping, // Block name to ID mapping
      workflowId: params._context?.workflowId || workflowId, // Pass workflowId for server-side context
      userId: params._context?.userId, // Pass userId for auth context
      isCustomTool: true, // Flag to indicate this is a custom tool execution
    }
  }
}

// Get a tool by its ID
export function getTool(toolId: string, _workspaceId?: string): ToolConfig | undefined {
  // Check for built-in tools
  const builtInTool = tools[toolId]
  if (builtInTool) return builtInTool

  // If not found or running on the server, return undefined
  return undefined
}

// Helper function to create a tool config from a custom tool
export function createToolConfig(
  customTool: CustomToolDefinition,
  customToolId: string
): ToolConfig {
  // Create a parameter schema from the custom tool schema
  const params = createParamSchema(customTool)

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
      body: createCustomToolRequestBody(customTool, true),
    },

    // Standard response handling for custom tools
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
  }
}
