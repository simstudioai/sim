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
import { PulseOperationError } from '@/lib/internal/pulse/errors'

const logger = createLogger('PulseClient')
const PULSE_ENDPOINT = 'https://api.runpulse.com/extract'

export async function submitPulseParse(
  apiKey: string,
  formData: FormData,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(PULSE_ENDPOINT, 'Pulse API URL', 'configuredEndpoint')
  signal?.throwIfAborted()
  if (!validation.isValid || !validation.resolvedIP) {
    throw new PulseOperationError(502, { success: false, error: 'Failed to reach Pulse API' })
  }

  const payload = new Response(formData)
  const contentType = payload.headers.get('content-type') || 'multipart/form-data'
  const body = Buffer.from(await payload.arrayBuffer())
  signal?.throwIfAborted()
  const response = await secureFetchWithPinnedIP(PULSE_ENDPOINT, validation.resolvedIP, {
    profile: 'configuredEndpoint',
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': contentType },
    body,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    signal,
  })
  signal?.throwIfAborted()

  if (!response.ok) {
    const diagnostic = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Pulse API error response',
      signal,
    })
    logger.error('Pulse API error', { status: response.status, diagnostic })
    throw new PulseOperationError(response.status, {
      success: false,
      error: `Pulse API error: ${response.statusText}`,
    })
  }
  return response.json()
}
