import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { recordUndispatchedDocumentFailure } from '@/lib/knowledge/documents/processing-claim'
import {
  type DocumentData,
  type ProcessingOptions,
  processDocumentsWithQueue,
} from '@/lib/knowledge/documents/service'

interface DispatchDocumentProcessingParams {
  documents: DocumentData[]
  knowledgeBaseId: string
  processingOptions: ProcessingOptions
  requestId: string
  billingAttribution: BillingAttributionSnapshot | undefined
}

const logger = createLogger('DocumentProcessingDispatch')

async function recordDispatchFailures({
  documentIds,
  knowledgeBaseId,
  failureMessage,
  requestId,
}: {
  documentIds: string[]
  knowledgeBaseId: string
  failureMessage: string
  requestId: string
}): Promise<void> {
  for (const documentId of documentIds) {
    try {
      await recordUndispatchedDocumentFailure({
        documentId,
        knowledgeBaseId,
        failureMessage,
        requestId,
      })
    } catch (error) {
      logger.error('Failed to record an undispatched knowledge document', {
        documentId,
        knowledgeBaseId,
        error: getErrorMessage(error),
      })
    }
  }
}

/**
 * Dispatches document processing and records the failure against every document
 * it stranded, rather than only logging it.
 *
 * The wrapper lives beside the callers rather than inside
 * `processDocumentsWithQueue` deliberately. Two of that function's callers must
 * NOT unwind: the connector sweep swallows dispatch failure so its documents
 * stay reclaimable by the next sync, and the outbox handler lets the throw
 * propagate so the relay retries it. A write inside the funnel would break both.
 *
 * Never throws. Every caller here dispatches fire-and-forget after its own
 * response has been decided, so there is no one left to handle a rejection.
 */
export async function dispatchDocumentProcessing({
  documents,
  knowledgeBaseId,
  processingOptions,
  requestId,
  billingAttribution,
}: DispatchDocumentProcessingParams): Promise<void> {
  if (documents.length === 0) return

  let failedDocumentIds: string[]
  let failureMessage: string
  try {
    const dispatch = await processDocumentsWithQueue(
      documents,
      knowledgeBaseId,
      processingOptions,
      requestId,
      billingAttribution
    )
    failedDocumentIds = dispatch.failedDocumentIds
    failureMessage = 'Document processing dispatch was not accepted'
  } catch (error) {
    failedDocumentIds = documents.map((document) => document.documentId)
    failureMessage = getErrorMessage(error, 'Document processing dispatch failed')
  }

  await recordDispatchFailures({
    documentIds: failedDocumentIds,
    knowledgeBaseId,
    failureMessage,
    requestId,
  })
}
