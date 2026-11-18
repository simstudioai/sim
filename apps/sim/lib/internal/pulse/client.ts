import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { PulseOperationError } from '@/lib/internal/pulse/errors'
import { MAX_TOOL_RESPONSE_BODY_BYTES } from '@/lib/internal/tool-operations/response-limits'

const logger = createLogger('PulseClient')
const PULSE_API_HOST = 'api.runpulse.com'
const PULSE_ENDPOINT = `https://${PULSE_API_HOST}/extract`

/**
 * Pulse answers a large extraction (70+ pages, or over its inline size limit) with
 * `{ is_url: true, url, extraction_id }` instead of the result. The URL holds the full result
 * in the normal shape; it is either Pulse's own `/results/{id}` (which needs the API key) or a
 * presigned storage URL.
 */
async function downloadLargeResult(
  apiKey: string,
  url: string,
  signal?: AbortSignal
): Promise<unknown> {
  const validation = await validateUrlWithDNS(url, 'Pulse result URL', 'contentFetch')
  signal?.throwIfAborted()
  if (!validation.isValid) {
    throw new PulseOperationError(502, {
      success: false,
      error: 'Pulse returned an invalid result URL',
    })
  }
  const target = new URL(url)
  const isPulseHost = target.protocol === 'https:' && target.hostname === PULSE_API_HOST
  try {
    const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
      profile: 'contentFetch',
      method: 'GET',
      headers: isPulseHost ? { 'x-api-key': apiKey } : {},
      maxResponseBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
      signal,
    })
    signal?.throwIfAborted()
    if (!response.ok) {
      logger.error('Pulse large result download failed', { status: response.status })
      throw new PulseOperationError(response.status, {
        success: false,
        error: `Failed to download the Pulse result: ${response.statusText}`,
      })
    }
    return await response.json()
  } catch (error) {
    if (!isPayloadSizeLimitError(error)) throw error
    throw new PulseOperationError(413, {
      success: false,
      error: `The Pulse result is too large to return (over ${MAX_TOOL_RESPONSE_BODY_BYTES / (1024 * 1024)} MiB). Request fewer pages.`,
    })
  }
}

export async function submitPulseParse(
  apiKey: string,
  formData: FormData,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const validation = await validateUrlWithDNS(PULSE_ENDPOINT, 'Pulse API URL', 'configuredEndpoint')
  signal?.throwIfAborted()
  if (!validation.isValid) {
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
  const result: unknown = await response.json()
  if (isRecordLike(result) && result.is_url === true && typeof result.url === 'string') {
    const fullResult = await downloadLargeResult(apiKey, result.url, signal)
    return isRecordLike(fullResult)
      ? { extraction_id: result.extraction_id, ...fullResult }
      : fullResult
  }
  return result
}
