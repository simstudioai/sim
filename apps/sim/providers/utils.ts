import { createLogger, type Logger } from '@sim/logger'
import type OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/feature-flags'
import { isCustomTool } from '@/executor/constants'
import {
  getComputerUseModels,
  getEmbeddingModelPricing,
  getHostedModels as getHostedModelsFromDefinitions,
  getMaxOutputTokensForModel as getMaxOutputTokensForModelFromDefinitions,
  getMaxTemperature as getMaxTempFromDefinitions,
  getModelPricing as getModelPricingFromDefinitions,
  getModelsWithReasoningEffort,
  getModelsWithTemperatureSupport,
  getModelsWithTempRange01,
  getModelsWithTempRange02,
  getModelsWithThinking,
  getModelsWithVerbosity,
  getProviderDefaultModel as getProviderDefaultModelFromDefinitions,
  getProviderModels as getProviderModelsFromDefinitions,
  getProvidersWithToolUsageControl,
  getReasoningEffortValuesForModel as getReasoningEffortValuesForModelFromDefinitions,
  getThinkingLevelsForModel as getThinkingLevelsForModelFromDefinitions,
  getVerbosityValuesForModel as getVerbosityValuesForModelFromDefinitions,
  PROVIDER_DEFINITIONS,
  supportsTemperature as supportsTemperatureFromDefinitions,
  supportsToolUsageControl as supportsToolUsageControlFromDefinitions,
  updateOllamaModels as updateOllamaModelsInDefinitions,
} from '@/providers/models'
import type { ProviderId, ProviderToolConfig } from '@/providers/types'
import { useProvidersStore } from '@/stores/providers/store'
import { mergeToolParameters } from '@/tools/params'

const logger = createLogger('ProviderUtils')

/**
 * Checks if a workflow description is a default/placeholder description
 */
function isDefaultWorkflowDescription(
  description: string | null | undefined,
  name?: string
): boolean {
  if (!description) return true
  const normalizedDesc = description.toLowerCase().trim()
  return (
    description === name ||
    normalizedDesc === 'new workflow' ||
    normalizedDesc === 'your first workflow - start building here!'
  )
}

/**
 * Fetches workflow metadata (name and description) from the API
 */
async function fetchWorkflowMetadata(
  workflowId: string
): Promise<{ name: string; description: string | null } | null> {
  try {
    const { buildAuthHeaders, buildAPIUrl } = await import('@/executor/utils/http')

    const headers = await buildAuthHeaders()
    const url = buildAPIUrl(`/api/workflows/${workflowId}`)

    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      logger.warn(`Failed to fetch workflow metadata for ${workflowId}`)
      return null
    }

    const { data } = await response.json()
    return {
      name: data?.name || 'Workflow',
      description: data?.description || null,
    }
  } catch (error) {
    logger.error('Error fetching workflow metadata:', error)
    return null
  }
}

/**
 * Client-safe provider metadata.
 * This object contains only model lists and patterns - no executeRequest implementations.
 * For server-side execution, use @/providers/registry.
 */
export interface ProviderMetadata {
  id: string
  name: string
  description: string
  version: string
  models: string[]
  defaultModel: string
  computerUseModels?: string[]
  modelPatterns?: RegExp[]
}

/**
 * Build provider metadata from PROVIDER_DEFINITIONS.
 * This is client-safe as it doesn't import any provider implementations.
 */
function buildProviderMetadata(providerId: ProviderId): ProviderMetadata {
  const def = PROVIDER_DEFINITIONS[providerId]
  return {
    id: providerId,
    name: def?.name || providerId,
    description: def?.description || '',
    version: '1.0.0',
    models: getProviderModelsFromDefinitions(providerId),
    defaultModel: getProviderDefaultModelFromDefinitions(providerId),
    modelPatterns: def?.modelPatterns,
  }
}

