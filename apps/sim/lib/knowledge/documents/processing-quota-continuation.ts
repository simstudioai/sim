import { backoffWithJitter } from '@sim/utils/retry'
import { tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { EMBEDDING_QUOTA_CIRCUIT_TTL_MS } from '@/lib/embeddings/quota-circuit'
import type { DocumentProcessingPayload } from '@/lib/knowledge/documents/processing-payload'

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
  payload: DocumentProcessingPayload
): Promise<Date> {
  if (!canScheduleDocumentProcessingQuotaContinuation(payload)) {
    throw new Error('Document processing quota continuation limit reached')
  }
  const quotaRetryCount = (payload.quotaRetryCount ?? 0) + 1
  const delayMs = resolveQuotaContinuationDelayMs(quotaRetryCount)
  const region = await resolveTriggerRegion()
  const deferredUntil = new Date(Date.now() + delayMs)
  await tasks.trigger(
    'knowledge-process-document',
    {
      ...payload,
      ...(payload.processingQueueToken ? { processingQueuedAt: deferredUntil.toISOString() } : {}),
      quotaRetryCount,
    },
    {
      delay: deferredUntil,
      idempotencyKey: `knowledge-quota-${payload.documentId}-${payload.requestId}-${quotaRetryCount}`,
      tags: [`knowledgeBaseId:${payload.knowledgeBaseId}`, `documentId:${payload.documentId}`],
      region,
    }
  )
  return deferredUntil
}
