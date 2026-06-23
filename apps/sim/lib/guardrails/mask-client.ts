import type { GuardrailsMaskBatchResult } from '@/lib/api/contracts'
import { generateInternalToken } from '@/lib/auth/internal'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'

/**
 * Per-request limits. A chunk is flushed when it hits either bound, keeping each
 * request small enough for one short Presidio pass under a tight timeout and far
 * below the contract's 100k-entry cap — so large executions split across
 * requests instead of failing validation.
 */
const REQUEST_MAX_BYTES = 256 * 1024
const REQUEST_MAX_COUNT = 2_000
/** Bounds one mask-batch request; an unreachable/stuck Presidio sidecar aborts so the caller scrubs. */
const REQUEST_TIMEOUT_MS = 45_000

/**
 * Mask PII across many strings via the internal app-container endpoint.
 *
 * The Presidio sidecars run only in the app task, but the log-redaction persist
 * path also runs inside the trigger.dev runtime — so redaction always routes
 * through HTTP, the same way the guardrails tool does.
 * Strings are grouped into byte/count-budgeted chunks; order is preserved, so
 * the returned array matches `texts` length.
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

  const masked: string[] = []
  let batch: string[] = []
  let batchBytes = 0

  const flush = async () => {
    if (batch.length === 0) return
    const out = await postChunk(url, batch, entityTypes, language)
    if (out.length !== batch.length) {
      throw new Error('PII mask-batch returned an unexpected result')
    }
    for (const item of out) masked.push(item)
    batch = []
    batchBytes = 0
  }

  for (const text of texts) {
    const bytes = Buffer.byteLength(text, 'utf8')
    if (
      batch.length > 0 &&
      (batch.length >= REQUEST_MAX_COUNT || batchBytes + bytes > REQUEST_MAX_BYTES)
    ) {
      await flush()
    }
    batch.push(text)
    batchBytes += bytes
  }
  await flush()

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
