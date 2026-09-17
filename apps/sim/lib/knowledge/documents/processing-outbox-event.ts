import type { db } from '@sim/db'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { DocumentProcessingLane } from '@/lib/knowledge/documents/processing-payload'
import type { ProcessingOptions } from '@/lib/knowledge/documents/service'

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
