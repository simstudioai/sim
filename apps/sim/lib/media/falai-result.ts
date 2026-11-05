import { isRecordLike } from '@sim/utils/object'
import { withinDeadline } from '@/lib/core/utils/deadline'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  FALAI_COST_LOOKUP_TIMEOUT_MS,
  type FalAICostMetadata,
  getFalAIBillingReceipt,
  getFalAIEstimatedCostMetadata,
} from '@/lib/tools/falai-pricing'

const FALAI_RESULT_TIMEOUT_MS = 30_000
const SAFE_ERROR_TYPES = new Set([
  'content_policy_violation',
  'no_media_generated',
  'internal_server_error',
  'generation_timeout',
  'downstream_service_error',
  'downstream_service_unavailable',
  'value_error',
  'missing',
  'string_type',
  'int_parsing',
  'enum',
  'image_too_large',
  'image_too_small',
])

interface FalAIResultResponse {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array> | null
  headers: { get(name: string): string | null }
}

/** A fal result error, without provider messages or inputs that may echo private content. */
export class FalAIResultError extends Error {
  readonly status: number

  constructor(providerStatus: number | undefined, errorTypes: string[]) {
    super(
      `Fal.ai result unavailable${providerStatus ? ` (HTTP ${providerStatus})` : ''}${errorTypes.length ? `: ${errorTypes.join(', ')}` : ''}`
    )
    this.name = 'FalAIResultError'
    this.status = providerStatus === 422 ? 422 : 502
  }
}

function safeErrorTypes(value: unknown): string[] {
  const details = isRecordLike(value) && Array.isArray(value.detail) ? value.detail : [value]
  return [
    ...new Set(
      details.flatMap((detail) =>
        isRecordLike(detail) && typeof detail.type === 'string' && SAFE_ERROR_TYPES.has(detail.type)
          ? [detail.type]
          : []
      )
    ),
  ]
}

/**
 * Starts exact receipt tracking at queue completion while bounding result retrieval. Only explicit
 * model failures skip estimates; transport failures still need a reconciliation record.
 */
export async function fetchFalAIResult({
  fetchResponse,
  apiKey,
  endpointId,
  requestId,
  trackCost,
  onCost,
  signal,
  maxResponseBytes,
  queueError,
}: {
  fetchResponse: (signal: AbortSignal) => Promise<FalAIResultResponse>
  apiKey: string
  endpointId: string
  requestId: string
  trackCost?: boolean
  onCost?: (cost: FalAICostMetadata) => void
  signal?: AbortSignal
  maxResponseBytes: number
  queueError?: unknown
}): Promise<{ data: unknown; cost?: FalAICostMetadata }> {
  const lookup = {
    apiKey,
    endpointId,
    requestId,
    deadlineAt: Date.now() + FALAI_COST_LOOKUP_TIMEOUT_MS,
  }
  let cost: FalAICostMetadata | undefined
  let data: unknown
  let generationFailed = Boolean(queueError)
  const receipt = trackCost
    ? getFalAIBillingReceipt(lookup).then((value) => {
        if (value) {
          cost = value
          onCost?.(value)
        }
        return value
      })
    : Promise.resolve(undefined)
  try {
    const [resultData] = await Promise.all([
      withinDeadline(
        async (resultSignal) => {
          if (generationFailed) throw new FalAIResultError(undefined, safeErrorTypes(queueError))
          const response = await fetchResponse(resultSignal)
          if (!response.ok) {
            generationFailed = response.status === 422
            const errorData = await readResponseJsonWithLimit(response, {
              maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
              label: 'Fal.ai result error response',
              signal: resultSignal,
            }).catch(() => undefined)
            const types = safeErrorTypes(errorData)
            generationFailed ||= response.status >= 500 && types.length > 0
            throw new FalAIResultError(response.status, types)
          }
          return readResponseJsonWithLimit(response, {
            maxBytes: maxResponseBytes,
            label: 'Fal.ai result response',
            signal: resultSignal,
          })
        },
        Date.now() + FALAI_RESULT_TIMEOUT_MS,
        signal
      ),
      receipt,
    ])
    data = resultData
  } finally {
    // Stop cannot erase a receipt; both pricing phases share the original ten-second deadline.
    await receipt
    if (trackCost && !cost && !generationFailed) {
      cost = await getFalAIEstimatedCostMetadata(lookup)
      onCost?.(cost)
    }
  }
  signal?.throwIfAborted()
  return { data, cost }
}
