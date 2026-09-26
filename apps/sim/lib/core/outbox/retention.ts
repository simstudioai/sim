import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import { KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-recovery'
import { KNOWLEDGE_STORAGE_CLEANUP_EVENT } from '@/lib/knowledge/documents/storage-cleanup'

const logger = createLogger('OutboxRetention')

/** How long a completed event stays readable for operators after it was enqueued. */
export const COMPLETED_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60_000
/**
 * Rows deleted per type per run. The processor runs once a minute, so each type drains at most
 * 1,000 rows × 1,440 runs = 1.44M rows a day: a steady trickle whose WAL and dead tuples
 * autovacuum absorbs, yet five times what recovery can enqueue (200 per run × 1,440 runs).
 */
export const OUTBOX_PRUNE_BATCH_SIZE = 1_000

/**
 * Event types whose completed rows nothing reads again: each carries a fresh random id and is
 * looked up only while pending or processing. Operation records, idempotency keys and
 * deterministic-id dedupe gates, such as the checkpoint expiry events, must outlive completion.
 */
const PRUNABLE_OUTBOX_EVENT_TYPES = [
  KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT,
  KNOWLEDGE_STORAGE_CLEANUP_EVENT,
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
