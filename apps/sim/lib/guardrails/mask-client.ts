import type { GuardrailsMaskBatchResult } from '@/lib/api/contracts'
import { generateInternalToken } from '@/lib/auth/internal'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'

/**
 * Mask PII across many strings via the internal app-container endpoint.
 *
 * Presidio (a Python venv) only exists in the app container, but the
 * log-redaction persist path also runs inside the trigger.dev runtime — so
 * redaction always routes through HTTP, the same way the guardrails tool does.
 * Order is preserved: the returned array matches `texts` length.
 *
 * Rejects on any non-2xx or shape mismatch so the caller can apply its own
 * fail-safe (scrubbing rather than leaking).
 */
export async function maskPIIBatchViaHttp(
  texts: string[],
  entityTypes: string[],
  language?: string
): Promise<string[]> {
  const token = await generateInternalToken()
  const url = `${getInternalApiBaseUrl()}/api/guardrails/mask-batch`

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
  if (!Array.isArray(data.masked) || data.masked.length !== texts.length) {
    throw new Error('PII mask-batch returned an unexpected result')
  }
  return data.masked
}
