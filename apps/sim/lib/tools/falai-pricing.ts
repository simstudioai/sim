import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import { parseRetryAfter } from '@sim/utils/retry'
import { LRUCache } from 'lru-cache'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { DeadlineExceededError, withinDeadline } from '@/lib/core/utils/deadline'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'

export const FALAI_HOSTED_KEY_MARKUP_MULTIPLIER = 1.5
export const FALAI_IMAGE_FALLBACK_PROVIDER_COST_DOLLARS = 0.05
export const FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS = 0.02
export const FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS = 0.25
const FALAI_BILLING_EVENT_ATTEMPTS = 2
const FALAI_BILLING_EVENT_RETRY_MS = 500
const FALAI_PRICING_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
/**
 * Longest a cost lookup may take, covering every billing-event attempt and the estimate. The
 * queue is terminal by then; successful delivery can fall back to an explicitly labeled estimate.
 */
export const FALAI_COST_LOOKUP_TIMEOUT_MS = 10_000
const logger = createLogger('FalAIPricing')
const FALAI_ESTIMATE_TTL_MS = 5 * 60_000
const FALAI_COOLDOWN_MS = 60_000
const FALAI_MAX_COOLDOWN_MS = 5 * 60_000
const estimateCache = new LRUCache<string, number>({ max: 4096, ttl: FALAI_ESTIMATE_TTL_MS })
const lookupCooldowns = new LRUCache<string, string>({ max: 2048 })

function credentialFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

function platformError(response: Response, cooldownKey: string, operation: string): string {
  const error = `Fal.ai ${operation} failed: HTTP ${response.status}`
  if (response.status === 429 || response.status === 401 || response.status === 403) {
    const ttl = Math.max(
      1000,
      lookupCooldowns.getRemainingTTL(cooldownKey),
      parseRetryAfter(response.headers.get('retry-after'), FALAI_MAX_COOLDOWN_MS) ??
        FALAI_COOLDOWN_MS
    )
    lookupCooldowns.set(cooldownKey, error, { ttl })
    logger.warn('Fal.ai cost lookup cooling down', {
      operation,
      status: response.status,
      retryAfterMs: ttl,
    })
  }
  void response.body?.cancel().catch(() => undefined)
  return error
}

export interface FalAICostMetadata {
  endpointId: string
  requestId: string
  costDollars: number
  source: 'billing_events' | 'historical_estimate' | 'fallback_floor'
  outputUnits?: number | null
  unitPrice?: number | null
  percentDiscount?: number | null
  currency?: string
  error?: string
}

const FALAI_COST_SOURCES = new Set<string>([
  'billing_events',
  'historical_estimate',
  'fallback_floor',
])

export function isFalAICostSource(value: unknown): value is FalAICostMetadata['source'] {
  return typeof value === 'string' && FALAI_COST_SOURCES.has(value)
}

