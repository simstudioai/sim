import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'

export const FALAI_HOSTED_KEY_MARKUP_MULTIPLIER = 1.5
export const FALAI_IMAGE_FALLBACK_PROVIDER_COST_DOLLARS = 0.05
export const FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS = 0.02
export const FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS = 0.25
const FALAI_BILLING_EVENT_ATTEMPTS = 2
const FALAI_BILLING_EVENT_RETRY_MS = 500
const logger = createLogger('FalAIPricing')

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
  if (costEstimateNanoUsd === undefined) return undefined

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
  requestId: string
): Promise<FalAIBillingEvent | undefined> {
  const url = new URL('https://api.fal.ai/v1/models/billing-events')
  url.searchParams.set('request_id', requestId)
  url.searchParams.set('limit', '1')

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Key ${apiKey}`,
      },
    })
  } catch (error) {
    logger.warn('Failed to fetch Fal.ai billing event', {
      requestId,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return undefined
  }

  if (!response.ok) return undefined

  const data = await response.json().catch((error) => {
    logger.warn('Failed to parse Fal.ai billing event response', {
      requestId,
      error: getErrorMessage(error, 'Unknown error'),
    })
    return undefined
  })
  if (!isRecordLike(data) || !Array.isArray(data.billing_events)) return undefined

  return data.billing_events.map(parseBillingEvent).find(Boolean)
}

async function estimateFalAICallCost(
  apiKey: string,
  endpointId: string
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
    })
  } catch (error) {
    return { error: getErrorMessage(error, 'Unknown error') }
  }

  if (!response.ok) {
    const error = await response.text().catch(() => '')
    return { error: `Fal.ai pricing estimate failed: ${response.status} ${error}` }
  }

  const data = (await response.json()) as unknown
  const totalCost = isRecordLike(data) ? getNumber(data.total_cost) : undefined
  if (totalCost === undefined) {
    return { error: 'Fal.ai pricing estimate missing total_cost' }
  }

  return { costDollars: totalCost }
}

export async function getFalAICostMetadata({
  apiKey,
  endpointId,
  requestId,
}: {
  apiKey: string
  endpointId: string
  requestId: string
}): Promise<FalAICostMetadata> {
  for (let attempt = 0; attempt < FALAI_BILLING_EVENT_ATTEMPTS; attempt++) {
    const event = await fetchFalAIBillingEvent(apiKey, requestId)
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

    if (attempt < FALAI_BILLING_EVENT_ATTEMPTS - 1) {
      await sleep(FALAI_BILLING_EVENT_RETRY_MS)
    }
  }

  const estimate = await estimateFalAICallCost(apiKey, endpointId)
  if (estimate.costDollars !== undefined) {
    return {
      endpointId,
      requestId,
      costDollars: estimate.costDollars,
      source: 'historical_estimate',
      currency: 'USD',
    }
  }

  logger.warn('Fal.ai cost metadata unavailable after generation completed', {
    endpointId,
    requestId,
    error: estimate.error,
  })

  return {
    endpointId,
    requestId,
    costDollars: getFalAIFallbackProviderCostDollars(endpointId),
    source: 'fallback_floor',
    currency: 'USD',
    error: estimate.error,
  }
}
