import { document } from '@sim/db/schema'
import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { DOCUMENT_PROCESSING_STALE_THRESHOLD_MS } from '@/lib/knowledge/documents/processing-timeouts.server'
import { MAX_PROCESSING_ATTEMPTS, QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'

const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** One eligibility predicate is rechecked under the lifecycle locks before replacing a generation. */
export function documentProcessingRecoveryCondition(
  now: Date,
  retryCutoff = new Date(now.getTime() - RECOVERY_WINDOW_MS)
) {
  const graceCutoff = new Date(now.getTime() - QUEUED_DISPATCH_GRACE_MS)
  const processingCutoff = new Date(now.getTime() - DOCUMENT_PROCESSING_STALE_THRESHOLD_MS)
  return and(
    sql`${document.processingStatus} IN ('pending', 'processing', 'failed')`,
    isNotNull(document.connectorId),
    isNotNull(document.contentHash),
    isNotNull(document.storageKey),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    lt(document.processingAttempts, MAX_PROCESSING_ATTEMPTS),
    or(isNull(document.processingRecoveryAfter), lte(document.processingRecoveryAfter, now)),
    gt(document.uploadedAt, retryCutoff),
    or(
      and(
        eq(document.processingStatus, 'failed'),
        sql`COALESCE(${document.processingCompletedAt}, ${document.processingQueuedAt}, ${document.uploadedAt}) < ${sql.param(graceCutoff, document.processingCompletedAt)}`
      ),
      and(
        eq(document.processingStatus, 'pending'),
        sql`COALESCE(${document.processingDeferredUntil}, ${document.processingQueuedAt}, ${document.uploadedAt}) < ${sql.param(graceCutoff, document.processingQueuedAt)}`
      ),
      and(
        eq(document.processingStatus, 'processing'),
        or(isNull(document.processingStartedAt), lt(document.processingStartedAt, processingCutoff))
      )
    )
  )
}
