/**
 * Client-safe registry of Cohere rerank models supported by the platform.
 * Kept free of server imports so it can be imported into UI / block code.
 */

import { z } from 'zod'

/** Cohere rerank model identifiers we accept. Must match Cohere's model ids exactly. */
export const rerankerModelSchema = z.enum(['rerank-v4.0-pro', 'rerank-v4.0-fast', 'rerank-v3.5'])
export type RerankerModelId = z.output<typeof rerankerModelSchema>

export const SUPPORTED_RERANKER_MODELS = rerankerModelSchema.options

export const DEFAULT_RERANKER_MODEL: RerankerModelId = 'rerank-v4.0-fast'

export function isSupportedRerankerModel(model: string): model is RerankerModelId {
  return rerankerModelSchema.safeParse(model).success
}
