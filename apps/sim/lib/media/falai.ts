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
const MAX_MEDIA_JSON_BYTES = 4 * 1024 * 1024
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

function falQueueUrl(endpoint: string, requestId: string, path: 'status' | 'response'): string {
  return `https://queue.fal.run/${endpoint}/requests/${requestId}/${path}`
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
  const createResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
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
    maxBytes: MAX_MEDIA_JSON_BYTES,
    label: 'Fal.ai create response',
  })
  if (!isRecordLike(createData)) throw new Error('Invalid Fal.ai queue response')

  const requestId = getStringProp(createData, 'request_id')
  if (!requestId) throw new Error('Fal.ai queue response missing request_id')

  const statusUrl =
    getStringProp(createData, 'status_url') || falQueueUrl(endpoint, requestId, 'status')
  const responseUrl =
    getStringProp(createData, 'response_url') || falQueueUrl(endpoint, requestId, 'response')

  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / POLL_INTERVAL_MS)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(POLL_INTERVAL_MS)

    const statusResponse = await fetch(statusUrl, { headers: { Authorization: `Key ${apiKey}` } })
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
      maxBytes: MAX_MEDIA_JSON_BYTES,
      label: 'Fal.ai status response',
    })
    if (!isRecordLike(statusData)) throw new Error('Invalid Fal.ai status response')

    const status = getStringProp(statusData, 'status')
    if (status === 'COMPLETED') {
      if (statusData.error) {
        throw new Error(`Fal.ai generation failed: ${falErrorMessage(statusData.error)}`)
      }
      const resultResponse = await fetch(getStringProp(statusData, 'response_url') || responseUrl, {
        headers: { Authorization: `Key ${apiKey}` },
      })
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
        maxBytes: MAX_MEDIA_JSON_BYTES,
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
