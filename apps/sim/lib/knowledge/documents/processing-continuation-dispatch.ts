import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { resolveTriggerRegion } from '@/lib/core/async-jobs/region'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'
import { documentProcessingQueueOptions } from '@/lib/knowledge/documents/processing-lane'
import type { DocumentProcessingPayload } from '@/lib/knowledge/documents/processing-payload'

export interface DocumentProcessingContinuation {
  readonly deferredUntil: Date
  readonly processingQueueToken: string
}

export const KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT = 'knowledge.document.processing.resume'

/**
 * Uses the deployment's existing durable worker. The outbox path covers ordinary
 * KB uploads on installations without Trigger.dev, retaining the indexing pass.
 */
export async function dispatchDocumentProcessingContinuation(
  payload: DocumentProcessingPayload,
  deferredUntil: Date,
  idempotencyKey: string,
  useTrigger = isInsideTriggerRun() || Boolean(isTriggerDevEnabled && env.TRIGGER_SECRET_KEY)
): Promise<void> {
  if (useTrigger) {
    const region = await resolveTriggerRegion()
    await tasks.trigger('knowledge-process-document', payload, {
      delay: deferredUntil,
      idempotencyKey,
      tags: [`knowledgeBaseId:${payload.knowledgeBaseId}`, `documentId:${payload.documentId}`],
      /**
       * A continuation stays in the lane its original dispatch was admitted
       * against. Re-deriving the lane here would let a backfill document that
       * deferred on quota resume as interactive work and escape the tenant's
       * bulk ceiling — the retry path would become the way around the limit.
       */
      ...documentProcessingQueueOptions(payload),
      region,
    })
    return
  }
  await db
    .insert(outboxEvent)
    .values({
      id: idempotencyKey,
      eventType: KNOWLEDGE_DOCUMENT_CONTINUATION_OUTBOX_EVENT,
      payload,
      availableAt: deferredUntil,
    })
    .onConflictDoNothing({ target: outboxEvent.id })
}
