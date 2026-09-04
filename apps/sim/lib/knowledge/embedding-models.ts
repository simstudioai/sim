/**
 * Knowledge-base view over the platform embedding catalog
 * (`@/lib/embeddings/catalog`). A knowledge base stores every vector at one
 * fixed width chosen at creation, so only catalog models that can emit one of
 * the widths the `embedding` table has a column for are selectable here.
 * Selection happens server-side via the `KB_EMBEDDING_MODEL` and
 * `EMBEDDING_OUTPUT_DIMS` env vars; this module resolves provider, tokenizer,
 * width, and pricing metadata at runtime for any model recorded on a knowledge
 * base row.
 */

import {
  DEFAULT_EMBEDDING_MODEL as CATALOG_DEFAULT_EMBEDDING_MODEL,
  DEFAULT_KB_EMBEDDING_DIMENSIONS,
  findEmbeddingModelInfo,
  getEmbeddingModelInfo as getCatalogModelInfo,
  getKbEligibleModels,
  getKbEmbeddingDimensions,
  isKbEmbeddingDimensions,
  isOllamaEmbeddingModel,
  KB_EMBEDDING_STORAGE_DIMENSIONS,
  type KbEmbeddingDimensions,
} from '@/lib/embeddings/catalog'
import type { EmbeddingProviderKind, TokenizerProviderId } from '@/lib/embeddings/types'

export type { KbEmbeddingDimensions } from '@/lib/embeddings/catalog'
export {
  DEFAULT_KB_EMBEDDING_DIMENSIONS,
  isKbEmbeddingDimensions,
  KB_EMBEDDING_STORAGE_DIMENSIONS,
  MAX_KB_EMBEDDING_DIMENSIONS,
} from '@/lib/embeddings/catalog'

export const DEFAULT_EMBEDDING_MODEL = CATALOG_DEFAULT_EMBEDDING_MODEL

export type { EmbeddingProviderKind, TokenizerProviderId }

export interface EmbeddingModelInfo {
  provider: EmbeddingProviderKind
  /** Pricing/billing label — must match an entry in EMBEDDING_MODEL_PRICING when billed. */
  pricingId: string
  /** Provider id for `estimateTokenCount` so token counts match the embedding provider's tokenization. */
  tokenizerProvider: TokenizerProviderId
  /** Maximum tokens accepted for one embedding input by the selected model. */
  maxInputTokens: number
  /** Widths a knowledge base using this model can be created at, largest first. */
  dimensions: KbEmbeddingDimensions[]
}

function toKbModelInfo(model: string): EmbeddingModelInfo {
  const info = getCatalogModelInfo(model)
  return {
    provider: info.provider,
    pricingId: info.pricingId,
    tokenizerProvider: info.tokenizerProvider,
    maxInputTokens: info.maxInputTokens,
    dimensions: getKbEmbeddingDimensions(info),
  }
}

/**
 * Statically catalogued models selectable for knowledge-base indexing. Ollama
 * models are absent by construction — they are whatever the operator pulled
 * onto their own server — and resolve through {@link getEmbeddingModelInfo}
 * instead.
 */
export const SUPPORTED_EMBEDDING_MODELS: Partial<Record<string, EmbeddingModelInfo>> =
  Object.fromEntries(
    getKbEligibleModels()
      .map((id) => [id, toKbModelInfo(id)] as const)
      .filter(([, info]) => info.dimensions.length > 0)
  )

/**
 * Own-property lookup, not indexing: the record inherits from
 * `Object.prototype`, so `SUPPORTED_EMBEDDING_MODELS['toString']` would
 * otherwise resolve to an inherited function and read as a supported model.
 */
function findKbModelInfo(model: string): EmbeddingModelInfo | undefined {
  return Object.hasOwn(SUPPORTED_EMBEDDING_MODELS, model)
    ? SUPPORTED_EMBEDDING_MODELS[model]
    : undefined
}

/** True when `model` may be recorded on a knowledge base, whatever its width. */
export function isKbEmbeddingModel(model: string): boolean {
  if (isOllamaEmbeddingModel(model)) return findEmbeddingModelInfo(model) !== undefined
  return findKbModelInfo(model) !== undefined
}

/**
 * Throws unless `model` is selectable for knowledge-base indexing at `dimensions`.
 * Call before handing a model to `embed()` so an ineligible pairing fails here,
 * naming the knowledge-base constraint, rather than deeper in the provider path.
 */
export function assertKbEmbeddingModel(model: string, dimensions: number): void {
  const info = getEmbeddingModelInfo(model)
  if (!info.dimensions.includes(dimensions as KbEmbeddingDimensions)) {
    throw new Error(
      `${model} cannot produce ${dimensions}-dimensional embeddings. Supported: ${info.dimensions.join(', ')}`
    )
  }
}

export function getEmbeddingModelInfo(model: string): EmbeddingModelInfo {
  const info = findKbModelInfo(model)
  if (info) return info

  /**
   * An Ollama id is resolved rather than looked up, because Sim has no catalog
   * of what a given server has pulled. Every other unknown id surfaces the
   * catalog's error, and a catalogued but ineligible model gets a KB-specific
   * one.
   */
  if (isOllamaEmbeddingModel(model)) return toKbModelInfo(model)
  getCatalogModelInfo(model)
  throw new Error(`Embedding model is not available for knowledge bases: ${model}`)
}

/**
 * Narrows a persisted `knowledge_base.embedding_dimension` to a width the
 * `embedding` table has a column for. A base recorded at any other width cannot
 * be read or written, so this fails where the width is first used rather than
 * letting a column lookup come back undefined.
 */
export function toKbEmbeddingDimensions(value: number): KbEmbeddingDimensions {
  if (!isKbEmbeddingDimensions(value)) {
    throw new Error(
      `Knowledge base vector width ${value} has no storage column. Supported: ${KB_EMBEDDING_STORAGE_DIMENSIONS.join(', ')}`
    )
  }
  return value
}

/**
 * Width a knowledge base should be created at for `model` when the deployment
 * configured none, or configured one the model cannot emit. Prefers the
 * platform default so an unconfigured deployment keeps writing the column it
 * always has, and otherwise takes the model's largest storable width rather
 * than refusing to create a base at all.
 */
export function defaultKbEmbeddingDimensions(model: string): KbEmbeddingDimensions {
  const { dimensions } = getEmbeddingModelInfo(model)
  if (dimensions.includes(DEFAULT_KB_EMBEDDING_DIMENSIONS)) {
    return DEFAULT_KB_EMBEDDING_DIMENSIONS
  }
  const widest = dimensions[0]
  if (widest === undefined) {
    throw new Error(
      `${model} emits no width knowledge bases can store. Supported: ${KB_EMBEDDING_STORAGE_DIMENSIONS.join(', ')}`
    )
  }
  return widest
}
