import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { anthropicProvider } from '@/providers/anthropic'
import { azureAnthropicProvider } from '@/providers/azure-anthropic'
import { azureOpenAIProvider } from '@/providers/azure-openai'
import { basetenProvider } from '@/providers/baseten'
import { bedrockProvider } from '@/providers/bedrock'
import { cerebrasProvider } from '@/providers/cerebras'
import { deepseekProvider } from '@/providers/deepseek'
import { fireworksProvider } from '@/providers/fireworks'
import { googleProvider } from '@/providers/google'
import { groqProvider } from '@/providers/groq'
import { litellmProvider } from '@/providers/litellm'
import { mistralProvider } from '@/providers/mistral'
import { ollamaProvider } from '@/providers/ollama'
import { ollamaCloudProvider } from '@/providers/ollama-cloud'
import { openaiProvider } from '@/providers/openai'
import { openRouterProvider } from '@/providers/openrouter'
import { togetherProvider } from '@/providers/together'
import type { ProviderConfig, ProviderId } from '@/providers/types'
import { vertexProvider } from '@/providers/vertex'
import { vllmProvider } from '@/providers/vllm'
import { xAIProvider } from '@/providers/xai'

const logger = createLogger('ProviderRegistry')

const providerRegistry: Record<ProviderId, ProviderConfig> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  'azure-anthropic': azureAnthropicProvider,
  google: googleProvider,
  vertex: vertexProvider,
  deepseek: deepseekProvider,
  xai: xAIProvider,
  cerebras: cerebrasProvider,
  groq: groqProvider,
  vllm: vllmProvider,
  litellm: litellmProvider,
  mistral: mistralProvider,
  'azure-openai': azureOpenAIProvider,
  openrouter: openRouterProvider,
  fireworks: fireworksProvider,
  together: togetherProvider,
  baseten: basetenProvider,
  ollama: ollamaProvider,
  'ollama-cloud': ollamaCloudProvider,
  bedrock: bedrockProvider,
}

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

export async function initializeProviders(): Promise<void> {
  for (const [id, provider] of Object.entries(providerRegistry)) {
    if (provider.initialize) {
      try {
        await provider.initialize()
        logger.info(`Initialized provider: ${id}`)
      } catch (error) {
        logger.error(`Failed to initialize ${id} provider`, {
          error: getErrorMessage(error, 'Unknown error'),
        })
      }
    }
  }
}
