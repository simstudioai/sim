import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import {
  assertKnownSizeWithinLimit,
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'

const logger = createLogger('FalMediaClient')

// Generated media (esp. video) can be large.
export const MAX_MEDIA_BYTES = 250 * 1024 * 1024

/**
 * Cap for Fal.ai queue status/result envelopes, shared by every caller so the same
 * completion cannot succeed through one entry point and fail through another. The envelope
 * itself is kilobyte-scale, but some models inline the output as a base64 data URI, so the
 * bound keeps headroom for that while still capping what a single poll can buffer.
 */
export const MAX_FAL_QUEUE_JSON_BYTES = 4 * 1024 * 1024
const POLL_INTERVAL_MS = 3000

/**
 * Resolves a hosted Fal.ai API key from the numbered env pool
 * (FALAI_API_KEY_COUNT + FALAI_API_KEY_1..N), round-robined by minute,
 * mirroring getRotatingApiKey. Falls back to a single FALAI_API_KEY for dev.
 */
export function getFalApiKey(): string {
  const count = Number.parseInt(process.env.FALAI_API_KEY_COUNT || '0', 10)
  const keys: string[] = []
  for (let i = 1; i <= count; i++) {
    const key = process.env[`FALAI_API_KEY_${i}`]
    if (key) keys.push(key)
  }
  if (keys.length === 0 && process.env.FALAI_API_KEY) {
    keys.push(process.env.FALAI_API_KEY)
  }
  if (keys.length === 0) {
    throw new Error(
      'No hosted Fal.ai API key configured. Set FALAI_API_KEY_COUNT and FALAI_API_KEY_1..N.'
    )
  }
  const index = new Date().getMinutes() % keys.length
  return keys[index]
}

export function getStringProp(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

export function getNumberProp(
  record: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' ? value : undefined
}

export const FAL_QUEUE_ORIGIN = 'https://queue.fal.run'

/**
 * Fal.ai routes queue polling under the app id (`{owner}/{alias}`) ONLY — a model's sub-path
 * is part of the submit URL but not the queue URL. `queue.fal.run` answers
 * `/fal-ai/kling-video/requests/{id}/status` but 405s on
 * `/fal-ai/kling-video/v3/pro/text-to-video/requests/{id}/status`.
 */
function falQueueAppId(endpoint: string): string {
  return endpoint.split('/').slice(0, 2).join('/')
}

/**
 * Builds a Fal.ai queue URL. `status` polls progress; `result` fetches the completed payload
 * and takes no path suffix (`/response` is not a route — `queue.fal.run` 405s on it).
 */
export function buildFalQueueUrl(
  endpoint: string,
  requestId: string,
  kind: 'status' | 'result'
): string {
  const base = `${FAL_QUEUE_ORIGIN}/${falQueueAppId(endpoint)}/requests/${requestId}`
  return kind === 'status' ? `${base}/status` : base
}

/** The only queue paths `queue.fal.run` routes: `/{app}/requests/{id}` and `.../status`. */
const FAL_QUEUE_PATH_PATTERN = /^\/(?:[^/]+\/)+requests\/[^/]+(?:\/status)?$/u

/**
 * Accepts a queue URL echoed back by Fal.ai only while it stays on the queue origin we
 * submitted to AND matches a routable queue path, otherwise falls back to the URL we
 * construct ourselves. Queue polling carries `Authorization: Key <apiKey>`, so an
 * attacker-influenced `status_url` / `response_url` would otherwise hand the Fal.ai key to
 * an arbitrary host. Origin alone is not enough: Fal.ai echoes a `response_url` suffixed
 * with `/response`, which is not a GET route (405), so that suffix is stripped first.
 */
export function resolveFalQueueUrl(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    logger.warn('Fal.ai queue URL is not a valid URL; using constructed fallback', { fallback })
    return fallback
  }

  if (url.origin !== FAL_QUEUE_ORIGIN) {
    logger.warn('Fal.ai queue URL left the queue origin; using constructed fallback', {
      candidate,
      fallback,
    })
    return fallback
  }

  const path = url.pathname.replace(/\/response$/u, '')
  const wantsStatus = fallback.endsWith('/status')
  if (!FAL_QUEUE_PATH_PATTERN.test(path) || path.endsWith('/status') !== wantsStatus) {
    logger.warn('Fal.ai queue URL is not a routable queue path; using constructed fallback', {
      candidate,
      fallback,
    })
    return fallback
  }

  const normalized = `${FAL_QUEUE_ORIGIN}${path}${url.search}`
  if (normalized !== candidate) {
    logger.warn('Normalized Fal.ai queue URL to a routable shape', { candidate, normalized })
  }
  return normalized
}

/**
 * Requests a Fal.ai queue URL through the SSRF-guarded client. Invoked on every poll so the
 * provider-supplied URL is revalidated each time rather than trusted once.
 */
async function fetchFalQueue(url: string, apiKey: string) {
  const validation = await validateUrlWithDNS(url, 'falQueueUrl')
  if (!validation.isValid || !validation.resolvedIP) {
    throw new Error(validation.error || 'Fal.ai queue URL failed validation')
  }
  return secureFetchWithPinnedIP(url, validation.resolvedIP, {
    method: 'GET',
    headers: { Authorization: `Key ${apiKey}` },
    maxResponseBytes: MAX_FAL_QUEUE_JSON_BYTES,
  })
}

function falErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (isRecordLike(error)) return getStringProp(error, 'message') || JSON.stringify(error)
  return 'Unknown Fal.ai error'
}

