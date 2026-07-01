import type { GuardrailsMaskBatchResult } from '@/lib/api/contracts'
import { generateInternalToken } from '@/lib/auth/internal'
import { env } from '@/lib/core/config/env'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { chunkIndicesByBudget } from '@/lib/guardrails/pii-batching'

/**
 * Max in-flight mask-batch requests per call. Each request is a CPU-heavy NER
 * batch, so a single Presidio instance is easily saturated — default 4, raise it
 * via `PII_MASK_CHUNK_CONCURRENCY` for a scaled/load-balanced service, or set 1
 * for a single sidecar. No request timeout: masking a large batch is slow and the
 * (scaled) Presidio service is expected to eventually respond; an unreachable
 * sidecar still rejects fast (connection refused) so the caller scrubs.
 */
const CHUNK_CONCURRENCY = env.PII_MASK_CHUNK_CONCURRENCY ?? 4

/**
 * Mask PII across many strings via the internal app-container endpoint.
 *
 * The Presidio sidecars run only in the app task, but the log-redaction persist
 * path also runs inside the trigger.dev runtime — so redaction always routes
 * through HTTP, the same way the guardrails tool does.
 * Strings are grouped into byte/count-budgeted chunks (keeping each request far
 * under the 10MB Next body limit) and the chunks are sent with bounded
 * concurrency, so a large payload fans out rather than serializing; order is
 * preserved, so the returned array matches `texts` length.
 *
 * Rejects on any non-2xx, timeout, or shape mismatch so the caller can apply
 * its own fail-safe (scrubbing rather than leaking).
 */
export async function maskPIIBatchViaHttp(
  texts: string[],
  entityTypes: string[],
  language?: string
): Promise<string[]> {
  if (texts.length === 0) return []

  const url = `${getInternalApiBaseUrl()}/api/guardrails/mask-batch`
  const masked = new Array<string>(texts.length)

  await mapWithConcurrency(chunkIndicesByBudget(texts), CHUNK_CONCURRENCY, async (indices) => {
    const chunk = indices.map((i) => texts[i])
    const out = await postChunk(url, chunk, entityTypes, language)
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
  language: string | undefined
): Promise<string[]> {
  // Mint per request: a single token (5min TTL) can expire mid-batch when a
  // large execution fans out into many sequential chunk requests.
  const token = await generateInternalToken()

  // boundary-raw-fetch: internal server-to-server call to the app container (internal JWT auth, configurable base URL)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ texts, entityTypes, language }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`PII mask-batch request failed (${response.status}): ${detail.slice(0, 200)}`)
  }

  const data = (await response.json()) as GuardrailsMaskBatchResult
  if (!Array.isArray(data.masked)) {
    throw new Error('PII mask-batch returned an unexpected result')
  }
  return data.masked
}
