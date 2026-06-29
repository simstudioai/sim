import type { GuardrailsMaskBatchResult } from '@/lib/api/contracts'
import { generateInternalToken } from '@/lib/auth/internal'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { chunkIndicesByBudget } from '@/lib/guardrails/pii-batching'

/** Bounds one mask-batch request; an unreachable/stuck Presidio sidecar aborts so the caller scrubs. */
const REQUEST_TIMEOUT_MS = 45_000

/**
 * Mask PII across many strings via the internal app-container endpoint.
 *
 * The Presidio sidecars run only in the app task, but the log-redaction persist
 * path also runs inside the trigger.dev runtime — so redaction always routes
 * through HTTP, the same way the guardrails tool does.
 * Strings are grouped into byte/count-budgeted chunks (keeping each request far
 * under the 10MB Next body limit); order is preserved, so the returned array
 * matches `texts` length.
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

  for (const indices of chunkIndicesByBudget(texts)) {
    const chunk = indices.map((i) => texts[i])
    const out = await postChunk(url, chunk, entityTypes, language)
    if (out.length !== chunk.length) {
      throw new Error('PII mask-batch returned an unexpected result')
    }
    indices.forEach((originalIndex, k) => {
      masked[originalIndex] = out[k]
    })
  }

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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
