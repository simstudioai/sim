import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { ExtendOperationError } from '@/lib/internal/extend/errors'

const logger = createLogger('ExtendClient')
const EXTEND_ENDPOINT = 'https://api.extend.ai/parse'

export async function submitExtendParse(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(
    EXTEND_ENDPOINT,
    'Extend API URL',
    'configuredEndpoint'
  )
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new ExtendOperationError(502, { success: false, error: 'Failed to reach Extend API' })
  }

  let response: Awaited<ReturnType<typeof secureFetchWithPinnedIP>>
  try {
    response = await secureFetchWithPinnedIP(EXTEND_ENDPOINT, validation.resolvedIP, {
      profile: 'configuredEndpoint',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-extend-api-version': '2025-04-21',
      },
      body: JSON.stringify(body),
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    logger.error('Extend API request failed', { errorName: toError(error).name })
    throw new ExtendOperationError(502, { success: false, error: 'Failed to reach Extend API' })
  }
  signal?.throwIfAborted()

  if (!response.ok) {
    let diagnostic = ''
    try {
      diagnostic = await readResponseTextWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Extend API error response',
        signal,
      })
    } catch {
      signal?.throwIfAborted()
    }
    logger.error('Extend API error', { status: response.status })
    let clientError = `Extend API error: ${response.statusText || response.status}`
    try {
      const parsed: unknown = JSON.parse(diagnostic)
      if (isPlainRecord(parsed)) {
        const detail = parsed.message ?? parsed.error
        if (typeof detail === 'string') clientError = detail
      }
    } catch {}
    throw new ExtendOperationError(response.status, { success: false, error: clientError })
  }

  let output: unknown
  try {
    output = await response.json()
  } catch {
    signal?.throwIfAborted()
    throw new ExtendOperationError(502, {
      success: false,
      error: 'Extend API returned an invalid response',
    })
  }
  if (!isPlainRecord(output)) {
    throw new ExtendOperationError(502, {
      success: false,
      error: 'Extend API returned an invalid response',
    })
  }
  return output
}
