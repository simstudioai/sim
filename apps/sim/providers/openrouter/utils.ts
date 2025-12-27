import { createLogger } from '@sim/logger'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources/completions'
import { checkForForcedToolUsageOpenAI, createOpenAICompatibleStream } from '@/providers/utils'

const logger = createLogger('OpenRouterUtils')

interface OpenRouterModelData {
  id: string
  supported_parameters?: string[]
}

interface ModelCapabilities {
  supportsStructuredOutputs: boolean
  supportsTools: boolean
}

let modelCapabilitiesCache: Map<string, ModelCapabilities> | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Fetches and caches OpenRouter model capabilities from their API.
 */
async function fetchModelCapabilities(): Promise<Map<string, ModelCapabilities>> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch OpenRouter model capabilities', {
        status: response.status,
      })
      return new Map()
    }

    const data = await response.json()
    const capabilities = new Map<string, ModelCapabilities>()

    for (const model of (data.data ?? []) as OpenRouterModelData[]) {
      const supportedParams = model.supported_parameters ?? []
      capabilities.set(model.id, {
        supportsStructuredOutputs: supportedParams.includes('structured_outputs'),
        supportsTools: supportedParams.includes('tools'),
      })
    }

    logger.info('Cached OpenRouter model capabilities', {
      modelCount: capabilities.size,
      withStructuredOutputs: Array.from(capabilities.values()).filter(
        (c) => c.supportsStructuredOutputs
      ).length,
    })

    return capabilities
  } catch (error) {
    logger.error('Error fetching OpenRouter model capabilities', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new Map()
  }
}

/**
 * Gets capabilities for a specific OpenRouter model.
 * Fetches from API if cache is stale or empty.
 */
export async function getOpenRouterModelCapabilities(
  modelId: string
): Promise<ModelCapabilities | null> {
  const now = Date.now()

  if (!modelCapabilitiesCache || now - cacheTimestamp > CACHE_TTL_MS) {
    modelCapabilitiesCache = await fetchModelCapabilities()
    cacheTimestamp = now
  }

  const normalizedId = modelId.replace(/^openrouter\//, '')
  return modelCapabilitiesCache.get(normalizedId) ?? null
}

/**
 * Checks if a model supports native structured outputs (json_schema).
 */
export async function supportsNativeStructuredOutputs(modelId: string): Promise<boolean> {
  const capabilities = await getOpenRouterModelCapabilities(modelId)
  return capabilities?.supportsStructuredOutputs ?? false
}

/**
 * Creates a ReadableStream from an OpenRouter streaming response.
 * Uses the shared OpenAI-compatible streaming utility.
 */
export function createReadableStreamFromOpenAIStream(
  openaiStream: AsyncIterable<ChatCompletionChunk>,
  onComplete?: (content: string, usage: CompletionUsage) => void
): ReadableStream<Uint8Array> {
  return createOpenAICompatibleStream(openaiStream, 'OpenRouter', onComplete)
}

/**
 * Checks if a forced tool was used in an OpenRouter response.
 * Uses the shared OpenAI-compatible forced tool usage helper.
 */
export function checkForForcedToolUsage(
  response: any,
  toolChoice: string | { type: string; function?: { name: string }; name?: string; any?: any },
  forcedTools: string[],
  usedForcedTools: string[]
): { hasUsedForcedTool: boolean; usedForcedTools: string[] } {
  return checkForForcedToolUsageOpenAI(
    response,
    toolChoice,
    'OpenRouter',
    forcedTools,
    usedForcedTools
  )
}
