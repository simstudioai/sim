import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import {
  CHAT_BACKEND_CLEANUP_EVENT,
  CHAT_INLINE_IMAGE_CLEANUP_EVENT,
} from '@/lib/cleanup/chat-backend-cleanup-event'
import {
  EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
  OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
  VISION_CHECKPOINT_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/checkpoint-events'
import { KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-recovery-event'
import { KNOWLEDGE_STORAGE_CLEANUP_EVENT } from '@/lib/knowledge/documents/storage-cleanup-event'
import { MEMORY_CLEANUP_EVENT } from '@/lib/mothership/memories/cleanup-event'
import {
  WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT,
  WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
} from '@/lib/uploads/contexts/workspace/file-outbox-events'

const logger = createLogger('OutboxRetention')

/** How long a completed event stays readable for operators after it was enqueued. */
export const COMPLETED_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60_000
/**
 * Most rows deleted per type per maintenance run. A type enqueued faster than this per run grows
 * a backlog that later, quieter runs drain.
 */
export const OUTBOX_PRUNE_BATCH_SIZE = 1_000

/**
 * Event types whose completed rows nothing reads again once the retention window has passed.
 *
 * Most carry a fresh random id and are looked up only while pending or processing, by the
 * immediate `processOutboxEventById` after their transaction commits. The checkpoint expiry events
 * are deterministic-id gates instead: a writer inserts the row before uploading and skips the
 * upload when the row exists but is no longer pending, because the object's cleanup already ran.
 * The row completes at the checkpoint's expiry, well inside the window, and once it is pruned a
 * later writer of the same key inserts a fresh pending row before its upload, so every object it
 * writes still has a cleanup.
 *
 * Kept: operation records and receipt effects read back by id (workflow deployment events, the
 * workspace operation events, enterprise and admin operations), idempotency keys, and every
 * pending, processing and dead-letter row.
 */
const PRUNABLE_OUTBOX_EVENT_TYPES = [
  KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
  EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
  OCR_CHECKPOINT_CLEANUP_OUTBOX_EVENT,
  VISION_CHECKPOINT_CLEANUP_EVENT,
  WORKSPACE_FILE_LIVE_DOC_OUTBOX_EVENT,
  WORKSPACE_FILE_STORAGE_CLEANUP_OUTBOX_EVENT,
  MEMORY_CLEANUP_EVENT,
  CHAT_BACKEND_CLEANUP_EVENT,
  CHAT_INLINE_IMAGE_CLEANUP_EVENT,
] as const

async function pruneCompletedBatch(eventType: string, cutoff: Date): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('statement_timeout', '10000', true)`)
    const expired = tx
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, eventType),
          lt(outboxEvent.createdAt, cutoff),
          eq(outboxEvent.status, 'completed')
        )
      )
      .orderBy(asc(outboxEvent.createdAt))
      .limit(OUTBOX_PRUNE_BATCH_SIZE)
      .for('update', { skipLocked: true })
    const deleted = await tx.delete(outboxEvent).where(inArray(outboxEvent.id, expired))
    return deleted.count
  })
}

/**
 * Deletes one oldest-first batch of completed prunable events per type, enqueued before the
 * retention window, through the type/creation index. One bounded batch per run keeps a large
 * backlog from turning into a burst of deletes; overlapping runs skip each other's locked rows.
 * Pending, processing and dead-letter rows are never deleted.
 */
export async function pruneCompletedOutboxEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - COMPLETED_OUTBOX_RETENTION_MS)
  let pruned = 0
  for (const eventType of PRUNABLE_OUTBOX_EVENT_TYPES) {
    pruned += await pruneCompletedBatch(eventType, cutoff)
  }
  if (pruned > 0) logger.info('Pruned completed outbox events', { pruned })
  return pruned
}
