/**
 * Knowledge-base view over the platform embedding catalog
 * (`@/lib/embeddings/catalog`). Knowledge bases store every vector at a fixed
 * width, so only catalog models flagged `kbEligible` are selectable here.
 * Selection happens server-side via the `KB_EMBEDDING_MODEL` env var; this
 * module resolves provider, tokenizer, and pricing metadata at runtime for any
 * model recorded on a knowledge base row.
 */

import {
  DEFAULT_EMBEDDING_MODEL as CATALOG_DEFAULT_EMBEDDING_MODEL,
  getEmbeddingModelInfo as getCatalogModelInfo,
  getKbEligibleModels,
  KB_EMBEDDING_DIMENSIONS,
} from '@/lib/embeddings/catalog'
import type { EmbeddingProviderKind, TokenizerProviderId } from '@/lib/embeddings/types'

export const EMBEDDING_DIMENSIONS = KB_EMBEDDING_DIMENSIONS

export const DEFAULT_EMBEDDING_MODEL = CATALOG_DEFAULT_EMBEDDING_MODEL

export type { EmbeddingProviderKind, TokenizerProviderId }

export interface EmbeddingModelInfo {
  provider: EmbeddingProviderKind
  /** Pricing/billing label — must match an entry in EMBEDDING_MODEL_PRICING when billed. */
  pricingId: string
  /** Provider id for `estimateTokenCount` so token counts match the embedding provider's tokenization. */
  tokenizerProvider: TokenizerProviderId
}

export const SUPPORTED_EMBEDDING_MODELS: Partial<Record<string, EmbeddingModelInfo>> =
  Object.fromEntries(
    getKbEligibleModels().map((id) => {
      const info = getCatalogModelInfo(id)
      return [
        id,
        {
          provider: info.provider,
          pricingId: info.pricingId,
          tokenizerProvider: info.tokenizerProvider,
        },
      ]
    })
  )

/**
 * Throws unless `model` is selectable for knowledge-base indexing. Call before
 * handing a model to `embed()` so an ineligible id fails here, naming the
 * knowledge-base constraint, rather than deeper in the provider path.
 */
export function assertKbEmbeddingModel(model: string): void {
  getEmbeddingModelInfo(model)
}

export function getEmbeddingModelInfo(model: string): EmbeddingModelInfo {
  const info = SUPPORTED_EMBEDDING_MODELS[model]
  if (!info) {
    /** Surfaces the catalog's error for unknown ids, and a KB-specific one for ineligible models. */
    getCatalogModelInfo(model)
    throw new Error(`Embedding model is not available for knowledge bases: ${model}`)
  }
  return info
}
