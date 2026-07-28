import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import type { GuardrailsMaskBatchResult } from '@/lib/api/contracts'
import { generateInternalToken } from '@/lib/auth/internal'
import { env } from '@/lib/core/config/env'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { chunkIndicesByBudget } from '@/lib/guardrails/pii-batching'
import type { CustomPiiPattern } from '@/lib/guardrails/pii-entities'

/**
 * Max in-flight mask-batch requests per call. Each request is a CPU-heavy NER
 * batch — default 64, sized to saturate the load-balanced Presidio fleet behind
 * the internal ALB (which spreads each request across tasks). Effective throughput
 * is capped by fleet worker capacity, so past that this just queues; tune via
 * `PII_MASK_CHUNK_CONCURRENCY` to the fleet size (and lower to 1 for a single
 * self-hosted instance). No request timeout: masking a large batch is slow and the
 * (scaled) Presidio service is expected to eventually respond; an unreachable
 * service still rejects fast (connection refused) so the caller scrubs.
 */
const CHUNK_CONCURRENCY = env.PII_MASK_CHUNK_CONCURRENCY ?? 64

/**
 * Per-chunk retry budget for transient failures (network errors, 408/429/5xx).
 * A large payload fans out into many chunk requests, so a single blip — an ALB
 * 502 during a deploy, a Presidio pod restart — must not fail the whole
 * redaction (and, on the execution-altering stages, abort the run). With the
 * default 500ms→30s jittered backoff this rides out ~2 minutes of outage per
 * chunk before giving up. Deterministic failures (4xx, shape mismatches) throw
 * immediately.
 */
const MAX_CHUNK_ATTEMPTS = 8

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

class MaskChunkHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null
  ) {
    super(message)
    this.name = 'MaskChunkHttpError'
  }
}

function isRetryableChunkError(error: unknown): boolean {
  if (error instanceof MaskChunkHttpError) {
    return RETRYABLE_STATUSES.has(error.status)
  }
  // A rejected fetch (connection refused/reset, DNS, socket drop) is transient —
  // Node wraps these in TypeError('fetch failed'). Runtime-level request
  // timeouts (undici's default 300s headers/body timeout, Bun's TimeoutError)
  // and mid-flight socket closes surface with their own names/codes per runtime;
  // all are congestion or connection churn, not a deterministic failure: a chunk
  // queued behind a saturated Presidio fleet must retry, not fail the payload.
  if (error instanceof TypeError) {
    return true
  }
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
  if (name === 'TimeoutError' || name === 'HeadersTimeoutError' || name === 'BodyTimeoutError') {
    return true
  }
  return (
    typeof code === 'string' &&
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'EPIPE',
      'ETIMEDOUT',
      'ConnectionClosed',
      'ConnectionRefused',
    ].includes(code)
  )
}

/**
 * Mask PII across many strings via the internal app-container endpoint.
 *
 * Only the app task reaches the Presidio service (it holds `PII_URL`), but the
 * log-redaction persist path also runs inside the trigger.dev runtime — so
 * redaction always routes through HTTP, the same way the guardrails tool does.
 * Strings are grouped into byte/count-budgeted chunks (keeping each request far
 * under the 10MB Next body limit) and the chunks are sent with bounded
 * concurrency, so a large payload fans out rather than serializing; order is
 * preserved, so the returned array matches `texts` length.
 *
 * Transient chunk failures (network errors, 408/429/5xx) retry with jittered
 * backoff (see {@link MAX_CHUNK_ATTEMPTS}); only a deterministic failure or an
 * exhausted retry budget rejects, so the caller can apply its own fail-safe
 * (scrubbing rather than leaking).
 */
export async function maskPIIBatchViaHttp(
  texts: string[],
  entityTypes: string[],
  language?: string,
  customPatterns?: CustomPiiPattern[]
): Promise<string[]> {
  if (texts.length === 0) return []

  const url = `${getInternalApiBaseUrl()}/api/guardrails/mask-batch`
  const masked = new Array<string>(texts.length)

  await mapWithConcurrency(chunkIndicesByBudget(texts), CHUNK_CONCURRENCY, async (indices) => {
    const chunk = indices.map((i) => texts[i])
    const out = await postChunk(url, chunk, entityTypes, language, customPatterns)
    if (out.length !== chunk.length) {
      throw new Error('PII mask-batch returned an unexpected result')
    }
    indices.forEach((originalIndex, k) => {
      masked[originalIndex] = out[k]
    })
  })

  return masked
}

async function postChunk(
  url: string,
  texts: string[],
  entityTypes: string[],
  language: string | undefined,
  customPatterns: CustomPiiPattern[] | undefined
): Promise<string[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await postChunkOnce(url, texts, entityTypes, language, customPatterns)
    } catch (error) {
      if (attempt >= MAX_CHUNK_ATTEMPTS || !isRetryableChunkError(error)) {
        throw error
      }
      const retryAfterMs = error instanceof MaskChunkHttpError ? error.retryAfterMs : null
      await sleep(backoffWithJitter(attempt, retryAfterMs))
    }
  }
}

async function postChunkOnce(
  url: string,
  texts: string[],
  entityTypes: string[],
  language: string | undefined,
  customPatterns: CustomPiiPattern[] | undefined
): Promise<string[]> {
  // Mint per attempt: a single token (5min TTL) can expire mid-batch when a
  // large execution fans out into many sequential chunk requests or a chunk
  // spends its retry budget waiting out an outage.
  const token = await generateInternalToken()

  // boundary-raw-fetch: internal server-to-server call to the app container (internal JWT auth, configurable base URL)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ texts, entityTypes, language, customPatterns }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new MaskChunkHttpError(
      `PII mask-batch request failed (${response.status}): ${detail.slice(0, 200)}`,
      response.status,
      parseRetryAfter(response.headers.get('retry-after'))
    )
  }

  const data = (await response.json()) as GuardrailsMaskBatchResult | null
  if (!data || !Array.isArray(data.masked)) {
    throw new Error('PII mask-batch returned an unexpected result')
  }
  return data.masked
}
