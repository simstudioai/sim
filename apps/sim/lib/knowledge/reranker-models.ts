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

/**
 * What the reranker actually did on a search, reported on every response.
 *
 * Reranking is best-effort by design: a provider outage, a timeout, or a
 * deployment with no Cohere credential falls back to vector ordering so the
 * search still answers. Without this field that fallback is invisible — the
 * caller gets a 200, results in plain vector order, and no `rerankerScore` on
 * any of them, which is indistinguishable from a reranker that ran and happened
 * to agree with the vector order. Reporting the outcome is what makes a
 * degradation detectable instead of a silent lie.
 *
 * - `not_requested` — `rerankerEnabled` was absent or false.
 * - `skipped` — requested, but there was nothing to rank: a tag-only search has
 *   no query text to rank against, and a search that matched nothing has no
 *   candidates.
 * - `unavailable` — requested and attempted, but the reranker could not
 *   complete. Results are in vector order and carry no `rerankerScore`.
 * - `applied` — the reranker ordered the results, which carry `rerankerScore`.
 */
export const rerankerStatusSchema = z.enum(['not_requested', 'skipped', 'unavailable', 'applied'])
export type RerankerStatus = z.output<typeof rerankerStatusSchema>