export const providers: Record<ProviderId, ProviderMetadata> = {
  ollama: buildProviderMetadata('ollama'),
  vllm: buildProviderMetadata('vllm'),
  openai: {
    ...buildProviderMetadata('openai'),
    computerUseModels: ['computer-use-preview'],
  },
  anthropic: {
    ...buildProviderMetadata('anthropic'),
    computerUseModels: getComputerUseModels().filter((model) =>
      getProviderModelsFromDefinitions('anthropic').includes(model)
    ),
  },
  google: buildProviderMetadata('google'),
  vertex: buildProviderMetadata('vertex'),
  'azure-openai': buildProviderMetadata('azure-openai'),
  'azure-anthropic': buildProviderMetadata('azure-anthropic'),
  deepseek: buildProviderMetadata('deepseek'),
  xai: buildProviderMetadata('xai'),
  cerebras: buildProviderMetadata('cerebras'),
  groq: buildProviderMetadata('groq'),
  mistral: buildProviderMetadata('mistral'),
  bedrock: buildProviderMetadata('bedrock'),
  openrouter: buildProviderMetadata('openrouter'),
}

export function updateOllamaProviderModels(models: string[]): void {
  updateOllamaModelsInDefinitions(models)
  providers.ollama.models = getProviderModelsFromDefinitions('ollama')
}

export function updateVLLMProviderModels(models: string[]): void {
  const { updateVLLMModels } = require('@/providers/models')
  updateVLLMModels(models)
  providers.vllm.models = getProviderModelsFromDefinitions('vllm')
}

export async function updateOpenRouterProviderModels(models: string[]): Promise<void> {
  const { updateOpenRouterModels } = await import('@/providers/models')
  updateOpenRouterModels(models)
  providers.openrouter.models = getProviderModelsFromDefinitions('openrouter')
}

export function getBaseModelProviders(): Record<string, ProviderId> {
  const allProviders = Object.entries(providers)
    .filter(
      ([providerId]) =>
        providerId !== 'ollama' && providerId !== 'vllm' && providerId !== 'openrouter'
    )
    .reduce(
      (map, [providerId, config]) => {
        config.models.forEach((model) => {
          map[model.toLowerCase()] = providerId as ProviderId
        })
        return map
      },
      {} as Record<string, ProviderId>
    )

  return filterBlacklistedModelsFromProviderMap(allProviders)
}

function filterBlacklistedModelsFromProviderMap(
  providerMap: Record<string, ProviderId>
): Record<string, ProviderId> {
  const filtered: Record<string, ProviderId> = {}
  for (const [model, providerId] of Object.entries(providerMap)) {
    if (isProviderBlacklisted(providerId)) {
      continue
    }
    if (!isModelBlacklisted(model)) {
      filtered[model] = providerId
    }
  }
  return filtered
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

  let providerId: ProviderId | null = null

  if (normalizedModel in getAllModelProviders()) {
    providerId = getAllModelProviders()[normalizedModel]
  } else {
    for (const [id, config] of Object.entries(providers)) {
      if (config.modelPatterns) {
        for (const pattern of config.modelPatterns) {
          if (pattern.test(normalizedModel)) {
            providerId = id as ProviderId
            break
          }
        }
      }
      if (providerId) break
    }
  }

  if (!providerId) {
    logger.warn(`No provider found for model: ${model}, defaulting to ollama`)
    providerId = 'ollama'
  }

  if (isProviderBlacklisted(providerId)) {
    throw new Error(`Provider "${providerId}" is not available`)
  }

  if (isModelBlacklisted(normalizedModel)) {
    throw new Error(`Model "${model}" is not available`)
  }

  return providerId
}

export function getProvider(id: string): ProviderMetadata | undefined {
  const providerId = id.split('/')[0] as ProviderId
  return providers[providerId]
}

