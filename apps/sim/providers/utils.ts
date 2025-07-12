import { getCostMultiplier, isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { anthropicProvider } from './anthropic'
import { azureOpenAIProvider } from './azure-openai'
import { cerebrasProvider } from './cerebras'
import { deepseekProvider } from './deepseek'
import { googleProvider } from './google'
import { groqProvider } from './groq'
import {
  getComputerUseModels,
  getEmbeddingModelPricing,
  getHostedModels as getHostedModelsFromDefinitions,
  getMaxTemperature as getMaxTempFromDefinitions,
  getModelPricing as getModelPricingFromDefinitions,
  getModelsWithTemperatureSupport,
  getModelsWithTempRange01,
  getModelsWithTempRange02,
  getProviderModels as getProviderModelsFromDefinitions,
  getProvidersWithToolUsageControl,
  PROVIDER_DEFINITIONS,
  supportsTemperature as supportsTemperatureFromDefinitions,
  supportsToolUsageControl as supportsToolUsageControlFromDefinitions,
  updateOllamaModels as updateOllamaModelsInDefinitions,
} from './models'
import { ollamaProvider } from './ollama'
import { openaiProvider } from './openai'
import type { ProviderConfig, ProviderId, ProviderToolConfig } from './types'
import { xAIProvider } from './xai'

const logger = createLogger('ProviderUtils')

/**
 * Provider configurations - built from the comprehensive definitions
 */
export const providers: Record<
  ProviderId,
  ProviderConfig & {
    models: string[]
    computerUseModels?: string[]
    modelPatterns?: RegExp[]
  }
> = {
  openai: {
    ...openaiProvider,
    models: getProviderModelsFromDefinitions('openai'),
    computerUseModels: ['computer-use-preview'],
    modelPatterns: PROVIDER_DEFINITIONS.openai.modelPatterns,
  },
  anthropic: {
    ...anthropicProvider,
    models: getProviderModelsFromDefinitions('anthropic'),
    computerUseModels: getComputerUseModels().filter((model) =>
      getProviderModelsFromDefinitions('anthropic').includes(model)
    ),
    modelPatterns: PROVIDER_DEFINITIONS.anthropic.modelPatterns,
  },
  google: {
    ...googleProvider,
    models: getProviderModelsFromDefinitions('google'),
    modelPatterns: PROVIDER_DEFINITIONS.google.modelPatterns,
  },
  deepseek: {
    ...deepseekProvider,
    models: getProviderModelsFromDefinitions('deepseek'),
    modelPatterns: PROVIDER_DEFINITIONS.deepseek.modelPatterns,
  },
  xai: {
    ...xAIProvider,
    models: getProviderModelsFromDefinitions('xai'),
    modelPatterns: PROVIDER_DEFINITIONS.xai.modelPatterns,
  },
  cerebras: {
    ...cerebrasProvider,
    models: getProviderModelsFromDefinitions('cerebras'),
    modelPatterns: PROVIDER_DEFINITIONS.cerebras.modelPatterns,
  },
  groq: {
    ...groqProvider,
    models: getProviderModelsFromDefinitions('groq'),
    modelPatterns: PROVIDER_DEFINITIONS.groq.modelPatterns,
  },
  'azure-openai': {
    ...azureOpenAIProvider,
    models: getProviderModelsFromDefinitions('azure-openai'),
    modelPatterns: PROVIDER_DEFINITIONS['azure-openai'].modelPatterns,
  },
  ollama: {
    ...ollamaProvider,
    models: getProviderModelsFromDefinitions('ollama'),
    modelPatterns: PROVIDER_DEFINITIONS.ollama.modelPatterns,
  },
}

// Initialize all providers that have initialize method
Object.entries(providers).forEach(([id, provider]) => {
  if (provider.initialize) {
    provider.initialize().catch((error) => {
      logger.error(`Failed to initialize ${id} provider`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  }
})

// Function to update Ollama provider models
export function updateOllamaProviderModels(models: string[]): void {
  updateOllamaModelsInDefinitions(models)
  providers.ollama.models = getProviderModelsFromDefinitions('ollama')
  logger.info('Updated Ollama provider models', { models })
}

export function getBaseModelProviders(): Record<string, ProviderId> {
  return Object.entries(providers)
    .filter(([providerId]) => providerId !== 'ollama')
    .reduce(
      (map, [providerId, config]) => {
        config.models.forEach((model) => {
          map[model.toLowerCase()] = providerId as ProviderId
        })
        return map
      },
      {} as Record<string, ProviderId>
    )
}

export function getAllModelProviders(): Record<string, ProviderId> {
  return Object.entries(providers).reduce(
    (map, [providerId, config]) => {
      config.models.forEach((model) => {
        map[model.toLowerCase()] = providerId as ProviderId
      })
      return map
    },
    {} as Record<string, ProviderId>
  )
}

export function getProviderFromModel(model: string): ProviderId {
  const normalizedModel = model.toLowerCase()
  if (normalizedModel in getAllModelProviders()) {
    return getAllModelProviders()[normalizedModel]
  }

  for (const [providerId, config] of Object.entries(providers)) {
    if (config.modelPatterns) {
      for (const pattern of config.modelPatterns) {
        if (pattern.test(normalizedModel)) {
          return providerId as ProviderId
        }
      }
    }
  }

  logger.warn(`No provider found for model: ${model}, defaulting to ollama`)
  return 'ollama'
}

export function getProvider(id: string): ProviderConfig | undefined {
  // Handle both formats: 'openai' and 'openai/chat'
  const providerId = id.split('/')[0] as ProviderId
  return providers[providerId]
}

export function getProviderConfigFromModel(model: string): ProviderConfig | undefined {
  const providerId = getProviderFromModel(model)
  return providers[providerId]
}

export function getAllModels(): string[] {
  return Object.values(providers).flatMap((provider) => provider.models || [])
}

export function getAllProviderIds(): ProviderId[] {
  return Object.keys(providers) as ProviderId[]
}

export function getProviderModels(providerId: ProviderId): string[] {
  return getProviderModelsFromDefinitions(providerId)
}

/**
 * Get provider icon for a given model
 */
export function getProviderIcon(model: string): React.ComponentType<{ className?: string }> | null {
  const providerId = getProviderFromModel(model)
  return PROVIDER_DEFINITIONS[providerId]?.icon || null
}

export function generateStructuredOutputInstructions(responseFormat: any): string {
  // Handle null/undefined input
  if (!responseFormat) return ''

  // If using the new JSON Schema format, don't add additional instructions
  // This is necessary because providers now handle the schema directly
  if (responseFormat.schema || (responseFormat.type === 'object' && responseFormat.properties)) {
    return ''
  }

  // Handle legacy format with fields array
  if (!responseFormat.fields) return ''

  function generateFieldStructure(field: any): string {
    if (field.type === 'object' && field.properties) {
      return `{
    ${Object.entries(field.properties)
      .map(([key, prop]: [string, any]) => `"${key}": ${prop.type === 'number' ? '0' : '"value"'}`)
      .join(',\n    ')}
  }`
    }
    return field.type === 'string'
      ? '"value"'
      : field.type === 'number'
        ? '0'
        : field.type === 'boolean'
          ? 'true/false'
          : '[]'
  }

  const exampleFormat = responseFormat.fields
    .map((field: any) => `  "${field.name}": ${generateFieldStructure(field)}`)
    .join(',\n')

  const fieldDescriptions = responseFormat.fields
    .map((field: any) => {
      let desc = `${field.name} (${field.type})`
      if (field.description) desc += `: ${field.description}`
      if (field.type === 'object' && field.properties) {
        desc += '\nProperties:'
        Object.entries(field.properties).forEach(([key, prop]: [string, any]) => {
          desc += `\n  - ${key} (${(prop as any).type}): ${(prop as any).description || ''}`
        })
      }
      return desc
    })
    .join('\n')

  logger.info(`Generated structured output instructions for ${responseFormat.fields.length} fields`)

  return `
Please provide your response in the following JSON format:
{
${exampleFormat}
}

Field descriptions:
${fieldDescriptions}

Your response MUST be valid JSON and include all the specified fields with their correct types.
Each metric should be an object containing 'score' (number) and 'reasoning' (string).`
}

export function extractAndParseJSON(content: string): any {
  // First clean up the string
  const trimmed = content.trim()

  // Find the first '{' and last '}'
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in content')
  }

  // Extract just the JSON part
  const jsonStr = trimmed.slice(firstBrace, lastBrace + 1)

  try {
    return JSON.parse(jsonStr)
  } catch (_error) {
    // If parsing fails, try to clean up common issues
    const cleaned = jsonStr
      .replace(/\n/g, ' ') // Remove newlines
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas

    try {
      return JSON.parse(cleaned)
    } catch (innerError) {
      logger.error('Failed to parse JSON response', {
        contentLength: content.length,
        extractedLength: jsonStr.length,
        cleanedLength: cleaned.length,
        error: innerError instanceof Error ? innerError.message : 'Unknown error',
      })

      throw new Error(
        `Failed to parse JSON after cleanup: ${innerError instanceof Error ? innerError.message : 'Unknown error'}`
      )
    }
  }
}

/**
 * Transforms a custom tool schema into a provider tool config
 */
export function transformCustomTool(customTool: any): ProviderToolConfig {
  const schema = customTool.schema

  if (!schema || !schema.function) {
    throw new Error('Invalid custom tool schema')
  }

  return {
    id: `custom_${customTool.id}`, // Prefix with 'custom_' to identify custom tools
    name: schema.function.name,
    description: schema.function.description || '',
    params: {}, // This will be derived from parameters
    parameters: {
      type: schema.function.parameters.type,
      properties: schema.function.parameters.properties,
      required: schema.function.parameters.required || [],
    },
  }
}

/**
 * Gets all available custom tools as provider tool configs
 */
export function getCustomTools(): ProviderToolConfig[] {
  // Get custom tools from the store
  const customTools = useCustomToolsStore.getState().getAllTools()

  if (customTools.length > 0) {
    logger.info(`Found ${customTools.length} custom tools`)
  }

  // Transform each custom tool into a provider tool config
  return customTools.map(transformCustomTool)
}

/**
 * Transforms a block tool into a provider tool config with operation selection
 *
 * @param block The block to transform
 * @param options Additional options including dependencies and selected operation
 * @returns The provider tool config or null if transform fails
 */
export async function transformBlockTool(
  block: any,
  options: {
    selectedOperation?: string
    getAllBlocks: () => any[]
    getTool: (toolId: string) => any
    getToolAsync?: (toolId: string) => Promise<any>
  }
): Promise<ProviderToolConfig | null> {
  const { selectedOperation, getAllBlocks, getTool, getToolAsync } = options

  // Get the block definition
  const blockDef = getAllBlocks().find((b: any) => b.type === block.type)
  if (!blockDef) {
    logger.warn(`Block definition not found for type: ${block.type}`)
    return null
  }

  // If the block has multiple operations, use the selected one or the first one
  let toolId: string | null = null

  if ((blockDef.tools?.access?.length || 0) > 1) {
    // If we have an operation dropdown in the block and a selected operation
    if (selectedOperation && blockDef.tools?.config?.tool) {
      // Use the block's tool selection function to get the right tool
      try {
        toolId = blockDef.tools.config.tool({
          ...block.params,
          operation: selectedOperation,
        })
      } catch (error) {
        logger.error('Error selecting tool for block', {
          blockType: block.type,
          operation: selectedOperation,
          error,
        })
        return null
      }
    } else {
      // Default to first tool if no operation specified
      toolId = blockDef.tools.access[0]
    }
  } else {
    // Single tool case
    toolId = blockDef.tools?.access?.[0] || null
  }

  if (!toolId) {
    logger.warn(`No tool ID found for block: ${block.type}`)
    return null
  }

  // Get the tool config - check if it's a custom tool that needs async fetching
  let toolConfig: any

  if (toolId.startsWith('custom_') && getToolAsync) {
    // Use the async version for custom tools
    toolConfig = await getToolAsync(toolId)
  } else {
    // Use the synchronous version for built-in tools
    toolConfig = getTool(toolId)
  }

  if (!toolConfig) {
    logger.warn(`Tool config not found for ID: ${toolId}`)
    return null
  }

  // Import the new tool parameter utilities
  const { createLLMToolSchema } = await import('../tools/params')

  // Get user-provided parameters from the block
  const userProvidedParams = block.params || {}

  // Create LLM schema that excludes user-provided parameters
  const llmSchema = createLLMToolSchema(toolConfig, userProvidedParams)

  // Return formatted tool config
  return {
    id: toolConfig.id,
    name: toolConfig.name,
    description: toolConfig.description,
    params: userProvidedParams,
    parameters: llmSchema,
  }
}

/**
 * Calculate cost for token usage based on model pricing
 *
 * @param model The model name
 * @param promptTokens Number of prompt tokens used
 * @param completionTokens Number of completion tokens used
 * @param useCachedInput Whether to use cached input pricing (default: false)
 * @returns Cost calculation results with input, output and total costs
 */
export function calculateCost(
  model: string,
  promptTokens = 0,
  completionTokens = 0,
  useCachedInput = false
) {
  // First check if it's an embedding model
  let pricing = getEmbeddingModelPricing(model)

  // If not found, check chat models
  if (!pricing) {
    pricing = getModelPricingFromDefinitions(model)
  }

  // If no pricing found, return default pricing
  if (!pricing) {
    const defaultPricing = {
      input: 1.0,
      cachedInput: 0.5,
      output: 5.0,
      updatedAt: '2025-03-21',
    }
    return {
      input: 0,
      output: 0,
      total: 0,
      pricing: defaultPricing,
    }
  }

  // Calculate costs in USD
  // Convert from "per million tokens" to "per token" by dividing by 1,000,000
  const inputCost =
    promptTokens *
    (useCachedInput && pricing.cachedInput
      ? pricing.cachedInput / 1_000_000
      : pricing.input / 1_000_000)

  const outputCost = completionTokens * (pricing.output / 1_000_000)
  const totalCost = inputCost + outputCost

  const costMultiplier = getCostMultiplier()

  const finalInputCost = inputCost * costMultiplier
  const finalOutputCost = outputCost * costMultiplier
  const finalTotalCost = totalCost * costMultiplier

  return {
    input: Number.parseFloat(finalInputCost.toFixed(8)), // Use 8 decimal places for small costs
    output: Number.parseFloat(finalOutputCost.toFixed(8)),
    total: Number.parseFloat(finalTotalCost.toFixed(8)),
    pricing,
  }
}

/**
 * Get pricing information for a specific model (including embedding models)
 */
export function getModelPricing(modelId: string): any {
  // First check if it's an embedding model
  const embeddingPricing = getEmbeddingModelPricing(modelId)
  if (embeddingPricing) {
    return embeddingPricing
  }

  // Then check chat models
  return getModelPricingFromDefinitions(modelId)
}

/**
 * Format cost as a currency string
 *
 * @param cost Cost in USD
 * @returns Formatted cost string
 */
export function formatCost(cost: number): string {
  if (cost === undefined || cost === null) return '—'

  if (cost >= 1) {
    // For costs >= $1, show two decimal places
    return `$${cost.toFixed(2)}`
  }
  if (cost >= 0.01) {
    // For costs between 1¢ and $1, show three decimal places
    return `$${cost.toFixed(3)}`
  }
  if (cost >= 0.001) {
    // For costs between 0.1¢ and 1¢, show four decimal places
    return `$${cost.toFixed(4)}`
  }
  if (cost > 0) {
    // For very small costs, still show as fixed decimal instead of scientific notation
    // Find the first non-zero digit and show a few more places
    const places = Math.max(4, Math.abs(Math.floor(Math.log10(cost))) + 3)
    return `$${cost.toFixed(places)}`
  }
  return '$0'
}

/**
 * Get the list of models that are hosted by the platform (don't require user API keys)
 * These are the models for which we hide the API key field in the hosted environment
 */
export function getHostedModels(): string[] {
  return getHostedModelsFromDefinitions()
}

/**
 * Get an API key for a specific provider, handling rotation and fallbacks
 * For use server-side only
 */
export function getApiKey(provider: string, model: string, userProvidedKey?: string): string {
  // If user provided a key, use it as a fallback
  const hasUserKey = !!userProvidedKey

  // Use server key rotation for all OpenAI models and Anthropic's Claude models on the hosted platform
  const isOpenAIModel = provider === 'openai'
  const isClaudeModel = provider === 'anthropic'

  if (isHosted && (isOpenAIModel || isClaudeModel)) {
    try {
      // Import the key rotation function
      const { getRotatingApiKey } = require('@/lib/utils')
      const serverKey = getRotatingApiKey(provider)
      return serverKey
    } catch (_error) {
      // If server key fails and we have a user key, fallback to that
      if (hasUserKey) {
        return userProvidedKey!
      }

      // Otherwise, throw an error
      throw new Error(`No API key available for ${provider} ${model}`)
    }
  }

  // For all other cases, require user-provided key
  if (!hasUserKey) {
    throw new Error(`API key is required for ${provider} ${model}`)
  }

  return userProvidedKey!
}

/**
 * Prepares tool configuration for provider requests with consistent tool usage control behavior
 *
 * @param tools Array of tools in provider-specific format
 * @param providerTools Original tool configurations with usage control settings
 * @param logger Logger instance to use for logging
 * @param provider Optional provider ID to adjust format for specific providers
 * @returns Object with prepared tools and tool_choice settings
 */
export function prepareToolsWithUsageControl(
  tools: any[] | undefined,
  providerTools: any[] | undefined,
  logger: any,
  provider?: string
): {
  tools: any[] | undefined
  toolChoice:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } }
    | undefined
  toolConfig?: {
    // Add toolConfig for Google's format
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE'
      allowedFunctionNames?: string[]
    }
  }
  hasFilteredTools: boolean
  forcedTools: string[] // Return all forced tool IDs
} {
  // If no tools, return early
  if (!tools || tools.length === 0) {
    return {
      tools: undefined,
      toolChoice: undefined,
      hasFilteredTools: false,
      forcedTools: [],
    }
  }

  // Filter out tools marked with usageControl='none'
  const filteredTools = tools.filter((tool) => {
    const toolId = tool.function?.name || tool.name
    const toolConfig = providerTools?.find((t) => t.id === toolId)
    return toolConfig?.usageControl !== 'none'
  })

  // Check if any tools were filtered out
  const hasFilteredTools = filteredTools.length < tools.length
  if (hasFilteredTools) {
    logger.info(
      `Filtered out ${tools.length - filteredTools.length} tools with usageControl='none'`
    )
  }

  // If all tools were filtered out, return empty
  if (filteredTools.length === 0) {
    logger.info('All tools were filtered out due to usageControl="none"')
    return {
      tools: undefined,
      toolChoice: undefined,
      hasFilteredTools: true,
      forcedTools: [],
    }
  }

  // Get all tools that should be forced
  const forcedTools = providerTools?.filter((tool) => tool.usageControl === 'force') || []
  const forcedToolIds = forcedTools.map((tool) => tool.id)

  // Determine tool_choice setting
  let toolChoice:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } } = 'auto'

  // For Google, we'll use a separate toolConfig object
  let toolConfig:
    | {
        functionCallingConfig: {
          mode: 'AUTO' | 'ANY' | 'NONE'
          allowedFunctionNames?: string[]
        }
      }
    | undefined

  if (forcedTools.length > 0) {
    // Force the first tool that has usageControl='force'
    const forcedTool = forcedTools[0]

    // Adjust format based on provider
    if (provider === 'anthropic') {
      toolChoice = {
        type: 'tool',
        name: forcedTool.id,
      }
    } else if (provider === 'google') {
      // Google Gemini format uses a separate toolConfig object
      toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames:
            forcedTools.length === 1
              ? [forcedTool.id] // If only one tool, specify just that one
              : forcedToolIds, // If multiple tools, include all of them
        },
      }
      // Keep toolChoice as 'auto' since we use toolConfig instead
      toolChoice = 'auto'
    } else {
      // Default OpenAI format
      toolChoice = {
        type: 'function',
        function: { name: forcedTool.id },
      }
    }

    logger.info(`Forcing use of tool: ${forcedTool.id}`)

    if (forcedTools.length > 1) {
      logger.info(
        `Multiple tools set to 'force' mode (${forcedToolIds.join(', ')}). Will cycle through them sequentially.`
      )
    }
  } else {
    // Default to auto if no forced tools
    toolChoice = 'auto'
    if (provider === 'google') {
      toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
    }
    logger.info('Setting tool_choice to auto - letting model decide which tools to use')
  }

  return {
    tools: filteredTools,
    toolChoice,
    toolConfig,
    hasFilteredTools,
    forcedTools: forcedToolIds,
  }
}