interface FalAIBillingEvent {
  request_id: string
  endpoint_id: string
  output_units: number | null
  unit_price: number | null
  percent_discount: number | null
  cost_estimate_nano_usd: number
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getFalAIFallbackProviderCostDollars(endpointId: string): number {
  const normalizedEndpointId = endpointId.toLowerCase()

  // Checked before the image match below, which every image-to-video endpoint id also contains.
  const segments = normalizedEndpointId.split('/')
  if (segments.includes('text-to-video') || segments.includes('image-to-video')) {
    return FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS
  }

  const isImageEndpoint =
    normalizedEndpointId.includes('image') ||
    normalizedEndpointId.includes('nano-banana') ||
    normalizedEndpointId.includes('seedream') ||
    normalizedEndpointId.includes('flux') ||
    normalizedEndpointId.includes('grok-imagine')
  if (isImageEndpoint) return FALAI_IMAGE_FALLBACK_PROVIDER_COST_DOLLARS

  // Audio (TTS/voice clone, music, sound effects) is far cheaper than video, so it
  // must not fall through to the video floor — that would over-bill a short clip.
  const isAudioEndpoint =
    normalizedEndpointId.includes('tts') ||
    normalizedEndpointId.includes('speech') ||
    normalizedEndpointId.includes('music') ||
    normalizedEndpointId.includes('sound-effect') ||
    normalizedEndpointId.includes('audio') ||
    normalizedEndpointId.includes('elevenlabs')
  if (isAudioEndpoint) return FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS

  return FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS
}

function parseBillingEvent(value: unknown): FalAIBillingEvent | undefined {
  if (!isRecordLike(value)) return undefined

  const requestId = value.request_id
  const endpointId = value.endpoint_id
  const costEstimateNanoUsd = getNumber(value.cost_estimate_nano_usd)

  if (typeof requestId !== 'string' || typeof endpointId !== 'string') return undefined
  if (costEstimateNanoUsd === undefined || costEstimateNanoUsd < 0) return undefined

  return {
    request_id: requestId,
    endpoint_id: endpointId,
    output_units: getNumber(value.output_units) ?? null,
    unit_price: getNumber(value.unit_price) ?? null,
    percent_discount: getNumber(value.percent_discount) ?? null,
    cost_estimate_nano_usd: costEstimateNanoUsd,
  }
}

async function fetchFalAIBillingEvent(
  apiKey: string,
  requestId: string,
  signal?: AbortSignal
): Promise<{ event?: FalAIBillingEvent; retry: boolean }> {
  const cooldownKey = `billing:${credentialFingerprint(apiKey)}`
  if (lookupCooldowns.has(cooldownKey)) return { retry: false }
  const url = new URL('https://api.fal.ai/v1/models/billing-events')
  url.searchParams.set('request_id', requestId)
  url.searchParams.set('limit', '1')

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Key ${apiKey}`,
      },
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    logger.warn('Failed to fetch Fal.ai billing event', {
      requestId,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return { retry: true }
  }

  if (!response.ok) {
    platformError(response, cooldownKey, 'billing event lookup')
    return { retry: response.status >= 500 }
  }

  const data = await readResponseJsonWithLimit(response, {
    maxBytes: FALAI_PRICING_RESPONSE_MAX_BYTES,
    label: 'Fal.ai billing event response',
    signal,
  }).catch((error) => {
    signal?.throwIfAborted()
    logger.warn('Failed to parse Fal.ai billing event response', {
      requestId,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return undefined
  })
  if (!isRecordLike(data) || !Array.isArray(data.billing_events)) return { retry: true }

  const event = data.billing_events
    .map(parseBillingEvent)
    .find((entry) => entry?.request_id === requestId)
  return { event, retry: true }
}

async function estimateFalAICallCost(
  apiKey: string,
  endpointId: string,
  cooldownKey: string,
  signal?: AbortSignal
): Promise<{ costDollars?: number; error?: string }> {
  let response: Response
  try {
    response = await fetch('https://api.fal.ai/v1/models/pricing/estimate', {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        estimate_type: 'historical_api_price',
        endpoints: {
          [endpointId]: {
            call_quantity: 1,
          },
        },
      }),
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    return { error: getErrorMessage(error, 'Unknown error') }
  }

  if (!response.ok) {
    return { error: platformError(response, cooldownKey, 'pricing estimate') }
  }

  let data: unknown
  try {
    data = await readResponseJsonWithLimit(response, {
      maxBytes: FALAI_PRICING_RESPONSE_MAX_BYTES,
      label: 'Fal.ai pricing estimate response',
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    return { error: getErrorMessage(error, 'Unknown error') }
  }
  const totalCost = isRecordLike(data) ? getNumber(data.total_cost) : undefined
  if (totalCost === undefined || totalCost < 0) {
    return { error: 'Fal.ai pricing estimate missing total_cost' }
  }

  return { costDollars: totalCost }
}

/** Historical prices are account-specific; exact job receipts always bypass this process-local cache. */
async function getHistoricalEstimate(apiKey: string, endpointId: string, signal?: AbortSignal) {
  const fingerprint = credentialFingerprint(apiKey)
  const cacheKey = `${fingerprint}:${endpointId}`
  const cached = estimateCache.get(cacheKey)
  if (cached !== undefined) return { costDollars: cached }
  const cooldownKey = `estimate:${fingerprint}`
  const cooldown = lookupCooldowns.get(cooldownKey)
  if (cooldown) return { error: cooldown }

  // One caller stopping must not cancel the estimate shared by other completed jobs.
  const deadlineAt = Date.now() + FALAI_COST_LOOKUP_TIMEOUT_MS
  const estimate = await coalesceLocally(`fal-estimate:${cacheKey}`, async () => {
    const result = await withinDeadline(
      (producerSignal) => estimateFalAICallCost(apiKey, endpointId, cooldownKey, producerSignal),
      deadlineAt
    )
    if (result.costDollars !== undefined) estimateCache.set(cacheKey, result.costDollars)
    return result
  })
  signal?.throwIfAborted()
  return estimate
}

interface FalAICostLookup {
  apiKey: string
  endpointId: string
  requestId: string
  /** Ends the lookup with an error. Without one, only {@link FALAI_COST_LOOKUP_TIMEOUT_MS} ends it. */
  signal?: AbortSignal
  deadlineAt?: number
}

/**
 * The cost of a completed fal request. The lookup is bounded on its own: past
 * {@link FALAI_COST_LOOKUP_TIMEOUT_MS} it returns the fallback floor rather than nothing.
 */
export function getFalAICostMetadata(lookup: FalAICostLookup): Promise<FalAICostMetadata> {
  return withCostDeadline(lookup, lookUpFalAICost)
}

/** Estimates a request whose exact receipt has already been checked, sharing that lookup's deadline. */
export async function getFalAIEstimatedCostMetadata(
  lookup: FalAICostLookup
): Promise<FalAICostMetadata> {
  lookup.signal?.throwIfAborted()
  const cached = estimateCache.get(`${credentialFingerprint(lookup.apiKey)}:${lookup.endpointId}`)
  if (cached !== undefined) return historicalCost(lookup, cached)
  return withCostDeadline(lookup, lookUpEstimatedCost)
}

async function withCostDeadline(
  lookup: FalAICostLookup,
  operation: (lookup: FalAICostLookup) => Promise<FalAICostMetadata>
): Promise<FalAICostMetadata> {
  const { endpointId, requestId } = lookup
  try {
    return await withinDeadline(
      (signal) => operation({ ...lookup, signal }),
      lookup.deadlineAt ?? Date.now() + FALAI_COST_LOOKUP_TIMEOUT_MS,
      lookup.signal
    )
  } catch (error) {
    if (!(error instanceof DeadlineExceededError)) throw error
    logger.warn('Fal.ai cost lookup timed out after queue completion', {
      endpointId,
      requestId,
    })
    return fallbackFloorCost(endpointId, requestId, error.message)
  }
}

function fallbackFloorCost(
  endpointId: string,
  requestId: string,
  error: string | undefined
): FalAICostMetadata {
  return {
    endpointId,
    requestId,
    costDollars: getFalAIFallbackProviderCostDollars(endpointId),
    source: 'fallback_floor',
    currency: 'USD',
    error,
  }
}

/** Reads only an exact receipt, without inventing a charge for a failed result. */
export async function getFalAIBillingReceipt(
  lookup: FalAICostLookup
): Promise<FalAICostMetadata | undefined> {
  try {
    return await withinDeadline(
      (signal) => lookUpBillingReceipt({ ...lookup, signal }),
      lookup.deadlineAt ?? Date.now() + FALAI_COST_LOOKUP_TIMEOUT_MS,
      lookup.signal
    )
  } catch (error) {
    if (!(error instanceof DeadlineExceededError)) throw error
    logger.warn('Fal.ai billing receipt lookup timed out', {
      endpointId: lookup.endpointId,
      requestId: lookup.requestId,
    })
    return undefined
  }
}

async function lookUpBillingReceipt({
  apiKey,
  requestId,
  signal,
}: FalAICostLookup): Promise<FalAICostMetadata | undefined> {
  for (let attempt = 0; attempt < FALAI_BILLING_EVENT_ATTEMPTS; attempt++) {
    const { event, retry } = await fetchFalAIBillingEvent(apiKey, requestId, signal)
    if (event) {
      return {
        endpointId: event.endpoint_id,
        requestId: event.request_id,
        costDollars: event.cost_estimate_nano_usd / 1_000_000_000,
        source: 'billing_events',
        outputUnits: event.output_units,
        unitPrice: event.unit_price,
        percentDiscount: event.percent_discount,
        currency: 'USD',
      }
    }

    if (!retry) break
    if (attempt < FALAI_BILLING_EVENT_ATTEMPTS - 1) {
      await interruptibleSleep(FALAI_BILLING_EVENT_RETRY_MS, signal)
      signal?.throwIfAborted()
    }
  }
}

async function lookUpFalAICost(lookup: FalAICostLookup): Promise<FalAICostMetadata> {
  const receipt = await lookUpBillingReceipt(lookup)
  if (receipt) return receipt
  return lookUpEstimatedCost(lookup)
}

function historicalCost(
  { endpointId, requestId }: FalAICostLookup,
  costDollars: number
): FalAICostMetadata {
  return { endpointId, requestId, costDollars, source: 'historical_estimate', currency: 'USD' }
}

async function lookUpEstimatedCost(lookup: FalAICostLookup): Promise<FalAICostMetadata> {
  const { apiKey, endpointId, requestId, signal } = lookup
  const estimate = await getHistoricalEstimate(apiKey, endpointId, signal)
  if (estimate.costDollars !== undefined) return historicalCost(lookup, estimate.costDollars)

  logger.warn('Fal.ai cost metadata unavailable after queue completion', {
    endpointId,
    requestId,
    error: estimate.error,
  })

  return fallbackFloorCost(endpointId, requestId, estimate.error)
}