export interface FalQueueResult {
  requestId: string
  data: Record<string, unknown>
}

/**
 * Submit input to a Fal.ai queue endpoint, poll to completion, and return the
 * result JSON. Shared by the video and audio generators.
 */
export async function runFalQueue(
  endpoint: string,
  input: Record<string, unknown>,
  apiKey: string
): Promise<FalQueueResult> {
  const createResponse = await fetch(`${FAL_QUEUE_ORIGIN}/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!createResponse.ok) {
    const err = await readResponseTextWithLimit(createResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Fal.ai create error response',
    }).catch(() => '')
    throw new Error(`Fal.ai API error: ${createResponse.status} - ${err}`)
  }

  const createData = await readResponseJsonWithLimit(createResponse, {
    maxBytes: MAX_FAL_QUEUE_JSON_BYTES,
    label: 'Fal.ai create response',
  })
  if (!isRecordLike(createData)) throw new Error('Invalid Fal.ai queue response')

  const requestId = getStringProp(createData, 'request_id')
  if (!requestId) throw new Error('Fal.ai queue response missing request_id')

  const statusUrl = resolveFalQueueUrl(
    getStringProp(createData, 'status_url'),
    buildFalQueueUrl(endpoint, requestId, 'status')
  )
  const responseUrl = resolveFalQueueUrl(
    getStringProp(createData, 'response_url'),
    buildFalQueueUrl(endpoint, requestId, 'result')
  )

  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(POLL_INTERVAL_MS)

    const statusResponse = await fetchFalQueue(statusUrl, apiKey)
    if (!statusResponse.ok) {
      const body = await readResponseTextWithLimit(statusResponse, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Fal.ai status error response',
      }).catch(() => '')
      throw new Error(
        `Fal.ai status check failed: ${statusResponse.status}${body ? ` - ${body}` : ''}`
      )
    }

    const statusData = await readResponseJsonWithLimit(statusResponse, {
      maxBytes: MAX_FAL_QUEUE_JSON_BYTES,
      label: 'Fal.ai status response',
    })
    if (!isRecordLike(statusData)) throw new Error('Invalid Fal.ai status response')

    const status = getStringProp(statusData, 'status')
    if (status === 'COMPLETED') {
      if (statusData.error) {
        throw new Error(`Fal.ai generation failed: ${falErrorMessage(statusData.error)}`)
      }
      const resultResponse = await fetchFalQueue(
        resolveFalQueueUrl(getStringProp(statusData, 'response_url'), responseUrl),
        apiKey
      )
      if (!resultResponse.ok) {
        const body = await readResponseTextWithLimit(resultResponse, {
          maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
          label: 'Fal.ai result error response',
        }).catch(() => '')
        throw new Error(
          `Failed to fetch Fal.ai result: ${resultResponse.status}${body ? ` - ${body}` : ''}`
        )
      }
      const resultData = await readResponseJsonWithLimit(resultResponse, {
        maxBytes: MAX_FAL_QUEUE_JSON_BYTES,
        label: 'Fal.ai result response',
      })
      if (!isRecordLike(resultData)) throw new Error('Invalid Fal.ai result response')
      return { requestId, data: resultData }
    }

    if (['ERROR', 'FAILED', 'CANCELLED'].includes(status || '')) {
      throw new Error(`Fal.ai generation failed: ${falErrorMessage(statusData.error)}`)
    }
  }

  throw new Error('Fal.ai generation timed out')
}

/**
 * Pull the output media URL out of a Fal.ai result, tolerating the various
 * shapes different models return (string url, { url }, nested arrays).
 */
export function extractFalMediaUrl(
  data: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string') return value
    if (isRecordLike(value)) {
      const url = getStringProp(value, 'url')
      if (url) return url
    }
    if (Array.isArray(value)) {
      const first = value.find(isRecordLike) as Record<string, unknown> | undefined
      const url = getStringProp(first, 'url')
      if (url) return url
    }
  }
  return undefined
}

/** Securely download a generated media URL (or inline data URI) to a buffer. */
export async function downloadFalMedia(
  url: string
): Promise<{ buffer: Buffer; contentType: string }> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.+)$/u.exec(url)
    if (!match) throw new Error('Invalid data URI media response')
    const buffer = Buffer.from(match[2], 'base64')
    assertKnownSizeWithinLimit(buffer.length, MAX_MEDIA_BYTES, 'inline media response')
    return { contentType: match[1], buffer }
  }

  const validation = await validateUrlWithDNS(url, 'mediaUrl')
  if (!validation.isValid || !validation.resolvedIP) {
    throw new Error(validation.error || 'Generated media URL failed validation')
  }

  const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
    method: 'GET',
    maxResponseBytes: MAX_MEDIA_BYTES,
  })
  if (!response.ok) {
    await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'generated media error response',
    }).catch(() => '')
    throw new Error(`Failed to download generated media: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const buffer = await readResponseToBufferWithLimit(response, {
    maxBytes: MAX_MEDIA_BYTES,
    label: 'generated media download',
  })
  return { buffer, contentType }
}

export { logger as falMediaLogger }
