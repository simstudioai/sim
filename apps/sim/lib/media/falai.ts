import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
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
import { type FalAICostMetadata, getFalAICostMetadata } from '@/lib/tools/falai-pricing'

const logger = createLogger('FalMediaClient')

// Generated media (esp. video) can be large.
export const MAX_MEDIA_BYTES = 250 * 1024 * 1024
const MAX_MEDIA_JSON_BYTES = 4 * 1024 * 1024
const POLL_INTERVAL_MS = 3000
/**
 * Longest a queued generation may take, whatever the caller allows: past it the request is
 * cancelled and fails. Also sent as fal's start deadline, so a request still queued then never runs.
 */
const FAL_QUEUE_MAX_MS = 30 * 60 * 1000
const FAL_CANCEL_TIMEOUT_MS = 5000
/**
 * The submit is never cut short by the caller: an interrupted POST fal may already have accepted
 * would leave a generation running that nothing can cancel. It has its own bound instead.
 */
const FAL_SUBMIT_TIMEOUT_MS = 60_000

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

function falQueueUrl(
  endpoint: string,
  requestId: string,
  path: 'status' | 'response' | 'cancel'
): string {
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
 * result JSON. Shared by the video and audio generators. Every request and wait ends when
 * `signal` aborts or {@link FAL_QUEUE_MAX_MS} passes; a submitted request is then cancelled.
 */
export async function runFalQueue(
  endpoint: string,
  input: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal
): Promise<FalQueueResult> {
  const ceiling = new AbortController()
  const ceilingTimer = setTimeout(
    () => ceiling.abort(new Error('Fal.ai generation timed out')),
    FAL_QUEUE_MAX_MS
  )
  const queueSignal = signal ? AbortSignal.any([signal, ceiling.signal]) : ceiling.signal
  try {
    return await submitAndPollFalQueue(endpoint, input, apiKey, queueSignal)
  } finally {
    clearTimeout(ceilingTimer)
  }
}

async function submitAndPollFalQueue(
  endpoint: string,
  input: Record<string, unknown>,
  apiKey: string,
  queueSignal: AbortSignal
): Promise<FalQueueResult> {
  // Only a submit already under way outlives its caller; a stopped call never starts one.
  queueSignal.throwIfAborted()
  const createResponse = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Fal-Request-Timeout': String(FAL_QUEUE_MAX_MS / 1000),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(FAL_SUBMIT_TIMEOUT_MS),
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

  const cancelUrl =
    getStringProp(createData, 'cancel_url') || falQueueUrl(endpoint, requestId, 'cancel')
  try {
    return await pollFalQueue(endpoint, requestId, createData, apiKey, queueSignal)
  } catch (error) {
    if (queueSignal.aborted) await cancelFalRequest(cancelUrl, apiKey, requestId)
    throw error
  }
}

async function pollFalQueue(
  endpoint: string,
  requestId: string,
  createData: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal
): Promise<FalQueueResult> {
  const statusUrl =
    getStringProp(createData, 'status_url') || falQueueUrl(endpoint, requestId, 'status')
  const responseUrl =
    getStringProp(createData, 'response_url') || falQueueUrl(endpoint, requestId, 'response')

  for (;;) {
    await interruptibleSleep(POLL_INTERVAL_MS, signal)
    signal.throwIfAborted()

    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: `Key ${apiKey}` },
      signal,
    })
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
        signal,
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
}

/**
 * Asks fal to drop a request nobody will read: a queued request never runs, and a running
 * one is signalled to stop. Best effort; the generation already failed either way.
 */
async function cancelFalRequest(cancelUrl: string, apiKey: string, requestId: string) {
  try {
    // boundary-raw-fetch: cancels a request on the external Fal.ai queue
    const response = await fetch(cancelUrl, {
      method: 'PUT',
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(FAL_CANCEL_TIMEOUT_MS),
    })
    await response.body?.cancel()
    // 400 means the request already finished, so there is nothing left to stop.
    if (!response.ok && response.status !== 400)
      throw new Error(`Fal.ai cancellation returned ${response.status}`)
  } catch (error) {
    logger.warn('Fal.ai request cancellation failed', {
      requestId,
      error: getErrorMessage(error),
    })
  }
}

/** Records a completed generation's cost; called at most once per generation. */
export type FalCostRecorder = (cost: FalAICostMetadata) => Promise<void>

/**
 * Bills a request fal has completed. fal charges for it whatever happens next, so the lookup
 * ignores the caller's Stop (it has its own bound) and runs before anything that can still fail
 * the generation on our side: reading the media URL and the download a Stop can end.
 */
export async function recordFalCost(
  apiKey: string,
  endpointId: string,
  requestId: string,
  onCost: FalCostRecorder
): Promise<FalAICostMetadata> {
  const cost = await getFalAICostMetadata({ apiKey, endpointId, requestId })
  await onCost(cost)
  return cost
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
  url: string,
  signal?: AbortSignal
): Promise<{ buffer: Buffer; contentType: string }> {
  signal?.throwIfAborted()
  if (url.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.+)$/u.exec(url)
    if (!match) throw new Error('Invalid data URI media response')
    const buffer = Buffer.from(match[2], 'base64')
    assertKnownSizeWithinLimit(buffer.length, MAX_MEDIA_BYTES, 'inline media response')
    return { contentType: match[1], buffer }
  }

  const validation = await validateUrlWithDNS(url, 'mediaUrl', 'contentFetch', { signal })
  if (!validation.isValid) {
    throw new Error(validation.error)
  }

  const response = await secureFetchWithPinnedIP(url, validation.resolvedIP, {
    profile: 'contentFetch',
    method: 'GET',
    maxResponseBytes: MAX_MEDIA_BYTES,
    signal,
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
