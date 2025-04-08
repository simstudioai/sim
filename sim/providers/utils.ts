import { createLogger } from '@/lib/logs/console-logger'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { anthropicProvider } from './anthropic'
import { cerebrasProvider } from './cerebras'
import { deepseekProvider } from './deepseek'
import { googleProvider } from './google'
import { groqProvider } from './groq'
import { ollamaProvider } from './ollama'
import { openaiProvider } from './openai'
import { getModelPricing } from './pricing'
import { ProviderConfig, ProviderId, ProviderToolConfig } from './types'
import { xAIProvider } from './xai'

const logger = createLogger('ProviderUtils')

/**
 * Provider configurations with associated model names/patterns
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
    models: ['gpt-4o', 'o1', 'o3-mini'],
    computerUseModels: ['computer-use-preview'],
    modelPatterns: [/^gpt/, /^o1/],
  },
  anthropic: {
    ...anthropicProvider,
    models: ['claude-3-5-sonnet-20240620', 'claude-3-7-sonnet-20250219'],
    computerUseModels: ['claude-3-5-sonnet-20240620', 'claude-3-7-sonnet-20250219'],
    modelPatterns: [/^claude/],
  },
  google: {
    ...googleProvider,
    models: ['gemini-2.0-flash', 'gemini-2.5-pro-exp-03-25'],
    modelPatterns: [/^gemini/],
  },
  deepseek: {
    ...deepseekProvider,
    models: ['deepseek-v3', 'deepseek-r1'],
    modelPatterns: [],
  },
  xai: {
    ...xAIProvider,
    models: ['grok-2-latest'],
    modelPatterns: [/^grok/],
  },
  cerebras: {
    ...cerebrasProvider,
    models: ['cerebras/llama-3.3-70b'],
    modelPatterns: [/^cerebras/],
  },
  groq: {
    ...groqProvider,
    models: [
      'groq/meta-llama/llama-4-scout-17b-16e-instruct',
      'groq/llama-3.3-70b-specdec',
      'groq/deepseek-r1-distill-llama-70b',
      'groq/qwen-2.5-32b',
    ],
    modelPatterns: [/^groq/],
  },
  ollama: {
    ...ollamaProvider,
    models: [],
    modelPatterns: [],
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
  providers.ollama.models = models
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
  const provider = providers[providerId]
  return provider?.models || []
}

export function generateStructuredOutputInstructions(responseFormat: any): string {
  // If using the new JSON Schema format, don't add additional instructions
  // This is necessary because providers now handle the schema directly
  if (responseFormat.schema || (responseFormat.type === 'object' && responseFormat.properties)) {
    return ''
  }

  // Handle legacy format with fields array
  if (!responseFormat?.fields) return ''

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
  } catch (error) {
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
export function transformBlockTool(
  block: any,
  options: {
    selectedOperation?: string
    getAllBlocks: () => any[]
    getTool: (toolId: string) => any
  }
): ProviderToolConfig | null {
  const { selectedOperation, getAllBlocks, getTool } = options

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

  // Get the tool config
  const toolConfig = getTool(toolId)
  if (!toolConfig) {
    logger.warn(`Tool config not found for ID: ${toolId}`)
    return null
  }

  // Return formatted tool config
  return {
    id: toolConfig.id,
    name: toolConfig.name,
    description: toolConfig.description,
    params: block.params || {},
    parameters: {
      type: 'object',
      properties: Object.entries(toolConfig.params).reduce(
        (acc, [key, config]: [string, any]) => ({
          ...acc,
          [key]: {
            type: config.type === 'json' ? 'object' : config.type,
            description: config.description || '',
            ...(key in block.params && { default: block.params[key] }),
          },
        }),
        {}
      ),
      required: Object.entries(toolConfig.params)
        .filter(([_, config]: [string, any]) => config.required)
        .map(([key]) => key),
    },
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
  promptTokens: number = 0,
  completionTokens: number = 0,
  useCachedInput: boolean = false
) {
  const pricing = getModelPricing(model)

  // Calculate costs in USD
  // Convert from "per million tokens" to "per token" by dividing by 1,000,000
  const inputCost =
    promptTokens *
    (useCachedInput && pricing.cachedInput
      ? pricing.cachedInput / 1_000_000
      : pricing.input / 1_000_000)

  const outputCost = completionTokens * (pricing.output / 1_000_000)
  const totalCost = inputCost + outputCost

  return {
    input: parseFloat(inputCost.toFixed(6)),
    output: parseFloat(outputCost.toFixed(6)),
    total: parseFloat(totalCost.toFixed(6)),
    pricing,
  }
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
  } else if (cost >= 0.01) {
    // For costs between 1¢ and $1, show three decimal places
    return `$${cost.toFixed(3)}`
  } else if (cost >= 0.001) {
    // For costs between 0.1¢ and 1¢, show four decimal places
    return `$${cost.toFixed(4)}`
  } else if (cost > 0) {
    // For very small costs, still show as fixed decimal instead of scientific notation
    // Find the first non-zero digit and show a few more places
    const places = Math.max(4, Math.abs(Math.floor(Math.log10(cost))) + 3)
    return `$${cost.toFixed(places)}`
  } else {
    return '$0'
  }
}

/**
 * Get an API key for a specific provider, handling rotation and fallbacks
 * For use server-side only
 */
