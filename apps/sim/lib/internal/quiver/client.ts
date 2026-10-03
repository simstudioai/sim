import { createLogger } from '@sim/logger'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { QuiverOperationError } from '@/lib/internal/quiver/errors'

const logger = createLogger('QuiverClient')
const QUIVER_API_BASE_URL = 'https://api.quiver.ai/v1/svgs'
const MAX_QUIVER_ERROR_BYTES = 64 * 1024

export type QuiverOperationPath = 'generations' | 'vectorizations'

export async function requestQuiverSvg(
  path: QuiverOperationPath,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const response = await fetch(`${QUIVER_API_BASE_URL}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  signal?.throwIfAborted()

  if (!response.ok) {
    const errorText = await readResponseTextWithLimit(response, {
      maxBytes: MAX_QUIVER_ERROR_BYTES,
      label: 'Quiver error response',
      signal,
    })
    signal?.throwIfAborted()
    logger.error('Quiver API request failed', { path, status: response.status, error: errorText })
    throw new QuiverOperationError(
      `Quiver API error: ${response.status} - ${errorText}`,
      response.status
    )
  }

  const result = await readResponseJsonWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Quiver SVG response',
    signal,
  })
  signal?.throwIfAborted()
  return result
}
