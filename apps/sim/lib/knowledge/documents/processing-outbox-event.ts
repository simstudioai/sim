import type { db } from '@sim/db'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { enqueueOutboxEvent } from '@/lib/core/outbox/service'
import type { ProcessingOptions } from '@/lib/knowledge/documents/service'

export const KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT = 'knowledge.document.processing.dispatch'

export interface KnowledgeDocumentProcessingOutboxPayload {
  knowledgeBaseId: string
  documentId: string
  processingOptions: ProcessingOptions
  billingAttribution: BillingAttributionSnapshot
}

/** Enqueues durable processing in the same transaction that creates the document. */
export function enqueueKnowledgeDocumentProcessing(
  executor: Pick<typeof db, 'insert'>,
  payload: KnowledgeDocumentProcessingOutboxPayload
): Promise<string> {
  return enqueueOutboxEvent(executor, KNOWLEDGE_DOCUMENT_PROCESSING_OUTBOX_EVENT, payload)
}
