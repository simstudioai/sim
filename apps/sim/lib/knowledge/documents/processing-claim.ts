import { db } from '@sim/db'
import { document } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import { DOCUMENT_PROCESSING_STALE_THRESHOLD_MS } from '@/lib/knowledge/documents/processing-timeouts.server'

const logger = createLogger('KnowledgeDocumentProcessingClaim')

export { DOCUMENT_PROCESSING_STALE_THRESHOLD_MS as KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS } from '@/lib/knowledge/documents/processing-timeouts.server'

interface ReclaimStaleDocumentProcessingClaimParams {
  knowledgeBaseId: string
  documentId: string
  processingStartedAt: Date | null
  now?: Date
}

interface FailStaleDocumentProcessingClaimParams {
  knowledgeBaseId: string
  documentId: string
  processingStartedAt: Date
  now?: Date
}

/**
 * Reopens an abandoned processing attempt using its start time as a compare-and-set token.
 * The former worker's timestamp-guarded writes then cannot commit after the claim is reclaimed.
 */
export async function reclaimStaleDocumentProcessingClaim({
  knowledgeBaseId,
  documentId,
  processingStartedAt,
  now = new Date(),
}: ReclaimStaleDocumentProcessingClaimParams): Promise<boolean> {
  if (
    processingStartedAt &&
    now.getTime() - processingStartedAt.getTime() <= DOCUMENT_PROCESSING_STALE_THRESHOLD_MS
  ) {
    return false
  }

  const processingStartedAtGuard = processingStartedAt
    ? eq(document.processingStartedAt, processingStartedAt)
    : isNull(document.processingStartedAt)
  const [reclaimed] = await db
    .update(document)
    .set({
      processingStatus: 'pending',
      processingQueueToken: null,
      processingQueuedAt: null,
      processingStartedAt: null,
      processingCompletedAt: null,
      processingError: null,
    })
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.processingStatus, 'processing'),
        processingStartedAtGuard,
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .returning({ id: document.id })

  return Boolean(reclaimed)
}

/** Marks only the abandoned processing attempt identified by its start-time token as failed. */
export async function failStaleDocumentProcessingClaim({
  knowledgeBaseId,
  documentId,
  processingStartedAt,
  now = new Date(),
}: FailStaleDocumentProcessingClaimParams): Promise<{
  success: boolean
  processingDuration: number
}> {
  const processingDuration = now.getTime() - processingStartedAt.getTime()
  if (processingDuration <= DOCUMENT_PROCESSING_STALE_THRESHOLD_MS) {
    throw new Error('Document has not been processing long enough to be considered dead')
  }

  const [failed] = await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingError: 'Processing timed out. Please retry or re-sync the connector.',
      processingDeferredUntil: null,
      processingCompletedAt: now,
    })
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.processingStatus, 'processing'),
        eq(document.processingStartedAt, processingStartedAt),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .returning({ id: document.id })

  return { success: Boolean(failed), processingDuration }
}

interface FailUndispatchedDocumentProcessingParams {
  documentId: string
  knowledgeBaseId: string
  processingQueueToken: string
  error: string
  now?: Date
}

/**
 * Marks a document whose indexing dispatch never got off the ground as `failed`.
 *
 * A document registered by a completed upload sits at `pending` until a worker
 * claims it. Nothing sweeps `pending`, and `retryProcessing` only accepts a
 * `failed` document, so a document left there after a failed dispatch is
 * invisible and unrecoverable. Recording the failure puts it on the same path
 * as any other processing failure: visible in the document list with its error,
 * and re-queueable.
 *
 * Guarded on active `pending` state and the dispatch generation so it cannot
 * overwrite a worker that already claimed the row, a newer queued pass, or a
 * recent pre-token pass that may still start. A failed dispatch retains its
 * generation token while withdrawing the live queue timestamp, so finalization
 * can use one exact compare-and-set instead of matching an ambiguous blank row.
 */
export async function failUndispatchedDocumentProcessing({
  documentId,
  knowledgeBaseId,
  processingQueueToken,
  error,
  now = new Date(),
}: FailUndispatchedDocumentProcessingParams): Promise<boolean> {
  const [failed] = await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingError: error,
      processingDeferredUntil: null,
      processingCompletedAt: now,
    })
    .where(
      and(
        eq(document.id, documentId),
        eq(document.knowledgeBaseId, knowledgeBaseId),
        eq(document.processingStatus, 'pending'),
        eq(document.userExcluded, false),
        eq(document.processingQueueToken, processingQueueToken),
        isNull(document.processingQueuedAt),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .returning({ id: document.id })

  return Boolean(failed)
}

/** Log line every dispatch-failure unwind shares, so one query finds them all. */
export const PROCESSING_DISPATCH_FAILURE_MESSAGE = 'Knowledge document processing dispatch failed'

/** `processing_error` is displayed verbatim, so a provider stack trace is trimmed. */
const DISPATCH_FAILURE_MESSAGE_MAX_LENGTH = 500

interface RecordUndispatchedDocumentFailureParams {
  documentId: string
  knowledgeBaseId: string
  failureMessage: string
  requestId: string
}

/**
 * Records a failed dispatch against the document it stranded.
 *
 * The one place every caller that dispatches processing unwinds through, so a
 * document whose dispatch threw is never left silently `pending`: nothing sweeps
 * upload documents (their `connector_id` is NULL, and the stuck-document sweep
 * is connector-scoped), so without this the row is invisible and unrecoverable.
 *
 * Never throws. It runs on a path that is already handling a failure, and a
 * second one must not displace the first.
 */
export async function recordUndispatchedDocumentFailure({
  documentId,
  knowledgeBaseId,
  failureMessage,
  requestId,
}: RecordUndispatchedDocumentFailureParams): Promise<void> {
  logger.error(PROCESSING_DISPATCH_FAILURE_MESSAGE, {
    requestId,
    documentId,
    knowledgeBaseId,
    error: failureMessage,
  })
  try {
    await failUndispatchedDocumentProcessing({
      documentId,
      knowledgeBaseId,
      processingQueueToken: requestId,
      error: truncate(failureMessage, DISPATCH_FAILURE_MESSAGE_MAX_LENGTH),
    })
  } catch (markError) {
    logger.error('Failed to record a knowledge document dispatch failure', {
      requestId,
      documentId,
      knowledgeBaseId,
      error: getErrorMessage(markError),
    })
  }
}
