import type { ParameterVisibility, ToolConfig } from './types'
import { getTool } from './utils'

export interface ToolParameterConfig {
  id: string
  type: string
  required?: boolean // Required for tool execution
  visibility?: ParameterVisibility // Controls who can/must provide this parameter
  userProvided?: boolean // User filled this parameter
  description?: string
  default?: any
  // UI component information from block config
  uiComponent?: {
    type: string
    options?: any[]
    placeholder?: string
    password?: boolean
    condition?: any
    [key: string]: any
  }
}

export interface ToolWithParameters {
  toolConfig: ToolConfig
  allParameters: ToolParameterConfig[]
  userInputParameters: ToolParameterConfig[] // Parameters shown to user
  requiredParameters: ToolParameterConfig[] // Must be filled by user or LLM
  optionalParameters: ToolParameterConfig[] // Nice to have, shown to user
}

/**
 * Gets all parameters for a tool, categorized by their usage
 * Also includes UI component information from block configurations
 */
export function getToolParametersConfig(
  toolId: string,
  blockType?: string
): ToolWithParameters | null {
  const toolConfig = getTool(toolId)
  if (!toolConfig) {
    return null
  }

  // Get block configuration for UI component information
  let blockConfig: any = null
  if (blockType) {
    try {
      // Import blocks dynamically to avoid circular dependencies
      const { getAllBlocks } = require('../blocks')
      blockConfig = getAllBlocks().find((block: any) => block.type === blockType)
    } catch (error) {
      console.warn('Could not load block configuration:', error)
    }
  }

  // Convert tool params to our standard format with UI component info
  const allParameters: ToolParameterConfig[] = Object.entries(toolConfig.params).map(
    ([paramId, param]) => {
      const toolParam: ToolParameterConfig = {
        id: paramId,
        type: param.type,
        required: param.required ?? false,
        visibility: param.visibility ?? (param.required ? 'user-or-llm' : 'user-only'),
        description: param.description,
        default: param.default,
      }

      // Add UI component information from block config if available
      if (blockConfig) {
        // For multi-operation tools, find the subblock that matches both the parameter ID
        // and the current tool operation
        let subBlock = blockConfig.subBlocks?.find((sb: any) => {
          if (sb.id !== paramId) return false

          // If there's a condition, check if it matches the current tool
          if (sb.condition && sb.condition.field === 'operation') {
            // Extract operation from tool ID (e.g., 'google_docs_read' -> 'read')
            const operation = toolId.split('_').pop()
            return sb.condition.value === operation
          }

          // If no condition, it's a global parameter (like apiKey)
          return !sb.condition
        })

        // Fallback: if no operation-specific match, find any matching parameter
        if (!subBlock) {
          subBlock = blockConfig.subBlocks?.find((sb: any) => sb.id === paramId)
        }

        if (subBlock) {
          toolParam.uiComponent = {
            type: subBlock.type,
            options: subBlock.options,
            placeholder: subBlock.placeholder,
            password: subBlock.password,
            condition: subBlock.condition,
            title: subBlock.title,
            layout: subBlock.layout,
            value: subBlock.value,
            provider: subBlock.provider,
            serviceId: subBlock.serviceId,
            requiredScopes: subBlock.requiredScopes,
            mimeType: subBlock.mimeType,
            columns: subBlock.columns,
            min: subBlock.min,
            max: subBlock.max,
            step: subBlock.step,
            integer: subBlock.integer,
            language: subBlock.language,
            generationType: subBlock.generationType,
            acceptedTypes: subBlock.acceptedTypes,
            multiple: subBlock.multiple,
            maxSize: subBlock.maxSize,
          }
        }
      }

      return toolParam
    }
  )

  // Parameters that should be shown to the user for input
  const userInputParameters = allParameters.filter(
    (param) => param.visibility === 'user-or-llm' || param.visibility === 'user-only'
  )

  // Parameters that are required (must be filled by user or LLM)
  const requiredParameters = allParameters.filter((param) => param.required)

  // Parameters that are optional but can be provided by user
  const optionalParameters = allParameters.filter(
    (param) => param.visibility === 'user-only' && !param.required
  )

  return {
    toolConfig,
    allParameters,
    userInputParameters,
    requiredParameters,
    optionalParameters,
  }
}

/**
 * Creates a tool schema for LLM with user-provided parameters excluded
 */
