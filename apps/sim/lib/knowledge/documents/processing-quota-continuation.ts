import { tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { EMBEDDING_QUOTA_CIRCUIT_TTL_MS } from '@/lib/embeddings/quota-circuit'
import type { DocumentProcessingPayload } from '@/lib/knowledge/documents/processing-payload'

const MAX_QUOTA_CONTINUATION_DELAY_MS = 6 * 60 * 60 * 1000
const MAX_QUOTA_BACKOFF_EXPONENT = Math.ceil(
  Math.log2(MAX_QUOTA_CONTINUATION_DELAY_MS / EMBEDDING_QUOTA_CIRCUIT_TTL_MS)
)

/** Backs durable quota continuations off to a six-hour polling ceiling. */
export function resolveQuotaContinuationDelayMs(quotaRetryCount: number): number {
  const exponent = Math.min(Math.max(quotaRetryCount - 1, 0), MAX_QUOTA_BACKOFF_EXPONENT)
  return Math.min(EMBEDDING_QUOTA_CIRCUIT_TTL_MS * 2 ** exponent, MAX_QUOTA_CONTINUATION_DELAY_MS)
}

/**
 * Hands quota-blocked work to a delayed run without changing its indexing-pass
 * identity. The idempotency key makes concurrent direct and worker handoffs for
 * the same continuation generation converge on one run.
 */
export async function scheduleDocumentProcessingQuotaContinuation(
  payload: DocumentProcessingPayload
): Promise<void> {
  const quotaRetryCount = (payload.quotaRetryCount ?? 0) + 1
  const delayMs = resolveQuotaContinuationDelayMs(quotaRetryCount)
  await tasks.trigger(
    'knowledge-process-document',
    { ...payload, quotaRetryCount },
    {
      delay: new Date(Date.now() + delayMs),
      idempotencyKey: `knowledge-quota-${payload.documentId}-${payload.requestId}-${quotaRetryCount}`,
      tags: [`knowledgeBaseId:${payload.knowledgeBaseId}`, `documentId:${payload.documentId}`],
      region: await resolveTriggerRegion(),
    }
  )
}
