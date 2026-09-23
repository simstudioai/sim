import { db } from '@sim/db'
import { document } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toStringOrNull } from '@sim/utils/coerce'
import { getTransientDatabaseFailure } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { backoffWithJitter } from '@sim/utils/retry'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import {
  type DeferredOutboxHandlerResult,
  deferOutboxHandler,
  type OutboxHandler,
} from '@/lib/core/outbox/service'
import type { DeferredRetryCheckPayload } from '@/lib/knowledge/documents/processing-outbox-event'
import {
  type DocumentProcessingSnapshot,
  documentProcessingSnapshotCondition,
  inspectDocumentProcessingLiveness,
  processingSnapshotColumns,
} from '@/lib/knowledge/documents/processing-recovery-queue'
import { QUEUED_DISPATCH_GRACE_MS, RECOVERY_WINDOW_MS } from '@/lib/knowledge/documents/types'

const logger = createLogger('KnowledgeDeferredRetryCheck')

/** How often a document whose run still looks live, or could not be looked up, is checked again. */
export const DEFERRED_RETRY_RECHECK_MS = 60 * 60 * 1000

/**
 * How long after the deferral a database failure may still postpone the check without spending
 * an attempt. The check itself stops asking about liveness at {@link RECOVERY_WINDOW_MS}; the extra
 * day lets that final write outlast a slow database window too. Past it, a database failure spends
 * attempts like any other error, so the event always reaches completion or dead letter.
 */
export const DEFERRED_RETRY_CHECK_TERMINAL_MS = RECOVERY_WINDOW_MS + 24 * 60 * 60 * 1000

/** First delay after a database failure; later ones grow with how overdue the check is. */
const DATABASE_BACKOFF_STEP_MS = 2 * 60 * 1000

export const DEFERRED_RETRY_LOST_ERROR =
  'The scheduled retry for this document did not run. Retry the document to process it again.'

function parsePayload(raw: unknown): DeferredRetryCheckPayload {
  const record = toRecord(raw)
  const knowledgeBaseId = toStringOrNull(record.knowledgeBaseId)
  const documentId = toStringOrNull(record.documentId)
  const processingDeferredUntil = toStringOrNull(record.processingDeferredUntil)
  if (!knowledgeBaseId || !documentId || !processingDeferredUntil) {
    throw new Error('Deferred retry check payload is missing its document or deferral')
  }
  return {
    knowledgeBaseId,
    documentId,
    processingQueueToken: toStringOrNull(record.processingQueueToken),
    processingQueuedAt: toStringOrNull(record.processingQueuedAt),
    processingDeferredUntil,
  }
}

function sameInstant(value: Date | null, expected: string | null): boolean {
  return (value?.getTime() ?? null) === (expected === null ? null : Date.parse(expected))
}

/** The uploaded document is still waiting on exactly the deferral this check was scheduled for. */
function isSameDeferral(
  row: DocumentProcessingSnapshot & {
    connectorId: string | null
    archivedAt: Date | null
    deletedAt: Date | null
  },
  payload: DeferredRetryCheckPayload
): row is typeof row & { processingDeferredUntil: Date } {
  return (
    row.processingStatus === 'pending' &&
    row.connectorId === null &&
    row.archivedAt === null &&
    row.deletedAt === null &&
    row.processingQueueToken === payload.processingQueueToken &&
    sameInstant(row.processingQueuedAt, payload.processingQueuedAt) &&
    row.processingDeferredUntil !== null &&
    sameInstant(row.processingDeferredUntil, payload.processingDeferredUntil)
  )
}

