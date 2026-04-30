/**
 * Registry of embedding models supported by the platform.
 * Selection happens server-side via the `KB_EMBEDDING_MODEL` env var; this
 * registry exists to resolve provider, tokenizer, and pricing metadata at
 * runtime for any model recorded on a knowledge base row.
 */

export const EMBEDDING_DIMENSIONS = 1536 as const

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'

export type EmbeddingProviderKind = 'openai' | 'azure-openai' | 'gemini'

export type TokenizerProviderId = 'openai' | 'google'

export interface EmbeddingModelInfo {
  provider: EmbeddingProviderKind
  /** Pricing/billing label — must match an entry in EMBEDDING_MODEL_PRICING when billed. */
  pricingId: string
  /** Provider id for `estimateTokenCount` so token counts match the embedding provider's tokenization. */
  tokenizerProvider: TokenizerProviderId
}

export const SUPPORTED_EMBEDDING_MODELS: Partial<Record<string, EmbeddingModelInfo>> = {
  'text-embedding-3-small': {
    provider: 'openai',
    pricingId: 'text-embedding-3-small',
    tokenizerProvider: 'openai',
  },
  'text-embedding-3-large': {
    provider: 'openai',
    pricingId: 'text-embedding-3-large',
    tokenizerProvider: 'openai',
  },
  'gemini-embedding-001': {
    provider: 'gemini',
    pricingId: 'gemini-embedding-001',
    tokenizerProvider: 'google',
  },
}

export function getEmbeddingModelInfo(model: string): EmbeddingModelInfo {
  const info = SUPPORTED_EMBEDDING_MODELS[model]
  if (!info) {
    throw new Error(`Unsupported embedding model: ${model}`)
  }
  return info
}
