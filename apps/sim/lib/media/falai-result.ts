import { isRecordLike } from '@sim/utils/object'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  type FalAICostMetadata,
  getFalAIBillingReceipt,
  getFalAICostMetadata,
} from '@/lib/tools/falai-pricing'

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

/** A terminal fal result failure, without provider messages or inputs that may echo private content. */
export class FalAIResultError extends Error {
  readonly status: number

  constructor(providerStatus: number, errorTypes: string[]) {
    super(
      `Fal.ai generation failed (HTTP ${providerStatus}${errorTypes.length ? `; ${errorTypes.join(', ')}` : ''})`
    )
    this.name = 'FalAIResultError'
    this.status = providerStatus === 422 ? 422 : 502
  }
}

/**
 * Queue COMPLETED includes failed jobs. Preserve exact receipts for every terminal request,
 * but never estimate a charge for an explicit provider failure.
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
}: {
  fetchResponse: () => Promise<FalAIResultResponse>
  apiKey: string
  endpointId: string
  requestId: string
  trackCost?: boolean
  onCost?: (cost: FalAICostMetadata) => void
  signal?: AbortSignal
  maxResponseBytes: number
}): Promise<{ data: unknown; cost?: FalAICostMetadata }> {
  let response: FalAIResultResponse | undefined
  let cost: FalAICostMetadata | undefined
  let data: unknown
  try {
    signal?.throwIfAborted()
    response = await fetchResponse()
    if (!response.ok) {
      const errorData = await readResponseJsonWithLimit(response, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Fal.ai result error response',
        signal,
      }).catch(() => undefined)
      const details =
        isRecordLike(errorData) && Array.isArray(errorData.detail) ? errorData.detail : []
      const types = details.flatMap((detail) =>
        isRecordLike(detail) && typeof detail.type === 'string' && SAFE_ERROR_TYPES.has(detail.type)
          ? [detail.type]
          : []
      )
      throw new FalAIResultError(response.status, [...new Set(types)])
    }
    data = await readResponseJsonWithLimit(response, {
      maxBytes: maxResponseBytes,
      label: 'Fal.ai result response',
      signal,
    })
  } finally {
    // Reconciliation has its own deadline so Stop cannot erase a receipt after queue completion.
    if (trackCost) {
      const lookup = { apiKey, endpointId, requestId }
      cost =
        response?.ok === false
          ? await getFalAIBillingReceipt(lookup)
          : await getFalAICostMetadata(lookup)
      if (cost) onCost?.(cost)
    }
  }
  signal?.throwIfAborted()
  return { data, cost }
}
