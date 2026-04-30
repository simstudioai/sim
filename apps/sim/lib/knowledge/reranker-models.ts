/**
 * Client-safe registry of Cohere rerank models supported by the platform.
 * Kept free of server imports so it can be imported into UI / block code.
 */

/** Cohere rerank model identifiers we accept. Must match Cohere's model ids exactly. */
export const SUPPORTED_RERANKER_MODELS = [
  'rerank-v4.0-pro',
  'rerank-v4.0-fast',
  'rerank-v3.5',
] as const
export type RerankerModelId = (typeof SUPPORTED_RERANKER_MODELS)[number]

export const DEFAULT_RERANKER_MODEL: RerankerModelId = 'rerank-v4.0-fast'

export function isSupportedRerankerModel(model: string): model is RerankerModelId {
  return (SUPPORTED_RERANKER_MODELS as readonly string[]).includes(model)
}
