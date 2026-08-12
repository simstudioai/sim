import { db } from '@sim/db'
import { document } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

export const KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS = 10 * 60 * 1000

interface ReclaimStaleDocumentProcessingClaimParams {
  knowledgeBaseId: string
  documentId: string
  processingStartedAt: Date | null
  now?: Date
}

interface FailStaleDocumentProcessingClaimParams {
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
    now.getTime() - processingStartedAt.getTime() <=
      KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS
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
  documentId,
  processingStartedAt,
  now = new Date(),
}: FailStaleDocumentProcessingClaimParams): Promise<{
  success: boolean
  processingDuration: number
}> {
  const processingDuration = now.getTime() - processingStartedAt.getTime()
  if (processingDuration <= KNOWLEDGE_DOCUMENT_PROCESSING_STALE_THRESHOLD_MS) {
    throw new Error('Document has not been processing long enough to be considered dead')
  }

  const [failed] = await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingError: 'Processing timed out. Please retry or re-sync the connector.',
      processingCompletedAt: now,
    })
    .where(
      and(
        eq(document.id, documentId),
        eq(document.processingStatus, 'processing'),
        eq(document.processingStartedAt, processingStartedAt)
      )
    )
    .returning({ id: document.id })

  return { success: Boolean(failed), processingDuration }
}
