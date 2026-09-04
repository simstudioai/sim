import type {
  EmbeddingCatalogProvider,
  EmbeddingTaskType,
  KeyedEmbeddingProvider,
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
 * Widths the `embedding` table has a pgvector column for, largest first.
 *
 * A knowledge base pins one of these at creation and every chunk in it is
 * stored in the matching column, so a model used for KB indexing must emit
 * vectors of exactly the width its base was created with. The set covers the
 * sizes the popular embedding models actually emit: 384 (all-minilm and the
 * small Sentence Transformers), 768 (nomic-embed-text, embeddinggemma, most
 * open-weight models), 1024 (mxbai-embed-large, bge-m3, qwen3-embedding,
 * Voyage), 1536 (OpenAI's small model), and 3072 (OpenAI's large model and
 * gemini-embedding-001).
 */
export const KB_EMBEDDING_STORAGE_DIMENSIONS = [3072, 1536, 1024, 768, 384] as const

export type KbEmbeddingDimensions = (typeof KB_EMBEDDING_STORAGE_DIMENSIONS)[number]

/**
 * Width a knowledge base is created at when the deployment names no other one.
 * Matches the `embedding.embedding` column every base predating multi-width
 * storage was written into, so an unconfigured deployment keeps its behavior.
 */
export const DEFAULT_KB_EMBEDDING_DIMENSIONS = 1536 as const

export function isKbEmbeddingDimensions(value: number): value is KbEmbeddingDimensions {
  return (KB_EMBEDDING_STORAGE_DIMENSIONS as readonly number[]).includes(value)
}

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
   * Selectable for knowledge-base indexing. Requires the model to emit at least
   * one width in {@link KB_EMBEDDING_STORAGE_DIMENSIONS}; a model that can is
   * still opted out here when it is superseded and only kept for placed blocks.
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

/**
 * Providers a user can pick, in the order the block offers them. Ollama is
 * absent because its models are whatever the operator has pulled onto their own
 * server, which no static catalog can enumerate; it is reachable through the
 * `ollama/` model prefix that {@link findEmbeddingModelInfo} resolves.
 */
export const EMBEDDING_CATALOG_PROVIDERS: readonly KeyedEmbeddingProvider[] = [
  'openai',
  'gemini',
  'cohere',
  'mistral',
] as const

/**
 * Model each provider falls back to when the caller names none. Single source
 * for the block's pre-selected value, the per-provider tools, and the route.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<KeyedEmbeddingProvider, string> = {
  openai: DEFAULT_EMBEDDING_MODEL,
  gemini: 'gemini-embedding-001',
  cohere: 'embed-v4.0',
  mistral: 'mistral-embed',
}

/**
 * BYOK provider id for a workspace-owned key. Differs from the embedding
 * provider id for Gemini, whose keys are stored under the shared Google entry.
 */
export const BYOK_PROVIDER_IDS: Record<KeyedEmbeddingProvider, BYOKProviderId> = {
  openai: 'openai',
  gemini: 'google',
  cohere: 'cohere',
  mistral: 'mistral',
}

/**
 * Marks a model id as living on the deployment's own Ollama server. The
 * remainder is passed to Ollama verbatim, so tags survive
 * (`ollama/mxbai-embed-large:335m`), matching how the OpenRouter transport
 * already namespaces ids it does not own.
 */
export const OLLAMA_EMBEDDING_MODEL_PREFIX = 'ollama/'

/**
 * Per-input token ceiling assumed for an Ollama model.
 *
 * Sim cannot know a local model's context length — it varies from 512
 * (mxbai-embed-large) to 8192 (nomic-embed-text, bge-m3) — so inputs are held
 * to the common upper figure and the adapter asks Ollama to truncate anything
 * the loaded model cannot fit. Ollama truncating is a silent shortening, but
 * the alternative is an outright rejection of input every other provider in the
 * catalog accepts.
 */
const OLLAMA_MAX_INPUT_TOKENS = 8192

export function isOllamaEmbeddingModel(model: string): boolean {
  return model.startsWith(OLLAMA_EMBEDDING_MODEL_PREFIX)
}

/** Model name as Ollama expects it on the wire, with the routing prefix removed. */
export function ollamaEmbeddingModelName(model: string): string {
  return model.slice(OLLAMA_EMBEDDING_MODEL_PREFIX.length)
}

/**
 * Routing id for a model on the deployment's Ollama. Tolerant of a value that
 * already carries the prefix, so an operator who writes
 * `KB_EMBEDDING_MODEL=ollama/nomic-embed-text` and a block that stores the bare
 * name Ollama itself lists both resolve to the same id.
 */
export function toOllamaEmbeddingModelId(model: string): string {
  const name = (isOllamaEmbeddingModel(model) ? ollamaEmbeddingModelName(model) : model).trim()
  if (!name) throw new Error('Ollama embedding model name is required')
  return `${OLLAMA_EMBEDDING_MODEL_PREFIX}${name}`
}

/**
 * Metadata for a model served by the deployment's own Ollama instance.
 *
 * Ollama publishes no catalog Sim can read at module load, so the entry is
 * synthesized: every storage width is offered, and `nativeDimensions` is the
 * platform default only so a caller that requests no width still names one.
 * The model's real width is whatever it emits, and the client's response
 * validation is what enforces the match — a base created at 768 whose model
 * returns 1024 fails with both numbers rather than writing a wrong-width vector.
 */
function buildOllamaEmbeddingModelInfo(model: string): EmbeddingModelInfo | undefined {
  const name = ollamaEmbeddingModelName(model)
  if (!name) return undefined
  return {
    provider: 'ollama',
    label: name,
    /** No entry in EMBEDDING_MODEL_PRICING: local inference costs Sim nothing. */
    pricingId: model,
    tokenizerProvider: 'ollama',
    nativeDimensions: DEFAULT_KB_EMBEDDING_DIMENSIONS,
    supportedDimensions: KB_EMBEDDING_STORAGE_DIMENSIONS,
    maxInputTokens: OLLAMA_MAX_INPUT_TOKENS,
    kbEligible: true,
  }
}

export function getEmbeddingModelInfo(model: string): EmbeddingModelInfo {
  const info = findEmbeddingModelInfo(model)
  if (!info) {
    throw new Error(`Unsupported embedding model: ${model}`)
  }
  return info
}

export function findEmbeddingModelInfo(model: string): EmbeddingModelInfo | undefined {
  if (isOllamaEmbeddingModel(model)) return buildOllamaEmbeddingModelInfo(model)
  return EMBEDDING_MODELS[model]
}

export function getModelsForProvider(provider: KeyedEmbeddingProvider): string[] {
  return Object.keys(EMBEDDING_MODELS).filter((id) => EMBEDDING_MODELS[id].provider === provider)
}

/** Model ids selectable for knowledge-base indexing. */
export function getKbEligibleModels(): string[] {
  return Object.keys(EMBEDDING_MODELS).filter((id) => EMBEDDING_MODELS[id].kbEligible)
}

/**
 * Storage widths a model can be indexed at, largest first — the intersection of
 * what it emits with what the `embedding` table has a column for. Empty when the
 * model emits no width knowledge bases can store, which is what makes it
 * unusable for indexing regardless of its {@link EmbeddingModelInfo.kbEligible}
 * flag.
 */
export function getKbEmbeddingDimensions(info: EmbeddingModelInfo): KbEmbeddingDimensions[] {
  const emitted = info.supportedDimensions ?? [info.nativeDimensions]
  return KB_EMBEDDING_STORAGE_DIMENSIONS.filter((width) => emitted.includes(width))
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
  /**
   * A local model's width is whatever the operator pulled, and Ollama publishes
   * no catalog Sim can enumerate at module load, so any positive width is taken
   * at face value here. It is not unchecked: the caller reads the real width off
   * `/api/show` (or, for a knowledge base, off the row it stores into), and the
   * client's response validation rejects a model that returns anything else.
   */
  if (info.provider === 'ollama') {
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new Error(`${info.label} cannot produce ${requested}-dimensional output`)
    }
    return requested
  }
  if (!info.supportedDimensions?.includes(requested)) {
    throw new Error(
      `${info.label} does not support ${requested}-dimensional output. Supported: ${
        info.supportedDimensions?.join(', ') ?? info.nativeDimensions
      }`
    )
  }
  return requested
}
