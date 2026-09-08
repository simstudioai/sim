import { backoffWithJitter } from '@sim/utils/retry'
import { EMBEDDING_QUOTA_CIRCUIT_TTL_MS } from '@/lib/embeddings/quota-circuit'
import {
  type DocumentProcessingContinuation,
  dispatchDocumentProcessingContinuation,
} from '@/lib/knowledge/documents/processing-continuation-dispatch'
import {
  createDocumentProcessingContinuationToken,
  type DocumentProcessingPayload,
} from '@/lib/knowledge/documents/processing-payload'

const MAX_QUOTA_CONTINUATION_DELAY_MS = 6 * 60 * 60 * 1000
export const MAX_QUOTA_CONTINUATION_ATTEMPTS = 8

/** Backs durable quota continuations off with jitter to a six-hour polling ceiling. */
export function resolveQuotaContinuationDelayMs(quotaRetryCount: number): number {
  return Math.min(
    backoffWithJitter(Math.max(quotaRetryCount, 1), null, {
      baseMs: EMBEDDING_QUOTA_CIRCUIT_TTL_MS,
      maxMs: MAX_QUOTA_CONTINUATION_DELAY_MS,
    }),
    MAX_QUOTA_CONTINUATION_DELAY_MS
  )
}

export function canScheduleDocumentProcessingQuotaContinuation(
  payload: Pick<DocumentProcessingPayload, 'quotaRetryCount'>
): boolean {
  return (payload.quotaRetryCount ?? 0) < MAX_QUOTA_CONTINUATION_ATTEMPTS
}

/**
 * Hands quota-blocked work to a delayed run without changing its indexing-pass
 * identity. The idempotency key makes concurrent direct and worker handoffs for
 * the same continuation generation converge on one run.
 */
export async function scheduleDocumentProcessingQuotaContinuation(
  payload: DocumentProcessingPayload,
  useTrigger?: boolean,
  predecessorAdmissionCharged = false
): Promise<DocumentProcessingContinuation> {
  if (!canScheduleDocumentProcessingQuotaContinuation(payload)) {
    throw new Error('Document processing quota continuation limit reached')
  }
  const quotaRetryCount = (payload.quotaRetryCount ?? 0) + 1
  const delayMs = resolveQuotaContinuationDelayMs(quotaRetryCount)
  const deferredUntil = new Date(Date.now() + delayMs)
  const processingQueueToken = createDocumentProcessingContinuationToken(
    payload,
    'quota',
    quotaRetryCount
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
      quotaRetryCount,
    },
    deferredUntil,
    processingQueueToken,
    useTrigger
  )
  return { deferredUntil, processingQueueToken }
}
