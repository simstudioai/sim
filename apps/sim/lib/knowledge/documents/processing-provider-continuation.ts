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
/**
 * Bounds for resuming after the deployment's own admission bucket ran out of
 * wait budget. The bucket states when capacity returns, but that estimate does
 * not know about the other documents waiting on it, so it is floored to keep
 * re-dispatches apart and capped so a document never sits idle for long while
 * the provider itself is healthy.
 */
const ADMISSION_RETRY_MIN_MS = 10_000
const ADMISSION_RETRY_MAX_MS = 60_000
const ADMISSION_RETRY_DEFAULT_MS = 15_000

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

/**
 * Delay after the local admission bucket declined a batch: the bucket's stated
 * wait, clamped, with jitter so the documents it turned away do not return in
 * lockstep. Provider-side throttling keeps {@link resolveProviderContinuationDelayMs}.
 */
export function resolveAdmissionContinuationDelayMs(retryAfterMs?: number): number {
  const stated =
    retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? retryAfterMs
      : ADMISSION_RETRY_DEFAULT_MS
  const clamped = Math.min(Math.max(stated, ADMISSION_RETRY_MIN_MS), ADMISSION_RETRY_MAX_MS)
  return Math.round(backoffWithJitter(1, null, { baseMs: clamped, maxMs: clamped }))
}

/** Defers capacity pressure without spending another document dispatch or changing billing identity. */
export async function scheduleDocumentProcessingProviderContinuation(
  payload: DocumentProcessingPayload,
  error: ProviderCapacityDeferredError,
  useTrigger?: boolean,
  predecessorAdmissionCharged = false
): Promise<DocumentProcessingContinuation> {
  const now = Date.now()
  /**
   * A processing slice and a local admission timeout both mean the provider is
   * fine and the document simply needs another turn: neither spends one of the
   * bounded provider-failure attempts, and both count against the slice budget.
   */
  const isProcessingSlice = error.reason === 'processing_budget'
  const isAdmissionTimeout = error.reason === 'admission_timeout'
  const isLocalYield = isProcessingSlice || isAdmissionTimeout
  const providerRetryCount = (payload.providerRetryCount ?? 0) + (isLocalYield ? 0 : 1)
  const processingSliceCount = (payload.processingSliceCount ?? 0) + (isLocalYield ? 1 : 0)
  const providerRetryStartedAt = payload.providerRetryStartedAt ?? new Date(now).toISOString()
  /** Tokenless legacy payloads retain a conservative handoff delay because their predecessor cannot be adopted safely. */
  const deferredUntil = new Date(
    now +
      (isProcessingSlice
        ? payload.processingQueueToken
          ? 1000
          : 60_000
        : isAdmissionTimeout
          ? resolveAdmissionContinuationDelayMs(error.retryAfterMs)
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
    isLocalYield ? 'slice' : 'provider',
    isLocalYield ? processingSliceCount : providerRetryCount
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