export function getApiKey(provider: string, model: string, userProvidedKey?: string): string {
  // If user provided a key, use it as a fallback
  const hasUserKey = !!userProvidedKey

  // Only use server key rotation for OpenAI's gpt-4o model on the hosted platform
  const isHostedVersion = process.env.NEXT_PUBLIC_APP_URL === 'https://www.simstudio.ai'
  const isGPT4o = model === 'gpt-4o' && provider === 'openai'

  if (isHostedVersion && isGPT4o) {
    try {
      // Import the key rotation function
      const { getRotatingApiKey } = require('@/lib/utils')
      const serverKey = getRotatingApiKey('openai')
      return serverKey
    } catch (error) {
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
  hasFilteredTools: boolean
  forcedTools: string[] // Return all forced tool IDs
} {
  // If no tools, return early
  if (!tools || tools.length === 0) {
    return { tools: undefined, toolChoice: undefined, hasFilteredTools: false, forcedTools: [] }
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
    return { tools: undefined, toolChoice: undefined, hasFilteredTools: true, forcedTools: [] }
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
      // Google Gemini format uses "any" type with tool name
      toolChoice = {
        type: 'any',
        any: {
          model: 'latest',
          name: forcedTool.id,
        },
      }
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
    logger.info('Setting tool_choice to auto - letting model decide which tools to use')
  }

  return {
    tools: filteredTools,
    toolChoice,
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
  nextToolChoice:
    | 'auto'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } }
    | null
} {
  // Default to keeping the original tool_choice
  let hasUsedForcedTool = false
  let nextToolChoice = originalToolChoice
  const updatedUsedForcedTools = [...usedForcedTools]

  // If we're forcing a specific tool and we have tool calls in the response
  if (
    typeof originalToolChoice === 'object' &&
    (originalToolChoice?.function?.name ||
      (originalToolChoice?.type === 'tool' && originalToolChoice?.name) ||
      (originalToolChoice?.type === 'any' && originalToolChoice?.any?.name)) &&
    toolCallsResponse &&
    toolCallsResponse.length > 0
  ) {
    // Get the name of the current forced tool
    const forcedToolName =
      originalToolChoice?.function?.name ||
      originalToolChoice?.name ||
      originalToolChoice?.any?.name

    // Check if any of the tool calls used the forced tool
    const toolNames = toolCallsResponse.map((tc) => tc.function?.name || tc.name || tc.id)

    if (toolNames.includes(forcedToolName)) {
      // The forced tool was used
      hasUsedForcedTool = true
      updatedUsedForcedTools.push(forcedToolName)

      // Find the next tool to force that hasn't been used yet
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
          nextToolChoice = {
            type: 'any',
            any: {
              model: 'latest',
              name: nextToolToForce,
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
          `Forced tool ${forcedToolName} was used, switching to next forced tool: ${nextToolToForce}`
        )
      } else {
        // All forced tools have been used, switch to auto mode
        nextToolChoice = provider === 'anthropic' ? null : 'auto'

        logger.info(`All forced tools have been used, switching to auto mode for future iterations`)
      }
    }
  }

  return {
    hasUsedForcedTool,
    usedForcedTools: updatedUsedForcedTools,
    nextToolChoice: hasUsedForcedTool ? nextToolChoice : originalToolChoice,
  }
}
