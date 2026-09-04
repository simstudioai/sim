import { createAzureOpenAIAdapter } from '@/lib/embeddings/providers/azure-openai'
import { createCohereAdapter } from '@/lib/embeddings/providers/cohere'
import { createGeminiAdapter } from '@/lib/embeddings/providers/gemini'
import { createMistralAdapter } from '@/lib/embeddings/providers/mistral'
import { createOllamaAdapter } from '@/lib/embeddings/providers/ollama'
import { createOpenAIAdapter } from '@/lib/embeddings/providers/openai'
import { createOpenRouterAdapter } from '@/lib/embeddings/providers/openrouter'
import type {
  AzureEmbeddingAdapterContext,
  EmbeddingAdapterFactory,
  EmbeddingProviderKind,
  OllamaEmbeddingAdapterContext,
} from '@/lib/embeddings/types'

/**
 * Azure and Ollama keep their own context types so their routing fields stay
 * required and, for Ollama, so no caller can hand it a credential it has no way
 * to send.
 */
type AdapterFactoryFor<K extends EmbeddingProviderKind> = K extends 'azure-openai'
  ? EmbeddingAdapterFactory<AzureEmbeddingAdapterContext>
  : K extends 'ollama'
    ? EmbeddingAdapterFactory<OllamaEmbeddingAdapterContext>
    : EmbeddingAdapterFactory

const ADAPTER_FACTORIES: { [K in EmbeddingProviderKind]: AdapterFactoryFor<K> } = {
  openai: createOpenAIAdapter,
  'azure-openai': createAzureOpenAIAdapter,
  openrouter: createOpenRouterAdapter,
  gemini: createGeminiAdapter,
  cohere: createCohereAdapter,
  mistral: createMistralAdapter,
  ollama: createOllamaAdapter,
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
  createOllamaAdapter,
  createOpenAIAdapter,
  createOpenRouterAdapter,
}
