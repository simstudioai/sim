import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import { KNOWLEDGE_DOCUMENT_RECOVERY_OUTBOX_EVENT } from '@/lib/knowledge/documents/processing-recovery'
import { KNOWLEDGE_STORAGE_CLEANUP_EVENT } from '@/lib/knowledge/documents/storage-cleanup'

const logger = createLogger('OutboxRetention')

/** How long a completed event stays readable for operators after it was enqueued. */
export const COMPLETED_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60_000
export const OUTBOX_PRUNE_BATCH_SIZE = 5_000
const OUTBOX_PRUNE_BUDGET_MS = 10_000

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
 * Deletes completed prunable events enqueued before the retention window, one oldest-first
 * batch per type in turn through the type/creation index, until the budget is spent. Pending,
 * processing and dead-letter rows are never deleted.
 */
export async function pruneCompletedOutboxEvents(now = new Date()): Promise<number> {
  const deadlineAt = Date.now() + OUTBOX_PRUNE_BUDGET_MS
  const cutoff = new Date(now.getTime() - COMPLETED_OUTBOX_RETENTION_MS)
  let pruned = 0
  let backlogged: string[] = [...PRUNABLE_OUTBOX_EVENT_TYPES]
  while (backlogged.length > 0 && Date.now() < deadlineAt) {
    const remaining: string[] = []
    for (const eventType of backlogged) {
      if (Date.now() >= deadlineAt) break
      const deleted = await pruneCompletedBatch(eventType, cutoff)
      pruned += deleted
      if (deleted === OUTBOX_PRUNE_BATCH_SIZE) remaining.push(eventType)
    }
    backlogged = remaining
  }
  if (pruned > 0) logger.info('Pruned completed outbox events', { pruned })
  return pruned
}
