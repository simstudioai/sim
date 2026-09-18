import { document } from '@sim/db/schema'
import { and, eq, gt, isNotNull, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm'
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

/**
 * `processingAttempts` with the charge of a replaced, never-claimed queued generation given
 * back, so the replacement's own charge does not spend the budget on queue wait. Only a
 * `pending`, stamped, non-deferred row past the queue grace qualifies: no worker claimed it
 * (a claim sets `processing`, a deferral sets `processingDeferredUntil`), and replacing its
 * token fences it from ever claiming. Every other row keeps its count.
 */
export function releaseUnclaimedDispatchAttempt(now: Date): SQL {
  const graceCutoff = new Date(now.getTime() - QUEUED_DISPATCH_GRACE_MS)
  return sql`CASE WHEN ${document.processingStatus} = 'pending' AND ${document.processingDeferredUntil} IS NULL AND ${document.processingQueuedAt} < ${sql.param(graceCutoff, document.processingQueuedAt)} THEN GREATEST(${document.processingAttempts} - 1, 0) ELSE ${document.processingAttempts} END`
}
