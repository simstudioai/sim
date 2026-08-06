import type {
  EmbeddingCatalogProvider,
  EmbeddingTaskType,
  TokenizerProviderId,
} from '@/lib/embeddings/types'

/**
 * Single source of truth for embedding models across the platform: the
 * knowledge-base indexing path, the Embeddings block, and pricing lookups all
 * resolve model metadata from here.
 */

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

/**
 * Dimensionality every knowledge-base vector is stored at. The pgvector column
 * is fixed at this width, so any model used for KB indexing must be able to
 * emit vectors of exactly this size.
 */
export const KB_EMBEDDING_DIMENSIONS = 1536 as const

export interface EmbeddingModelInfo {
  provider: EmbeddingCatalogProvider
  /** Human-readable label for the block's model dropdown. */
  label: string
  /** Pricing/billing label - must match an entry in EMBEDDING_MODEL_PRICING when billed. */
  pricingId: string
  tokenizerProvider: TokenizerProviderId
  /** Dimensionality the model emits when no reduction is requested. */
  nativeDimensions: number
  /**
   * Output dimensions the model can be truncated to (Matryoshka representation
   * learning), native size first. Omitted when the model has a fixed size.
   */
  supportedDimensions?: readonly number[]
  /**
   * Task types this model can condition on, so the block only ever offers what
   * the provider actually accepts. Omitted when the model has no task
   * conditioning.
   */
  supportedTaskTypes?: readonly EmbeddingTaskType[]
  /** Provider's per-input token ceiling. */
  maxInputTokens: number
  /** Hard per-request item cap enforced by the provider. */
  maxItemsPerRequest?: number
  /**
   * Selectable for knowledge-base indexing. Requires the model to emit exactly
   * KB_EMBEDDING_DIMENSIONS.
   */
  kbEligible: boolean
}

export const EMBEDDING_MODELS: Record<string, EmbeddingModelInfo> = {
  'text-embedding-3-small': {
    provider: 'openai',
    label: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
    tokenizerProvider: 'openai',
    nativeDimensions: 1536,
    supportedDimensions: [1536, 1024, 768, 512, 256],
    maxInputTokens: 8191,
    kbEligible: true,
  },
  'text-embedding-3-large': {
    provider: 'openai',
    label: 'text-embedding-3-large',
    pricingId: 'text-embedding-3-large',
    tokenizerProvider: 'openai',
    nativeDimensions: 3072,
    supportedDimensions: [3072, 1536, 1024, 768, 512, 256],
    maxInputTokens: 8191,
    kbEligible: true,
  },
  /**
   * Superseded by the v3 models and not offered for knowledge bases, but kept
   * in the catalog because the legacy Embeddings block still lists it and
   * placed instances must keep resolving.
   */
  'text-embedding-ada-002': {
    provider: 'openai',
    label: 'text-embedding-ada-002',
    pricingId: 'text-embedding-ada-002',
    tokenizerProvider: 'openai',
    nativeDimensions: 1536,
    maxInputTokens: 8191,
    kbEligible: false,
  },
  'gemini-embedding-001': {
    provider: 'gemini',
    label: 'gemini-embedding-001',
    pricingId: 'gemini-embedding-001',
    tokenizerProvider: 'google',
    nativeDimensions: 3072,
    supportedDimensions: [3072, 1536, 768],
    supportedTaskTypes: ['document', 'query', 'similarity', 'classification', 'clustering'],
    maxInputTokens: 2048,
    maxItemsPerRequest: 100,
    kbEligible: true,
  },
  /** Cohere has no dedicated semantic-similarity input type, so it is not offered. */
  'embed-v4.0': {
    provider: 'cohere',
    label: 'embed-v4.0',
    pricingId: 'embed-v4.0',
    tokenizerProvider: 'cohere',
    nativeDimensions: 1536,
    supportedDimensions: [1536, 1024, 512, 256],
    supportedTaskTypes: ['document', 'query', 'classification', 'clustering'],
    maxInputTokens: 128_000,
    maxItemsPerRequest: 96,
    kbEligible: false,
  },
  'mistral-embed': {
    provider: 'mistral',
    label: 'mistral-embed',
    pricingId: 'mistral-embed',
    tokenizerProvider: 'mistral',
    nativeDimensions: 1024,
    maxInputTokens: 8192,
    kbEligible: false,
  },
  /** `output_dimension` may go up to 3072, but 1536 is the model's default. */
  'codestral-embed': {
    provider: 'mistral',
    label: 'codestral-embed',
    pricingId: 'codestral-embed',
    tokenizerProvider: 'mistral',
    nativeDimensions: 1536,
    supportedDimensions: [1536, 1024, 512, 256],
    maxInputTokens: 8192,
    kbEligible: false,
  },
}

export function getEmbeddingModelInfo(model: string): EmbeddingModelInfo {
  const info = EMBEDDING_MODELS[model]
  if (!info) {
    throw new Error(`Unsupported embedding model: ${model}`)
  }
  return info
}

export function findEmbeddingModelInfo(model: string): EmbeddingModelInfo | undefined {
  return EMBEDDING_MODELS[model]
}

export function getModelsForProvider(provider: EmbeddingCatalogProvider): string[] {
  return Object.keys(EMBEDDING_MODELS).filter((id) => EMBEDDING_MODELS[id].provider === provider)
}

/** Model ids selectable for knowledge-base indexing. */
export function getKbEligibleModels(): string[] {
  return Object.keys(EMBEDDING_MODELS).filter((id) => EMBEDDING_MODELS[id].kbEligible)
}

/**
 * Resolves the dimensionality a request will actually produce, given an
 * optional caller-requested reduction.
 */
/**
 * True when a model's tokens cannot be counted exactly.
 *
 * Batching measures with tiktoken, which only has encodings for OpenAI models —
 * every other id falls back to `cl100k_base`, so a Gemini, Cohere, or Mistral
 * ceiling is enforced in approximate units. The ceiling is still applied
 * exactly as declared: discounting it to absorb the error would truncate valid
 * content silently, which is worse than the alternative it guards against. An
 * undercount surfaces as a provider rejection, which is visible and
 * actionable; silently shortening an embedding's input is not.
 */
export function hasApproximateTokenCount(info: EmbeddingModelInfo): boolean {
  return info.tokenizerProvider !== 'openai'
}

export function resolveDimensions(info: EmbeddingModelInfo, requested?: number): number {
  if (requested === undefined) return info.nativeDimensions
  if (!info.supportedDimensions?.includes(requested)) {
    throw new Error(
      `${info.label} does not support ${requested}-dimensional output. Supported: ${
        info.supportedDimensions?.join(', ') ?? info.nativeDimensions
      }`
    )
  }
  return requested
}

/**
 * Task types the block should offer for a given model. Providers without
 * task conditioning get an empty list so the sub-block stays hidden.
 */
export const EMBEDDING_TASK_TYPES: readonly EmbeddingTaskType[] = [
  'document',
  'query',
  'similarity',
  'classification',
  'clustering',
] as const
