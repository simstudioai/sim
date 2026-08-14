import { createAzureOpenAIAdapter } from '@/lib/embeddings/providers/azure-openai'
import { createCohereAdapter } from '@/lib/embeddings/providers/cohere'
import { createGeminiAdapter } from '@/lib/embeddings/providers/gemini'
import { createMistralAdapter } from '@/lib/embeddings/providers/mistral'
import { createOpenAIAdapter } from '@/lib/embeddings/providers/openai'
import { createOpenRouterAdapter } from '@/lib/embeddings/providers/openrouter'
import type {
  AzureEmbeddingAdapterContext,
  EmbeddingAdapterFactory,
  EmbeddingProviderKind,
} from '@/lib/embeddings/types'

/** Azure's entry keeps its own context type so its routing fields stay required. */
type AdapterFactoryFor<K extends EmbeddingProviderKind> = K extends 'azure-openai'
  ? EmbeddingAdapterFactory<AzureEmbeddingAdapterContext>
  : EmbeddingAdapterFactory

const ADAPTER_FACTORIES: { [K in EmbeddingProviderKind]: AdapterFactoryFor<K> } = {
  openai: createOpenAIAdapter,
  'azure-openai': createAzureOpenAIAdapter,
  openrouter: createOpenRouterAdapter,
  gemini: createGeminiAdapter,
  cohere: createCohereAdapter,
  mistral: createMistralAdapter,
}

export function getAdapterFactory<K extends EmbeddingProviderKind>(
  provider: K
): AdapterFactoryFor<K> {
  return ADAPTER_FACTORIES[provider]
}

export {
  createAzureOpenAIAdapter,
  createCohereAdapter,
  createGeminiAdapter,
  createMistralAdapter,
  createOpenAIAdapter,
  createOpenRouterAdapter,
}
