export {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  type EmbeddingModelInfo,
  findEmbeddingModelInfo,
  getEmbeddingModelInfo,
  getKbEligibleModels,
  getModelsForProvider,
  KB_EMBEDDING_DIMENSIONS,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
export { EmbeddingAPIError, embed } from '@/lib/embeddings/client'
export { resolveProviderKey } from '@/lib/embeddings/keys'
export { getAdapterFactory } from '@/lib/embeddings/providers'
export type {
  EmbeddingAdapterContext,
  EmbeddingCatalogProvider,
  EmbeddingProviderAdapter,
  EmbeddingProviderKind,
  EmbeddingTaskType,
  EmbedOptions,
  EmbedResult,
  TokenizerProviderId,
} from '@/lib/embeddings/types'
