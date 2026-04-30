/**
 * Client-safe registry of embedding models supported by the platform.
 * Kept free of server imports so it can be imported into UI code.
 */

export const EMBEDDING_DIMENSIONS = 1536

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

export type EmbeddingProviderKind = 'openai' | 'azure-openai' | 'gemini'

export type TokenizerProviderId = 'openai' | 'google'

export interface EmbeddingModelInfo {
  provider: EmbeddingProviderKind
  /** Whether the provider supports requesting a custom output dimensionality. */
  supportsCustomDimensions: boolean
  /** Pricing/billing label — must match an entry in EMBEDDING_MODEL_PRICING when billed. */
  pricingId: string
  /** Provider id for `estimateTokenCount` so token counts match the embedding provider's tokenization. */
  tokenizerProvider: TokenizerProviderId
  label: string
  /** Short user-facing description shown in the KB creation UI. */
  description: string
}

export const SUPPORTED_EMBEDDING_MODELS: Record<string, EmbeddingModelInfo> = {
  'text-embedding-3-small': {
    provider: 'openai',
    supportsCustomDimensions: true,
    pricingId: 'text-embedding-3-small',
    tokenizerProvider: 'openai',
    label: 'OpenAI text-embedding-3-small',
    description: 'Cheapest. Good for English-heavy retrieval at low cost.',
  },
  'text-embedding-3-large': {
    provider: 'openai',
    supportsCustomDimensions: true,
    pricingId: 'text-embedding-3-large',
    tokenizerProvider: 'openai',
    label: 'OpenAI text-embedding-3-large',
    description: 'Slightly better quality than 3-small at ~6.5× the cost.',
  },
  'gemini-embedding-001': {
    provider: 'gemini',
    supportsCustomDimensions: true,
    pricingId: 'gemini-embedding-001',
    tokenizerProvider: 'google',
    label: 'Google gemini-embedding-001',
    description: 'Strong multilingual retrieval. Good cost/quality balance.',
  },
}

export const SUPPORTED_EMBEDDING_MODEL_IDS = Object.keys(SUPPORTED_EMBEDDING_MODELS) as Array<
  keyof typeof SUPPORTED_EMBEDDING_MODELS
>

export function getEmbeddingModelInfo(model: string): EmbeddingModelInfo {
  const info = SUPPORTED_EMBEDDING_MODELS[model]
  if (!info) {
    throw new Error(`Unsupported embedding model: ${model}`)
  }
  return info
}