export function getProviderConfigFromModel(model: string): ProviderMetadata | undefined {
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

function getBlacklistedProviders(): string[] {
  if (!env.BLACKLISTED_PROVIDERS) return []
  return env.BLACKLISTED_PROVIDERS.split(',').map((p) => p.trim().toLowerCase())
}

export function isProviderBlacklisted(providerId: string): boolean {
  const blacklist = getBlacklistedProviders()
  return blacklist.includes(providerId.toLowerCase())
}

/**
 * Get the list of blacklisted models from env var.
 * BLACKLISTED_MODELS supports:
 * - Exact model names: "gpt-4,claude-3-opus"
 * - Prefix patterns with *: "claude-*,gpt-4-*" (matches models starting with that prefix)
 */
function getBlacklistedModels(): { models: string[]; prefixes: string[] } {
  if (!env.BLACKLISTED_MODELS) return { models: [], prefixes: [] }

  const entries = env.BLACKLISTED_MODELS.split(',').map((m) => m.trim().toLowerCase())
  const models = entries.filter((e) => !e.endsWith('*'))
  const prefixes = entries.filter((e) => e.endsWith('*')).map((e) => e.slice(0, -1))

  return { models, prefixes }
}

function isModelBlacklisted(model: string): boolean {
  const lowerModel = model.toLowerCase()
  const blacklist = getBlacklistedModels()

  if (blacklist.models.includes(lowerModel)) {
    return true
  }

  if (blacklist.prefixes.some((prefix) => lowerModel.startsWith(prefix))) {
    return true
  }

  return false
}

export function filterBlacklistedModels(models: string[]): string[] {
  return models.filter((model) => !isModelBlacklisted(model))
}

export function getProviderIcon(model: string): React.ComponentType<{ className?: string }> | null {
  const providerId = getProviderFromModel(model)
  return PROVIDER_DEFINITIONS[providerId]?.icon || null
}

/**
 * Generates prompt instructions for structured JSON output from a JSON schema.
 * Used as a fallback when native structured outputs are not supported.
 */
export function generateSchemaInstructions(schema: any, schemaName?: string): string {
  const name = schemaName || 'response'
  return `IMPORTANT: You must respond with a valid JSON object that conforms to the following schema.
Do not include any text before or after the JSON object. Only output the JSON.

Schema name: ${name}
JSON Schema:
${JSON.stringify(schema, null, 2)}

Your response must be valid JSON that exactly matches this schema structure.`
}

export function generateStructuredOutputInstructions(responseFormat: any): string {
  if (!responseFormat) return ''

  if (responseFormat.schema || (responseFormat.type === 'object' && responseFormat.properties)) {
    return ''
  }

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
  const trimmed = content.trim()

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error('No JSON object found in content')
  }

  const jsonStr = trimmed.slice(firstBrace, lastBrace + 1)

  try {
    return JSON.parse(jsonStr)
  } catch (_error) {
    const cleaned = jsonStr
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/,\s*([}\]])/g, '$1')

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

  const blockDef = getAllBlocks().find((b: any) => b.type === block.type)
  if (!blockDef) {
    logger.warn(`Block definition not found for type: ${block.type}`)
    return null
  }

  let toolId: string | null = null

  if ((blockDef.tools?.access?.length || 0) > 1) {
    if (selectedOperation && blockDef.tools?.config?.tool) {
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
      toolId = blockDef.tools.access[0]
    }
  } else {
    toolId = blockDef.tools?.access?.[0] || null
  }

  if (!toolId) {
    logger.warn(`No tool ID found for block: ${block.type}`)
    return null
  }

  let toolConfig: any

  if (isCustomTool(toolId) && getToolAsync) {
    toolConfig = await getToolAsync(toolId)
  } else {
    toolConfig = getTool(toolId)
  }

  if (!toolConfig) {
    logger.warn(`Tool config not found for ID: ${toolId}`)
    return null
  }

  const { createLLMToolSchema } = await import('@/tools/params')

  const userProvidedParams = block.params || {}

  const llmSchema = await createLLMToolSchema(toolConfig, userProvidedParams)

  let uniqueToolId = toolConfig.id
  let toolName = toolConfig.name
  let toolDescription = toolConfig.description

  if (toolId === 'workflow_executor' && userProvidedParams.workflowId) {
    uniqueToolId = `${toolConfig.id}_${userProvidedParams.workflowId}`

    const workflowMetadata = await fetchWorkflowMetadata(userProvidedParams.workflowId)
    if (workflowMetadata) {
      toolName = workflowMetadata.name || toolConfig.name
      if (
        workflowMetadata.description &&
        !isDefaultWorkflowDescription(workflowMetadata.description, workflowMetadata.name)
      ) {
        toolDescription = workflowMetadata.description
      }
    }
  } else if (toolId.startsWith('knowledge_') && userProvidedParams.knowledgeBaseId) {
    uniqueToolId = `${toolConfig.id}_${userProvidedParams.knowledgeBaseId}`
  }

  return {
    id: uniqueToolId,
    name: toolName,
    description: toolDescription,
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
 * @param customMultiplier Optional custom multiplier to override the default cost multiplier
 * @returns Cost calculation results with input, output and total costs
 */
export function calculateCost(
  model: string,
  promptTokens = 0,
  completionTokens = 0,
  useCachedInput = false,
  inputMultiplier?: number,
  outputMultiplier?: number
) {
  let pricing = getEmbeddingModelPricing(model)

  if (!pricing) {
    pricing = getModelPricingFromDefinitions(model)
  }

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

  const inputCost =
    promptTokens *
    (useCachedInput && pricing.cachedInput
      ? pricing.cachedInput / 1_000_000
      : pricing.input / 1_000_000)

  const outputCost = completionTokens * (pricing.output / 1_000_000)
  const finalInputCost = inputCost * (inputMultiplier ?? 1)
  const finalOutputCost = outputCost * (outputMultiplier ?? 1)
  const finalTotalCost = finalInputCost + finalOutputCost

  return {
    input: Number.parseFloat(finalInputCost.toFixed(8)),
    output: Number.parseFloat(finalOutputCost.toFixed(8)),
    total: Number.parseFloat(finalTotalCost.toFixed(8)),
    pricing,
  }
}

export function getModelPricing(modelId: string): any {
  const embeddingPricing = getEmbeddingModelPricing(modelId)
  if (embeddingPricing) {
    return embeddingPricing
  }

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
    return `$${cost.toFixed(2)}`
  }
  if (cost >= 0.01) {
    return `$${cost.toFixed(3)}`
  }
  if (cost >= 0.001) {
    return `$${cost.toFixed(4)}`
  }
  if (cost > 0) {
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
 * Determine if model usage should be billed to the user
 *
 * @param model The model name
 * @returns true if the usage should be billed to the user
 */
export function shouldBillModelUsage(model: string): boolean {
  const hostedModels = getHostedModels()
  return hostedModels.some((hostedModel) => model.toLowerCase() === hostedModel.toLowerCase())
}

/**
 * Get an API key for a specific provider, handling rotation and fallbacks
 * For use server-side only
 */
export function getApiKey(provider: string, model: string, userProvidedKey?: string): string {
  const hasUserKey = !!userProvidedKey

  const isOllamaModel =
    provider === 'ollama' || useProvidersStore.getState().providers.ollama.models.includes(model)
  if (isOllamaModel) {
    return 'empty'
  }

  const isVllmModel =
    provider === 'vllm' || useProvidersStore.getState().providers.vllm.models.includes(model)
  if (isVllmModel) {
    return userProvidedKey || 'empty'
  }

  // Bedrock uses its own credentials (bedrockAccessKeyId/bedrockSecretKey), not apiKey
  const isBedrockModel = provider === 'bedrock' || model.startsWith('bedrock/')
  if (isBedrockModel) {
    return 'bedrock-uses-own-credentials'
  }

  const isOpenAIModel = provider === 'openai'
  const isClaudeModel = provider === 'anthropic'
  const isGeminiModel = provider === 'google'

  if (isHosted && (isOpenAIModel || isClaudeModel || isGeminiModel)) {
    const hostedModels = getHostedModels()
    const isModelHosted = hostedModels.some((m) => m.toLowerCase() === model.toLowerCase())

    if (isModelHosted) {
      try {
        const { getRotatingApiKey } = require('@/lib/core/config/api-keys')
        const serverKey = getRotatingApiKey(isGeminiModel ? 'gemini' : provider)
        return serverKey
      } catch (_error) {
        if (hasUserKey) {
          return userProvidedKey!
        }

        throw new Error(`No API key available for ${provider} ${model}`)
      }
    }
  }

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
    functionCallingConfig: {
      mode: 'AUTO' | 'ANY' | 'NONE'
      allowedFunctionNames?: string[]
    }
  }
  hasFilteredTools: boolean
  forcedTools: string[]
} {
  if (!tools || tools.length === 0) {
    return {
      tools: undefined,
      toolChoice: undefined,
      hasFilteredTools: false,
      forcedTools: [],
    }
  }

  const filteredTools = tools.filter((tool) => {
    const toolId = tool.function?.name || tool.name
    const toolConfig = providerTools?.find((t) => t.id === toolId)
    return toolConfig?.usageControl !== 'none'
  })

  const hasFilteredTools = filteredTools.length < tools.length
  if (hasFilteredTools) {
    logger.info(
      `Filtered out ${tools.length - filteredTools.length} tools with usageControl='none'`
    )
  }

  if (filteredTools.length === 0) {
    logger.info('All tools were filtered out due to usageControl="none"')
    return {
      tools: undefined,
      toolChoice: undefined,
      hasFilteredTools: true,
      forcedTools: [],
    }
  }

  const forcedTools = providerTools?.filter((tool) => tool.usageControl === 'force') || []
  const forcedToolIds = forcedTools.map((tool) => tool.id)

  let toolChoice:
    | 'auto'
    | 'none'
    | { type: 'function'; function: { name: string } }
    | { type: 'tool'; name: string }
    | { type: 'any'; any: { model: string; name: string } } = 'auto'

  let toolConfig:
    | {
        functionCallingConfig: {
          mode: 'AUTO' | 'ANY' | 'NONE'
          allowedFunctionNames?: string[]
        }
      }
    | undefined

  if (forcedTools.length > 0) {
    const forcedTool = forcedTools[0]

    if (provider === 'anthropic') {
      toolChoice = {
        type: 'tool',
        name: forcedTool.id,
      }
    } else if (provider === 'google') {
      toolConfig = {
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: forcedTools.length === 1 ? [forcedTool.id] : forcedToolIds,
        },
      }
      toolChoice = 'auto'
    } else {
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

  const isGoogleFormat = provider === 'google'

  let forcedToolNames: string[] = []
  if (isGoogleFormat && originalToolChoice?.functionCallingConfig?.allowedFunctionNames) {
    forcedToolNames = originalToolChoice.functionCallingConfig.allowedFunctionNames
  } else if (
    typeof originalToolChoice === 'object' &&
    (originalToolChoice?.function?.name ||
      (originalToolChoice?.type === 'tool' && originalToolChoice?.name) ||
      (originalToolChoice?.type === 'any' && originalToolChoice?.any?.name))
  ) {
    forcedToolNames = [
      originalToolChoice?.function?.name ||
        originalToolChoice?.name ||
        originalToolChoice?.any?.name,
    ].filter(Boolean)
  }

  if (forcedToolNames.length > 0 && toolCallsResponse && toolCallsResponse.length > 0) {
    const toolNames = toolCallsResponse.map((tc) => tc.function?.name || tc.name || tc.id)

    const usedTools = forcedToolNames.filter((toolName) => toolNames.includes(toolName))

    if (usedTools.length > 0) {
      hasUsedForcedTool = true
      updatedUsedForcedTools.push(...usedTools)

      const remainingTools = forcedTools.filter((tool) => !updatedUsedForcedTools.includes(tool))

      if (remainingTools.length > 0) {
        const nextToolToForce = remainingTools[0]

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
                remainingTools.length === 1 ? [nextToolToForce] : remainingTools,
            },
          }
        } else {
          nextToolChoice = {
            type: 'function',
            function: { name: nextToolToForce },
          }
        }

        logger.info(
          `Forced tool(s) ${usedTools.join(', ')} used, switching to next forced tool(s): ${remainingTools.join(', ')}`
        )
      } else {
        if (provider === 'anthropic') {
          nextToolChoice = null
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
export const MODELS_WITH_REASONING_EFFORT = getModelsWithReasoningEffort()
export const MODELS_WITH_VERBOSITY = getModelsWithVerbosity()
export const MODELS_WITH_THINKING = getModelsWithThinking()
export const PROVIDERS_WITH_TOOL_USAGE_CONTROL = getProvidersWithToolUsageControl()

export function supportsTemperature(model: string): boolean {
  return supportsTemperatureFromDefinitions(model)
}

export function supportsReasoningEffort(model: string): boolean {
  return MODELS_WITH_REASONING_EFFORT.includes(model.toLowerCase())
}

export function supportsVerbosity(model: string): boolean {
  return MODELS_WITH_VERBOSITY.includes(model.toLowerCase())
}

export function supportsThinking(model: string): boolean {
  return MODELS_WITH_THINKING.includes(model.toLowerCase())
}

/**
 * Get the maximum temperature value for a model
 * @returns Maximum temperature value (1 or 2) or undefined if temperature not supported
 */
export function getMaxTemperature(model: string): number | undefined {
  return getMaxTempFromDefinitions(model)
}

export function supportsToolUsageControl(provider: string): boolean {
  return supportsToolUsageControlFromDefinitions(provider)
}

/**
 * Get reasoning effort values for a specific model
 * Returns the valid options for that model, or null if the model doesn't support reasoning effort
 */
export function getReasoningEffortValuesForModel(model: string): string[] | null {
  return getReasoningEffortValuesForModelFromDefinitions(model)
}

/**
 * Get verbosity values for a specific model
 * Returns the valid options for that model, or null if the model doesn't support verbosity
 */
export function getVerbosityValuesForModel(model: string): string[] | null {
  return getVerbosityValuesForModelFromDefinitions(model)
}

/**
 * Get thinking levels for a specific model
 * Returns the valid levels for that model, or null if the model doesn't support thinking
 */
export function getThinkingLevelsForModel(model: string): string[] | null {
  return getThinkingLevelsForModelFromDefinitions(model)
}

/**
 * Get max output tokens for a specific model.
 *
 * @param model - The model ID
 */
export function getMaxOutputTokensForModel(model: string): number {
  return getMaxOutputTokensForModelFromDefinitions(model)
}

/**
 * Prepare tool execution parameters, separating tool parameters from system parameters
 */
export function prepareToolExecution(
  tool: { params?: Record<string, any>; parameters?: Record<string, any> },
  llmArgs: Record<string, any>,
  request: {
    workflowId?: string
    workspaceId?: string
    chatId?: string
    userId?: string
    environmentVariables?: Record<string, any>
    workflowVariables?: Record<string, any>
    blockData?: Record<string, any>
    blockNameMapping?: Record<string, string>
    isDeployedContext?: boolean
  }
): {
  toolParams: Record<string, any>
  executionParams: Record<string, any>
} {
  // Use centralized merge logic from tools/params
  const toolParams = mergeToolParameters(tool.params || {}, llmArgs) as Record<string, any>

  const executionParams = {
    ...toolParams,
    ...(request.workflowId
      ? {
          _context: {
            workflowId: request.workflowId,
            ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
            ...(request.chatId ? { chatId: request.chatId } : {}),
            ...(request.userId ? { userId: request.userId } : {}),
            ...(request.isDeployedContext !== undefined
              ? { isDeployedContext: request.isDeployedContext }
              : {}),
          },
        }
      : {}),
    ...(request.environmentVariables ? { envVars: request.environmentVariables } : {}),
    ...(request.workflowVariables ? { workflowVariables: request.workflowVariables } : {}),
    ...(request.blockData ? { blockData: request.blockData } : {}),
    ...(request.blockNameMapping ? { blockNameMapping: request.blockNameMapping } : {}),
    ...(tool.parameters ? { _toolSchema: tool.parameters } : {}),
  }

  return { toolParams, executionParams }
}

/**
 * Creates a ReadableStream from an OpenAI-compatible streaming response.
 * This is a shared utility used by all OpenAI-compatible providers:
 * OpenAI, Groq, DeepSeek, xAI, OpenRouter, Mistral, Ollama, vLLM, Azure OpenAI, Cerebras
 *
 * @param stream - The async iterable stream from the provider
 * @param providerName - Name of the provider for logging purposes
 * @param onComplete - Optional callback called when stream completes with full content and usage
 * @returns A ReadableStream that can be used for streaming responses
 */
export function createOpenAICompatibleStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  providerName: string,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  const streamLogger = createLogger(`${providerName}Utils`)
  let fullContent = ''
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? 0
            completionTokens = chunk.usage.completion_tokens ?? 0
            totalTokens = chunk.usage.total_tokens ?? 0
          }

          const content = chunk.choices?.[0]?.delta?.content || ''
          if (content) {
            fullContent += content
            controller.enqueue(new TextEncoder().encode(content))
          }
        }

        if (onComplete) {
          if (promptTokens === 0 && completionTokens === 0) {
            streamLogger.warn(`${providerName} stream completed without usage data`)
          }
          onComplete(fullContent, {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens || promptTokens + completionTokens,
          })
        }

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

/**
 * Checks if a forced tool was used in an OpenAI-compatible response and updates tracking.
 * This is a shared utility used by OpenAI-compatible providers:
 * OpenAI, Groq, DeepSeek, xAI, OpenRouter, Mistral, Ollama, vLLM, Azure OpenAI, Cerebras
 *
 * @param response - The API response containing tool calls
 * @param toolChoice - The tool choice configuration (string or object)
 * @param providerName - Name of the provider for logging purposes
 * @param forcedTools - Array of forced tool names
 * @param usedForcedTools - Array of already used forced tools
 * @param customLogger - Optional custom logger instance
 * @returns Object with hasUsedForcedTool flag and updated usedForcedTools array
 */
export function checkForForcedToolUsageOpenAI(
  response: OpenAI.Chat.Completions.ChatCompletion,
  toolChoice: string | { type: string; function?: { name: string }; name?: string },
  providerName: string,
  forcedTools: string[],
  usedForcedTools: string[],
  customLogger?: Logger
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  const checkLogger = customLogger || createLogger(`${providerName}Utils`)
  let hasUsedForcedTool = false
  let updatedUsedForcedTools = [...usedForcedTools]

  if (typeof toolChoice === 'object' && response.choices[0]?.message?.tool_calls) {
    const toolCallsResponse = response.choices[0].message.tool_calls
    const result = trackForcedToolUsage(
      toolCallsResponse,
      toolChoice,
      checkLogger,
      providerName.toLowerCase().replace(/\s+/g, '-'),
      forcedTools,
      updatedUsedForcedTools
    )
    hasUsedForcedTool = result.hasUsedForcedTool
    updatedUsedForcedTools = result.usedForcedTools
  }

  return { hasUsedForcedTool, usedForcedTools: updatedUsedForcedTools }
}
