import type { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/attribution'
import { enqueueOutboxEvent, processOutboxEventById } from '@/lib/core/outbox/service'
import {
  KNOWLEDGE_DOCUMENT_DEFERRED_RETRY_CHECK_EVENT,
  KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT,
} from '@/lib/knowledge/documents/processing-events'
import type { DocumentProcessingLane } from '@/lib/knowledge/documents/processing-payload'
import type { DocumentProcessingSnapshot } from '@/lib/knowledge/documents/processing-recovery-queue'
import type { ProcessingOptions } from '@/lib/knowledge/documents/service'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

const logger = createLogger('KnowledgeDocumentProcessingOutbox')

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

/**
 * Enqueues durable processing in the same transaction that creates the document, under `eventId`
 * when the caller relays it once that transaction commits (see
 * {@link relayKnowledgeDocumentProcessing}).
 */
export function enqueueKnowledgeDocumentProcessing(
  executor: Pick<typeof db, 'insert'>,
  payload: KnowledgeDocumentProcessingOutboxPayload,
  eventId?: string
): Promise<string> {
  return enqueueOutboxEvent(
    executor,
    KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT,
    payload,
    eventId ? { id: eventId } : {}
  )
}

/**
 * Delivers one enqueued processing event right after the transaction that wrote it commits, so the
 * document reaches `processDocumentsWithQueue`, and the dispatch backend it picks (Trigger.dev or
 * in-process), when it is uploaded instead of when the outbox is next drained. Callers do not
 * await it: the in-process backend indexes the document before the dispatch resolves.
 *
 * The event stays the durable record. The relay claims it as the drain does (row lock, `pending`
 * only), so the two never both run it; one the relay cannot claim, or whose run fails or dies
 * mid-lease, is left to the drain, which retries it. Never throws.
 */
export async function relayKnowledgeDocumentProcessing(eventId: string): Promise<void> {
  try {
    // Loaded here: the handler module imports the document service, which imports this module.
    const { knowledgeDocumentProcessingOutboxHandlers } = await import(
      '@/lib/knowledge/documents/processing-outbox-handler'
    )
    await processOutboxEventById(eventId, knowledgeDocumentProcessingOutboxHandlers)
  } catch (error) {
    logger.warn('Knowledge document processing relay failed; the outbox drain retries it', {
      eventId,
      error: getErrorMessage(error),
    })
  }
}

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
