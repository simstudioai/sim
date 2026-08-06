import type {
  EmbeddingCatalogProvider,
  EmbeddingTaskType,
  TokenizerProviderId,
} from '@/lib/embeddings/types'
import type { BYOKProviderId } from '@/tools/types'

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

/**
 * OpenAI caps a single `/v1/embeddings` call at 300,000 tokens summed across all
 * inputs, independent of the 8192-token per-input ceiling.
 */
const OPENAI_MAX_TOKENS_PER_REQUEST = 300_000

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
   * Output dimensions the model can emit, largest first — the block renders this
   * list in order. Omitted when the model has a fixed size.
   *
   * This is not required to lead with {@link nativeDimensions}: a model whose
   * API default sits below its maximum (codestral-embed defaults to 1536 and
   * tops out at 3072) offers sizes on both sides of its default.
   */
  supportedDimensions?: readonly number[]
  /**
   * Task types this model can condition on, so the block only ever offers what
   * the provider actually accepts. Omitted when the model has no task
   * conditioning.
   */
  supportedTaskTypes?: readonly EmbeddingTaskType[]
  /** Provider's per-input token ceiling. Longer inputs are truncated to fit. */
  maxInputTokens: number
  /**
   * Provider's ceiling on tokens summed across every input in one request, which
   * is a different limit from {@link maxInputTokens} and bounds how many inputs
   * may share a batch. Omitted when the provider documents no such figure; the
   * client then applies a conservative default rather than an invented number.
   */
  maxTokensPerRequest?: number
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
    maxInputTokens: 8192,
    maxTokensPerRequest: OPENAI_MAX_TOKENS_PER_REQUEST,
    kbEligible: true,
  },
  'text-embedding-3-large': {
    provider: 'openai',
    label: 'text-embedding-3-large',
    pricingId: 'text-embedding-3-large',
    tokenizerProvider: 'openai',
    nativeDimensions: 3072,
    supportedDimensions: [3072, 1536, 1024, 768, 512, 256],
    maxInputTokens: 8192,
    maxTokensPerRequest: OPENAI_MAX_TOKENS_PER_REQUEST,
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
    maxInputTokens: 8192,
    maxTokensPerRequest: OPENAI_MAX_TOKENS_PER_REQUEST,
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
  /**
   * `output_dimension` tops out at 3072 while the API default is 1536, so the
   * offered sizes straddle the default rather than starting at it.
   */
  'codestral-embed': {
    provider: 'mistral',
    label: 'codestral-embed',
    pricingId: 'codestral-embed',
    tokenizerProvider: 'mistral',
    nativeDimensions: 1536,
    supportedDimensions: [3072, 1536, 1024, 512, 256],
    maxInputTokens: 8192,
    kbEligible: false,
  },
}

/** Providers a user can pick, in the order the block offers them. */
export const EMBEDDING_CATALOG_PROVIDERS: readonly EmbeddingCatalogProvider[] = [
  'openai',
  'gemini',
  'cohere',
  'mistral',
] as const

/**
 * Model each provider falls back to when the caller names none. Single source
 * for the block's pre-selected value, the per-provider tools, and the route.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<EmbeddingCatalogProvider, string> = {
  openai: DEFAULT_EMBEDDING_MODEL,
  gemini: 'gemini-embedding-001',
  cohere: 'embed-v4.0',
  mistral: 'mistral-embed',
}

/**
 * BYOK provider id for a workspace-owned key. Differs from the embedding
 * provider id for Gemini, whose keys are stored under the shared Google entry.
 */
export const BYOK_PROVIDER_IDS: Record<EmbeddingCatalogProvider, BYOKProviderId> = {
  openai: 'openai',
  gemini: 'google',
  cohere: 'cohere',
  mistral: 'mistral',
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
 * True when a model's tokens cannot be counted exactly.
 *
 * Batching measures with tiktoken, which only has encodings for OpenAI models —
 * every other id falls back to `cl100k_base`, so Gemini, Cohere, and Mistral
 * ceilings are enforced in approximate units. The ceiling is still applied as
 * declared rather than discounted to absorb the error: an undercount surfaces
 * as a visible provider rejection, whereas silently shortening an embedding's
 * input does not.
 */
export function hasApproximateTokenCount(info: EmbeddingModelInfo): boolean {
  return info.tokenizerProvider !== 'openai'
}

/**
 * Resolves the dimensionality a request will actually produce, given an
 * optional caller-requested reduction.
 */
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
