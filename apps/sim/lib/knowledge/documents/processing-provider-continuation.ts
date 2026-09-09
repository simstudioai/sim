import { backoffWithJitter } from '@sim/utils/retry'
import type { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import {
  type DocumentProcessingContinuation,
  dispatchDocumentProcessingContinuation,
} from '@/lib/knowledge/documents/processing-continuation-dispatch'
import {
  createDocumentProcessingContinuationToken,
  type DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'
import { ProviderCapacityContinuationExhaustedError } from '@/lib/knowledge/documents/processing-provider-deferral'

export const MAX_PROVIDER_CONTINUATION_ATTEMPTS = 48
export const MAX_PROCESSING_CONTINUATION_SLICES = 512
export const MAX_PROVIDER_CONTINUATION_AGE_MS = 24 * 60 * 60 * 1000
const MAX_PROVIDER_CONTINUATION_DELAY_MS = 60 * 60 * 1000

/** Server-stated waits are a lower bound, including when they exceed the ordinary polling cap. */
export function resolveProviderContinuationDelayMs(attempt: number, retryAfterMs?: number): number {
  return Math.max(
    Math.min(
      backoffWithJitter(Math.max(attempt, 1), null, {
        baseMs: 60_000,
        maxMs: MAX_PROVIDER_CONTINUATION_DELAY_MS,
      }),
      MAX_PROVIDER_CONTINUATION_DELAY_MS
    ),
    retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? retryAfterMs
      : 0
  )
}

/** Defers capacity pressure without spending another document dispatch or changing billing identity. */
export async function scheduleDocumentProcessingProviderContinuation(
  payload: DocumentProcessingPayload,
  error: ProviderCapacityDeferredError,
  useTrigger?: boolean,
  predecessorAdmissionCharged = false
): Promise<DocumentProcessingContinuation> {
  const now = Date.now()
  const isProcessingSlice = error.reason === 'processing_budget'
  const providerRetryCount = (payload.providerRetryCount ?? 0) + (isProcessingSlice ? 0 : 1)
  const processingSliceCount = (payload.processingSliceCount ?? 0) + (isProcessingSlice ? 1 : 0)
  const providerRetryStartedAt = payload.providerRetryStartedAt ?? new Date(now).toISOString()
  /** Tokenless legacy payloads retain a conservative handoff delay because their predecessor cannot be adopted safely. */
  const deferredUntil = new Date(
    now +
      (isProcessingSlice
        ? payload.processingQueueToken
          ? 1000
          : 60_000
        : resolveProviderContinuationDelayMs(providerRetryCount, error.retryAfterMs))
  )
  if (
    providerRetryCount > MAX_PROVIDER_CONTINUATION_ATTEMPTS ||
    processingSliceCount > MAX_PROCESSING_CONTINUATION_SLICES ||
    deferredUntil.getTime() >
      new Date(providerRetryStartedAt).getTime() + MAX_PROVIDER_CONTINUATION_AGE_MS
  ) {
    throw new ProviderCapacityContinuationExhaustedError()
  }
  const processingQueueToken = createDocumentProcessingContinuationToken(
    payload,
    isProcessingSlice ? 'slice' : 'provider',
    isProcessingSlice ? processingSliceCount : providerRetryCount
  )
  await dispatchDocumentProcessingContinuation(
    {
      ...payload,
      processingQueueToken,
      processingPredecessorToken: payload.processingQueueToken,
      processingPredecessorCharged: payload.processingQueueToken
        ? predecessorAdmissionCharged
        : undefined,
      processingQueuedAt: deferredUntil.toISOString(),
      ...(providerRetryCount > 0 ? { providerRetryCount } : {}),
      ...(processingSliceCount > 0 ? { processingSliceCount } : {}),
      providerRetryStartedAt,
    },
    deferredUntil,
    processingQueueToken,
    useTrigger
  )
  return { deferredUntil, processingQueueToken }
}
