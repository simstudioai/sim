/**
 * Public surface of the embeddings module. Kept to what callers outside this
 * directory actually use — the block imports `catalog` directly, because this
 * barrel re-exports the client and would drag BYOK lookup and `@sim/db` into the
 * browser bundle.
 */
export {
  DEFAULT_MODEL_BY_PROVIDER,
  findEmbeddingModelInfo,
  resolveDimensions,
} from '@/lib/embeddings/catalog'
export { embed } from '@/lib/embeddings/client'
export type { EmbeddingTaskType, EmbedOptions, EmbedResult } from '@/lib/embeddings/types'
