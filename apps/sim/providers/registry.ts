/**
 * Server-only provider registry
 *
 * This module contains the actual provider implementations with executeRequest functions.
 * It should ONLY be imported from server-side code (API routes, executor handlers, etc.)
 *
 * Client-side code should use @/providers/utils for model lists and metadata.
 */

import { createLogger } from '@/lib/logs/console/logger'
import { anthropicProvider } from '@/providers/anthropic'
import { azureOpenAIProvider } from '@/providers/azure-openai'
import { cerebrasProvider } from '@/providers/cerebras'
import { deepseekProvider } from '@/providers/deepseek'
import { googleProvider } from '@/providers/google'
import { groqProvider } from '@/providers/groq'
import { mistralProvider } from '@/providers/mistral'
import { ollamaProvider } from '@/providers/ollama'
import { openaiProvider } from '@/providers/openai'
import { openRouterProvider } from '@/providers/openrouter'
import type { ProviderConfig, ProviderId } from '@/providers/types'
import { vertexProvider } from '@/providers/vertex'
import { vllmProvider } from '@/providers/vllm'
import { xAIProvider } from '@/providers/xai'

const logger = createLogger('ProviderRegistry')

/**
 * Server-side provider registry with full implementations.
 * This includes executeRequest functions that use server-only dependencies.
 */
const providerRegistry: Record<ProviderId, ProviderConfig> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  vertex: vertexProvider,
  deepseek: deepseekProvider,
  xai: xAIProvider,
  cerebras: cerebrasProvider,
  groq: groqProvider,
  vllm: vllmProvider,
  mistral: mistralProvider,
  'azure-openai': azureOpenAIProvider,
  openrouter: openRouterProvider,
  ollama: ollamaProvider,
}

/**
 * Get a provider implementation for execution.
 * This returns the full provider config including executeRequest.
 *
 * @param providerId - The provider ID
 * @returns The provider config or undefined if not found
 */
export async function getProviderExecutor(
  providerId: ProviderId
): Promise<ProviderConfig | undefined> {
  const provider = providerRegistry[providerId]
  if (!provider) {
    logger.error(`Provider not found: ${providerId}`)
    return undefined
  }
  return provider
}

/**
 * Initialize all providers that have an initialize function.
 * Called at server startup.
 */
export async function initializeProviders(): Promise<void> {
  for (const [id, provider] of Object.entries(providerRegistry)) {
    if (provider.initialize) {
      try {
        await provider.initialize()
        logger.info(`Initialized provider: ${id}`)
      } catch (error) {
        logger.error(`Failed to initialize ${id} provider`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  }
}
