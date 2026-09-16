import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { getBYOKKey } from '@/lib/api-key/byok'
import { getRotatingApiKey } from '@/lib/core/config/api-keys'
import { env } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import {
  type ProviderIdentity,
  recordProviderCooldown,
  waitForProviderAdmission,
} from '@/lib/core/rate-limiter/provider-admission'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  attachRetryHeaders,
  isRetryableError,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'
import {
  projectKnowledgeModelInput,
  projectKnowledgeModelInputs,
} from '@/lib/knowledge/model-input-provenance'
import { isSupportedRerankerModel } from '@/lib/knowledge/reranker-models'

const logger = createLogger('Reranker')

const RERANK_OPERATION_TIMEOUT_MS = 30_000

/**
 * Cohere bills per "search unit" = one query with up to 100 documents.
 * We cap at 100 so each rerank call costs exactly 1 unit and matches
 * `RERANK_MODEL_PRICING` in `providers/models.ts`. The search route also
 * caps `candidateTopK` at 100, so this is a defensive ceiling.
 */
const MAX_DOCUMENTS_PER_RERANK = 100

export interface RerankItem {
  /** Stable identifier so callers can correlate ranked results back to source rows. */
  id: string
  text: string
}

interface RerankedResult<T extends RerankItem> {
  item: T
  relevanceScore: number
}

export interface RerankResponse<T extends RerankItem> {
  results: RerankedResult<T>[]
  /** True when a workspace-supplied (BYOK) Cohere key was used. Callers should skip platform billing in that case. */
  isBYOK: boolean
}

class RerankAPIError extends Error {
  public status: number
  retryAfterMs?: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'RerankAPIError'
    this.status = status
  }
}

async function resolveCohereKey(
  workspaceId?: string | null,
  userApiKey?: string
): Promise<{ apiKey: string; isBYOK: boolean }> {
  /**
   * Mirrors the agent block hosted-key pattern (`injectHostedKeyIfNeeded`):
   * on self-hosted the user-supplied key from the block field flows through
   * unchanged; on hosted Sim we always source the key from workspace BYOK or
   * platform env, so any user-supplied value is ignored.
   */
  if (!isHosted && userApiKey) {
    return { apiKey: userApiKey, isBYOK: false }
  }
  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, 'cohere')
    if (byokResult) {
      logger.info('Using BYOK key for Cohere reranker', { scope: byokResult.scope })
      return { apiKey: byokResult.apiKey, isBYOK: true }
    }
  }
  if (env.COHERE_API_KEY) {
    return { apiKey: env.COHERE_API_KEY, isBYOK: false }
  }
  try {
    return { apiKey: getRotatingApiKey('cohere'), isBYOK: false }
  } catch {
    throw new Error(
      'No Cohere API key configured. Set COHERE_API_KEY_1/2/3 (rotation) or COHERE_API_KEY.'
    )
  }
}

/**
 * Subset of Cohere v2/rerank response fields we read.
 * Reference: https://docs.cohere.com/v2/reference/rerank
 * - `results[].index` maps back to the position in the documents we sent.
 * - `results[].relevance_score` is normalized 0–1.
 * - `meta.warnings` is documented as an array of strings; we surface them in logs
 *   so issues like document truncation don't disappear silently.
 */
interface CohereRerankResponse {
  results: Array<{ index: number; relevance_score: number }>
  meta?: {
    warnings?: string[]
  }
}

/**
 * Rerank documents against a query using Cohere's `/v2/rerank` endpoint.
 * Returns the items in descending order of relevance, capped at `topN`.
 */
export async function rerank<T extends RerankItem>(
  query: string,
  items: T[],
  options: {
    model: string
    topN?: number
    workspaceId?: string | null
    /** User-supplied Cohere key from the Knowledge block field. Honored only on self-hosted. */
    apiKey?: string
    signal?: AbortSignal
  }
): Promise<RerankResponse<T>> {
  options.signal?.throwIfAborted()
  if (items.length === 0) return { results: [], isBYOK: false }

  if (!isSupportedRerankerModel(options.model)) {
    throw new Error(`Unsupported reranker model: ${options.model}`)
  }

  const { apiKey, isBYOK } = await resolveCohereKey(options.workspaceId, options.apiKey)
  const cappedItems =
    items.length > MAX_DOCUMENTS_PER_RERANK ? items.slice(0, MAX_DOCUMENTS_PER_RERANK) : items
  if (items.length > MAX_DOCUMENTS_PER_RERANK) {
    logger.warn(`Rerank input capped from ${items.length} to ${MAX_DOCUMENTS_PER_RERANK} documents`)
  }
  const modelQuery = projectKnowledgeModelInput(query)
  const documents = projectKnowledgeModelInputs(cappedItems.map((it) => it.text))

  const identity: ProviderIdentity = {
    operation: 'rerank',
    providerId: 'cohere',
    credentialFingerprint: sha256Hex(apiKey),
  }
  const deadlineAt = Date.now() + RERANK_OPERATION_TIMEOUT_MS
  let attempt = 0
  const response = await retryWithExponentialBackoff(
    async (signal) => {
      await waitForProviderAdmission({
        ...identity,
        signal,
        maxWaitMs: Math.max(0, deadlineAt - Date.now()),
      })
      attempt += 1
      const res = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          query: modelQuery,
          documents,
          top_n: options.topN ?? cappedItems.length,
        }),
        signal,
      })

      if (!res.ok) {
        const error = new RerankAPIError(`Cohere rerank failed: ${res.status}`, res.status)
        attachRetryHeaders(error, res.headers)
        try {
          if (res.status === 429) {
            error.retryAfterMs = backoffWithJitter(
              attempt,
              parseRetryAfter(res.headers.get('retry-after'), Number.POSITIVE_INFINITY),
              { baseMs: 500, maxMs: Number.MAX_SAFE_INTEGER }
            )
            await recordProviderCooldown(identity, error.retryAfterMs)
          }
          await readResponseTextWithLimit(res, {
            maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
            label: 'Cohere rerank error response',
            signal,
          })
        } finally {
          if (!res.bodyUsed) await res.body?.cancel().catch(() => undefined)
        }
        throw error
      }
      return (await readResponseJsonWithLimit(res, {
        maxBytes: 1024 * 1024,
        label: 'Cohere rerank response',
        signal,
      })) as CohereRerankResponse
    },
    {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 5000,
      retryBudgetMs: RERANK_OPERATION_TIMEOUT_MS,
      signal: options.signal,
      retryCondition: (error: unknown) => {
        if (options.signal?.aborted) return false
        if (error instanceof RerankAPIError) {
          return error.status === 429 || error.status >= 500
        }
        return isRetryableError(error)
      },
    }
  )

  if (response.meta?.warnings && response.meta.warnings.length > 0) {
    logger.warn('Cohere rerank returned warnings', {
      model: options.model,
      warnings: response.meta.warnings,
    })
  }

  return {
    results: response.results
      .filter((r) => r.index >= 0 && r.index < cappedItems.length)
      .map((r) => ({
        item: cappedItems[r.index],
        relevanceScore: r.relevance_score,
      })),
    isBYOK,
  }
}