/**
 * Fails an uploaded document whose scheduled database retry never ran. This is a state transition
 * only: nothing is dispatched and no actor is needed, and the user's Retry re-dispatches it as
 * them. The write is fenced on the exact snapshot it inspected, so a retry that claims or
 * re-defers the document in the meantime is never overwritten.
 *
 * A run that still looks live, or whose status cannot be established, is checked again later
 * without spending an attempt. Past {@link RECOVERY_WINDOW_MS} after the deferral no retry of that
 * generation can still be running (a database retry is due within minutes and each run is bounded),
 * so the check stops asking and fails the document, which is what guarantees the event ends.
 *
 * A transient database failure while checking, most likely the same slow window that deferred the
 * document, postpones the check without spending an attempt, so the watchdog cannot dead-letter
 * during the outage it exists to outlast. That stops at {@link DEFERRED_RETRY_CHECK_TERMINAL_MS};
 * any other error spends an attempt as before.
 */
export const checkDeferredDocumentRetry: OutboxHandler<unknown> = async (
  rawPayload,
  context
): Promise<DeferredOutboxHandlerResult | undefined> => {
  const payload = parsePayload(rawPayload)
  try {
    return await checkDeferral(payload, context.signal)
  } catch (error) {
    context.signal.throwIfAborted()
    const failure = getTransientDatabaseFailure(error)
    const deferredUntil = Date.parse(payload.processingDeferredUntil)
    const now = Date.now()
    if (!failure || now >= deferredUntil + DEFERRED_RETRY_CHECK_TERMINAL_MS) throw error
    /** Paced by how long the check has been overdue, since a deferral spends no attempt to count. */
    const overdueMs = Math.max(0, now - deferredUntil - QUEUED_DISPATCH_GRACE_MS)
    return deferOutboxHandler(
      `Database ${failure} failure while checking the deferred retry`,
      backoffWithJitter(1 + Math.floor(overdueMs / DATABASE_BACKOFF_STEP_MS), null, {
        baseMs: DATABASE_BACKOFF_STEP_MS,
        maxMs: DEFERRED_RETRY_RECHECK_MS,
      }),
      false
    )
  }
}

async function checkDeferral(
  payload: DeferredRetryCheckPayload,
  signal: AbortSignal
): Promise<DeferredOutboxHandlerResult | undefined> {
  signal.throwIfAborted()
  const [row] = await db
    .select({
      ...processingSnapshotColumns,
      connectorId: document.connectorId,
      archivedAt: document.archivedAt,
      deletedAt: document.deletedAt,
    })
    .from(document)
    .where(
      and(
        eq(document.id, payload.documentId),
        eq(document.knowledgeBaseId, payload.knowledgeBaseId)
      )
    )
    .limit(1)
  if (!row || !isSameDeferral(row, payload)) return undefined

  const now = Date.now()
  const deferredUntil = row.processingDeferredUntil.getTime()
  const dueAt = deferredUntil + QUEUED_DISPATCH_GRACE_MS
  if (now < dueAt) {
    return deferOutboxHandler('Deferred retry is not overdue yet', dueAt - now, false)
  }
  if (now < deferredUntil + RECOVERY_WINDOW_MS) {
    const { abandoned } = await inspectDocumentProcessingLiveness([row], signal)
    if (abandoned.length === 0) {
      return deferOutboxHandler(
        'Deferred retry may still be running',
        DEFERRED_RETRY_RECHECK_MS,
        false
      )
    }
  }
  signal.throwIfAborted()

  const failed = await db
    .update(document)
    .set({
      processingStatus: 'failed',
      processingError: DEFERRED_RETRY_LOST_ERROR,
      processingDeferredUntil: null,
      processingCompletedAt: new Date(),
    })
    .where(
      and(
        documentProcessingSnapshotCondition(row),
        eq(document.processingStatus, 'pending'),
        isNotNull(document.processingDeferredUntil),
        isNull(document.connectorId),
        isNull(document.archivedAt),
        isNull(document.deletedAt)
      )
    )
    .returning({ id: document.id })
  if (failed.length > 0) {
    logger.warn('Uploaded document failed after its scheduled retry did not run', {
      documentId: payload.documentId,
    })
  }
  return undefined
}
