export { processWithConcurrency, splitByItemLimit } from '@/lib/embeddings/batching'
export {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_MODELS,
  EMBEDDING_TASK_TYPES,
  type EmbeddingModelInfo,
  findEmbeddingModelInfo,
  getEmbeddingModelInfo,
  getKbEligibleModels,
  getModelsForProvider,
  hasApproximateTokenCount,
  KB_EMBEDDING_DIMENSIONS,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
export { EmbeddingAPIError, embed } from '@/lib/embeddings/client'
export { resolveProviderKey } from '@/lib/embeddings/keys'
export { l2Normalize } from '@/lib/embeddings/normalize'
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
