import type { db } from '@sim/db'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DocumentProcessingLane } from '@/lib/knowledge/documents/processing-payload'
import type { DocumentProcessingSnapshot } from '@/lib/knowledge/documents/processing-recovery-queue'
import type { ProcessingOptions } from '@/lib/knowledge/documents/service'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

export const KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT = 'knowledge.document.processing.dispatch'

export interface KnowledgeDocumentProcessingOutboxPayload {
  knowledgeBaseId: string
  documentId: string
  processingOptions: ProcessingOptions
  billingAttribution: BillingAttributionSnapshot
  /**
   * Required so the relay never has to infer a lane. Rows enqueued before the
   * lanes existed carry none and are replayed conservatively as bulk.
   */
  processingLane: DocumentProcessingLane
}

/** Enqueues durable processing in the same transaction that creates the document. */
export function enqueueKnowledgeDocumentProcessing(
  executor: Pick<typeof db, 'insert'>,
  payload: KnowledgeDocumentProcessingOutboxPayload
): Promise<string> {
  return enqueueOutboxEvent(executor, KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT, payload)
}

export const KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT =
  'knowledge.document.deferred-retry-check'

/** Thrown failures only: every wait in `checkDeferredDocumentRetry` defers without spending one. */
export const DEFERRED_RETRY_CHECK_MAX_ATTEMPTS = 5

/** The one deferral a check is about: a later retry, reset, or deferral makes it a no-op. */
export interface DeferredRetryCheckPayload {
  knowledgeBaseId: string
  documentId: string
  processingQueueToken: string | null
  processingQueuedAt: string | null
  processingDeferredUntil: string
}

type DeferredDocument = DocumentProcessingSnapshot & {
  knowledgeBaseId: string
  processingDeferredUntil: Date
}

/**
 * Schedules the watchdog for an uploaded document just written back to `pending` behind a
 * database retry, in the transaction that wrote it. Connector documents have the recovery sweep;
 * an uploaded one has no sweep, so without this a lost retry would leave it `pending` for good.
 * The check becomes due once the retry is {@link QUEUED_DISPATCH_GRACE_MS} overdue, the same
 * grace the retry API applies before it treats a queued generation as lost.
 */
export function enqueueDeferredRetryCheck(
  executor: Pick<typeof db, 'insert'>,
  deferred: DeferredDocument
): Promise<string> {
  const payload: DeferredRetryCheckPayload = {
    knowledgeBaseId: deferred.knowledgeBaseId,
    documentId: deferred.id,
    processingQueueToken: deferred.processingQueueToken,
    processingQueuedAt: deferred.processingQueuedAt?.toISOString() ?? null,
    processingDeferredUntil: deferred.processingDeferredUntil.toISOString(),
  }
  return enqueueOutboxEvent(executor, KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT, payload, {
    availableAt: new Date(deferred.processingDeferredUntil.getTime() + QUEUED_DISPATCH_GRACE_MS),
    maxAttempts: DEFERRED_RETRY_CHECK_MAX_ATTEMPTS,
  })
}