export function createLLMToolSchema(
  toolConfig: ToolConfig,
  userProvidedParams: Record<string, any>
): any {
  const schema = {
    type: 'object',
    properties: {} as Record<string, any>,
    required: [] as string[],
  }

  // Only include parameters that the LLM should/can provide
  Object.entries(toolConfig.params).forEach(([paramId, param]) => {
    const isUserProvided =
      userProvidedParams[paramId] !== undefined &&
      userProvidedParams[paramId] !== null &&
      userProvidedParams[paramId] !== ''

    // Skip parameters that user has already provided
    if (isUserProvided) {
      return
    }

    // Skip parameters that are user-only (never shown to LLM)
    if (param.visibility === 'user-only') {
      return
    }

    // Skip hidden parameters
    if (param.visibility === 'hidden') {
      return
    }

    // Add parameter to LLM schema
    schema.properties[paramId] = {
      type: param.type === 'json' ? 'object' : param.type,
      description: param.description || '',
    }

    // Add to required if LLM must provide it and it's originally required
    if ((param.visibility === 'user-or-llm' || param.visibility === 'llm-only') && param.required) {
      schema.required.push(paramId)
    }
  })

  return schema
}

/**
 * Creates a complete tool schema for execution with all parameters
 */
export function createExecutionToolSchema(toolConfig: ToolConfig): any {
  const schema = {
    type: 'object',
    properties: {} as Record<string, any>,
    required: [] as string[],
  }

  Object.entries(toolConfig.params).forEach(([paramId, param]) => {
    schema.properties[paramId] = {
      type: param.type === 'json' ? 'object' : param.type,
      description: param.description || '',
    }

    if (param.required) {
      schema.required.push(paramId)
    }
  })

  return schema
}

/**
 * Merges user-provided parameters with LLM-generated parameters
 */
export function mergeToolParameters(
  userProvidedParams: Record<string, any>,
  llmGeneratedParams: Record<string, any>
): Record<string, any> {
  // User-provided parameters take precedence
  return {
    ...llmGeneratedParams,
    ...userProvidedParams,
  }
}

/**
 * Filters out user-provided parameters from tool schema for LLM
 */
export function filterSchemaForLLM(
  originalSchema: any,
  userProvidedParams: Record<string, any>
): any {
  if (!originalSchema || !originalSchema.properties) {
    return originalSchema
  }

  const filteredProperties = { ...originalSchema.properties }
  const filteredRequired = [...(originalSchema.required || [])]

  // Remove user-provided parameters from the schema
  Object.keys(userProvidedParams).forEach((paramKey) => {
    if (
      userProvidedParams[paramKey] !== undefined &&
      userProvidedParams[paramKey] !== null &&
      userProvidedParams[paramKey] !== ''
    ) {
      delete filteredProperties[paramKey]
      const reqIndex = filteredRequired.indexOf(paramKey)
      if (reqIndex > -1) {
        filteredRequired.splice(reqIndex, 1)
      }
    }
  })

  return {
    ...originalSchema,
    properties: filteredProperties,
    required: filteredRequired,
  }
}

/**
 * Validates that all required parameters are provided
 */
export function validateToolParameters(
  toolConfig: ToolConfig,
  finalParams: Record<string, any>
): { valid: boolean; missingParams: string[] } {
  const requiredParams = Object.entries(toolConfig.params)
    .filter(([_, param]) => param.required)
    .map(([paramId]) => paramId)

  const missingParams = requiredParams.filter(
    (paramId) =>
      finalParams[paramId] === undefined ||
      finalParams[paramId] === null ||
      finalParams[paramId] === ''
  )

  return {
    valid: missingParams.length === 0,
    missingParams,
  }
}

/**
 * Helper to check if a parameter should be treated as a password field
 */
export function isPasswordParameter(paramId: string): boolean {
  const passwordFields = [
    'password',
    'apiKey',
    'token',
    'secret',
    'key',
    'credential',
    'accessToken',
    'refreshToken',
    'botToken',
    'authToken',
  ]

  return passwordFields.some((field) => paramId.toLowerCase().includes(field.toLowerCase()))
}

/**
 * Formats parameter IDs into human-readable labels
 */
export function formatParameterLabel(paramId: string): string {
  // Special cases
  if (paramId === 'apiKey') return 'API Key'
  if (paramId === 'apiVersion') return 'API Version'
  if (paramId === 'accessToken') return 'Access Token'
  if (paramId === 'refreshToken') return 'Refresh Token'
  if (paramId === 'botToken') return 'Bot Token'

  // Handle underscore and hyphen separated words
  if (paramId.includes('_') || paramId.includes('-')) {
    return paramId
      .split(/[-_]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }

  // Handle single character parameters
  if (paramId.length === 1) return paramId.toUpperCase()

  // Handle camelCase
  if (/[A-Z]/.test(paramId)) {
    const result = paramId.replace(/([A-Z])/g, ' $1')
    return (
      result.charAt(0).toUpperCase() +
      result
        .slice(1)
        .replace(/ Api/g, ' API')
        .replace(/ Id/g, ' ID')
        .replace(/ Url/g, ' URL')
        .replace(/ Uri/g, ' URI')
        .replace(/ Ui/g, ' UI')
    )
  }

  // Simple case - just capitalize first letter
  return paramId.charAt(0).toUpperCase() + paramId.slice(1)
}
