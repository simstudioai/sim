import { createAzureOpenAIAdapter } from '@/lib/embeddings/providers/azure-openai'
import { createCohereAdapter } from '@/lib/embeddings/providers/cohere'
import { createGeminiAdapter } from '@/lib/embeddings/providers/gemini'
import { createMistralAdapter } from '@/lib/embeddings/providers/mistral'
import { createOpenAIAdapter } from '@/lib/embeddings/providers/openai'
import type { EmbeddingAdapterFactory, EmbeddingProviderKind } from '@/lib/embeddings/types'

const ADAPTER_FACTORIES: Record<EmbeddingProviderKind, EmbeddingAdapterFactory> = {
  openai: createOpenAIAdapter,
  'azure-openai': createAzureOpenAIAdapter,
  gemini: createGeminiAdapter,
  cohere: createCohereAdapter,
  mistral: createMistralAdapter,
}

export function getAdapterFactory(provider: EmbeddingProviderKind): EmbeddingAdapterFactory {
  const factory = ADAPTER_FACTORIES[provider]
  if (!factory) {
    throw new Error(`No embedding adapter implemented for provider: ${provider}`)
  }
  return factory
}

export {
  createAzureOpenAIAdapter,
  createCohereAdapter,
  createGeminiAdapter,
  createMistralAdapter,
  createOpenAIAdapter,
}