/**
 * Checks if a forced tool has been used in a response and manages the tool_choice accordingly
 *
 * @param toolCallsResponse Array of tool calls in the response
 * @param originalToolChoice The original tool_choice setting used in the request
 * @param logger Logger instance to use for logging
 * @param provider Optional provider ID to adjust format for specific providers
 * @param forcedTools Array of all tool IDs that should be forced in sequence
 * @param usedForcedTools Array of tool IDs that have already been used
 * @returns Object containing tracking information and next tool choice
 */
export function trackForcedToolUsage(
  toolCallsResponse: any[] | undefined,
  originalToolChoice: any,
  logger: any,
  provider?: string,
  forcedTools: string[] = [],
  usedForcedTools: string[] = []
): {
  hasUsedForcedTool: boolean
  usedForcedTools: string[]
  nextToolChoice?:
    | 'auto'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } }
    | null
  nextToolConfig?: {
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE'
      allowedFunctionNames?: string[]
    }
  }
} {
  // Default to keeping the original tool_choice
  let hasUsedForcedTool = false
  let nextToolChoice = originalToolChoice
  let nextToolConfig:
    | {
        functionCallingConfig: {
          mode: 'AUTO' | 'ANY' | 'NONE'
          allowedFunctionNames?: string[]
        }
      }
    | undefined

  const updatedUsedForcedTools = [...usedForcedTools]

  // Special handling for Google format
  const isGoogleFormat = provider === 'google'

  // Get the name of the current forced tool(s)
  let forcedToolNames: string[] = []
  if (isGoogleFormat && originalToolChoice?.functionCallingConfig?.allowedFunctionNames) {
    // For Google format
    forcedToolNames = originalToolChoice.functionCallingConfig.allowedFunctionNames
  } else if (
    typeof originalToolChoice === 'object' &&
    (originalToolChoice?.function?.name ||
      (originalToolChoice?.type === 'tool' && originalToolChoice?.name) ||
      (originalToolChoice?.type === 'any' && originalToolChoice?.any?.name))
  ) {
    // For other providers
    forcedToolNames = [
      originalToolChoice?.function?.name ||
        originalToolChoice?.name ||
        originalToolChoice?.any?.name,
    ].filter(Boolean)
  }

  // If we're forcing specific tools and we have tool calls in the response
  if (forcedToolNames.length > 0 && toolCallsResponse && toolCallsResponse.length > 0) {
    // Check if any of the tool calls used the forced tools
    const toolNames = toolCallsResponse.map((tc) => tc.function?.name || tc.name || tc.id)

    // Find any forced tools that were used
    const usedTools = forcedToolNames.filter((toolName) => toolNames.includes(toolName))

    if (usedTools.length > 0) {
      // At least one forced tool was used
      hasUsedForcedTool = true
      updatedUsedForcedTools.push(...usedTools)

      // Find the next tools to force that haven't been used yet
      const remainingTools = forcedTools.filter((tool) => !updatedUsedForcedTools.includes(tool))

      if (remainingTools.length > 0) {
        // There are still forced tools to use
        const nextToolToForce = remainingTools[0]

        // Format based on provider
        if (provider === 'anthropic') {
          nextToolChoice = {
            type: 'tool',
            name: nextToolToForce,
          }
        } else if (provider === 'google') {
          nextToolConfig = {
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames:
                remainingTools.length === 1
                  ? [nextToolToForce] // If only one tool left, specify just that one
                  : remainingTools, // If multiple tools, include all remaining
            },
          }
        } else {
          // Default OpenAI format
          nextToolChoice = {
            type: 'function',
            function: { name: nextToolToForce },
          }
        }

        logger.info(
          `Forced tool(s) ${usedTools.join(', ')} used, switching to next forced tool(s): ${remainingTools.join(', ')}`
        )
      } else {
        // All forced tools have been used, switch to auto mode
        if (provider === 'anthropic') {
          nextToolChoice = null // Anthropic requires null to remove the parameter
        } else if (provider === 'google') {
          nextToolConfig = { functionCallingConfig: { mode: 'AUTO' } }
        } else {
          nextToolChoice = 'auto'
        }

        logger.info('All forced tools have been used, switching to auto mode for future iterations')
      }
    }
  }

  return {
    hasUsedForcedTool,
    usedForcedTools: updatedUsedForcedTools,
    nextToolChoice: hasUsedForcedTool ? nextToolChoice : originalToolChoice,
    nextToolConfig: isGoogleFormat
      ? hasUsedForcedTool
        ? nextToolConfig
        : originalToolChoice
      : undefined,
  }
}

