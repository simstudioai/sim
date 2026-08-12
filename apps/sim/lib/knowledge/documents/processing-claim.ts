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
