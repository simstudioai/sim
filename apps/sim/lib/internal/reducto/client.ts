import { createLogger } from '@sim/logger'
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { ReductoOperationError } from '@/lib/internal/reducto/errors'

const logger = createLogger('ReductoClient')
const REDUCTO_ENDPOINT = 'https://platform.reducto.ai/parse'

export async function submitReductoParse(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(
    REDUCTO_ENDPOINT,
    'Reducto API URL',
    'configuredEndpoint'
  )
  signal?.throwIfAborted()
  if (!validation.isValid || !validation.resolvedIP) {
    throw new ReductoOperationError(502, {
      success: false,
      error: 'Failed to reach Reducto API',
    })
  }

  const response = await secureFetchWithPinnedIP(REDUCTO_ENDPOINT, validation.resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    signal,
  })
  signal?.throwIfAborted()

  if (!response.ok) {
    const diagnostic = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Reducto API error response',
      signal,
    })
    logger.error('Reducto API error', { status: response.status, diagnostic })
    throw new ReductoOperationError(response.status, {
      success: false,
      error: `Reducto API error: ${response.statusText}`,
    })
  }

  return response.json()
}