export const MODELS_TEMP_RANGE_0_2 = getModelsWithTempRange02()
export const MODELS_TEMP_RANGE_0_1 = getModelsWithTempRange01()
export const MODELS_WITH_TEMPERATURE_SUPPORT = getModelsWithTemperatureSupport()
export const PROVIDERS_WITH_TOOL_USAGE_CONTROL = getProvidersWithToolUsageControl()

/**
 * Check if a model supports temperature parameter
 */
export function supportsTemperature(model: string): boolean {
  return supportsTemperatureFromDefinitions(model)
}

/**
 * Get the maximum temperature value for a model
 * @returns Maximum temperature value (1 or 2) or undefined if temperature not supported
 */
export function getMaxTemperature(model: string): number | undefined {
  return getMaxTempFromDefinitions(model)
}

/**
 * Check if a provider supports tool usage control
 */
export function supportsToolUsageControl(provider: string): boolean {
  return supportsToolUsageControlFromDefinitions(provider)
}

/**
 * Prepare tool execution parameters, separating tool parameters from system parameters
 */
export function prepareToolExecution(
  tool: { params?: Record<string, any> },
  llmArgs: Record<string, any>,
  request: { workflowId?: string; environmentVariables?: Record<string, any> }
): {
  toolParams: Record<string, any>
  executionParams: Record<string, any>
} {
  // Only merge actual tool parameters for logging
  const toolParams = {
    ...tool.params,
    ...llmArgs,
  }

  // Add system parameters for execution
  const executionParams = {
    ...toolParams,
    ...(request.workflowId ? { _context: { workflowId: request.workflowId } } : {}),
    ...(request.environmentVariables ? { envVars: request.environmentVariables } : {}),
  }

  return { toolParams, executionParams }
}
