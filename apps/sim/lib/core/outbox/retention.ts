import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  CHAT_BACKEND_CLEANUP_EVENT,
  CHAT_INLINE_IMAGE_CLEANUP_EVENT,
} from '@/lib/cleanup/chat-backend-cleanup-event'
import { getRedisClient } from '@/lib/core/config/redis'
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

/**
 * How long one oldest-to-newest pass over a type keeps resuming where the previous run's batch
 * ended. The run after that starts again from the oldest row, so a row the pass went by before it
 * completed, or while an overlapping run held its lock, is still pruned.
 */
export const OUTBOX_PRUNE_PASS_MAX_MS = 60 * 60_000

/**
 * `created_at::text` under PostgreSQL's ISO date style, to the microsecond. A stored value that is
 * not a real calendar time fails the round trip here instead of the batch's `::timestamp` cast.
 */
const postgresTimestampSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/.test(value)) return false
  const seconds = value.slice(0, 19).replace(' ', 'T')
  const parsed = new Date(`${seconds}Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(seconds)
})

/**
 * Where a type's pass resumes: the creation time, as PostgreSQL prints it so no microseconds are
 * lost, and id of the last row the previous batch deleted.
 */
const resumePointSchema = z.object({ createdAt: postgresTimestampSchema, id: z.string() })
const pruneCursorSchema = resumePointSchema.extend({ passStartedAt: z.number() })

type ResumePoint = z.infer<typeof resumePointSchema>
type PruneCursor = z.infer<typeof pruneCursorSchema>

const pruneCursorKey = (eventType: string) => `outbox-prune-cursor:v1:${eventType}`

/**
 * Each type's cursor from the pass in progress, or null when Redis is unavailable. A missing,
 * unreadable or expired cursor starts that type's pass from the oldest row.
 */
async function readPruneCursors(now: Date): Promise<Map<string, PruneCursor> | null> {
  const redis = getRedisClient()
  if (!redis) return null
  try {
    const stored = await redis.mget(...PRUNABLE_OUTBOX_EVENT_TYPES.map(pruneCursorKey))
    const cursors = new Map<string, PruneCursor>()
    PRUNABLE_OUTBOX_EVENT_TYPES.forEach((eventType, index) => {
      const cursor = parsePruneCursor(stored[index])
      if (cursor && now.getTime() - cursor.passStartedAt < OUTBOX_PRUNE_PASS_MAX_MS) {
        cursors.set(eventType, cursor)
      }
    })
    return cursors
  } catch (error) {
    logger.warn('Failed to read outbox prune cursors; pruning from the oldest rows', {
      error: getErrorMessage(error),
    })
    return null
  }
}

function parsePruneCursor(stored: string | null): PruneCursor | null {
  if (!stored) return null
  try {
    const parsed = pruneCursorSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Stores each type's next cursor, or clears it when that type's pass is over. */
async function savePruneCursors(next: ReadonlyMap<string, PruneCursor | null>): Promise<void> {
  const redis = getRedisClient()
  if (!redis || next.size === 0) return
  try {
    const pipeline = redis.pipeline()
    for (const [eventType, cursor] of next) {
      if (cursor) {
        pipeline.set(
          pruneCursorKey(eventType),
          JSON.stringify(cursor),
          'EX',
          OUTBOX_PRUNE_PASS_MAX_MS / 1000
        )
      } else {
        pipeline.del(pruneCursorKey(eventType))
      }
    }
    await pipeline.exec()
  } catch (error) {
    logger.warn('Failed to save outbox prune cursors', { error: getErrorMessage(error) })
  }
}

/**
 * Deletes the oldest batch after `resumeAfter` in (creation time, id) order. Returns the last
 * deleted row when the batch was full, and null when it reached the cutoff and the pass is over.
 */
async function pruneCompletedBatch(
  eventType: string,
  cutoff: Date,
  resumeAfter: ResumePoint | undefined
): Promise<{ deleted: number; resumeAfter: ResumePoint | null }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('statement_timeout', '10000', true)`)
    const expired = await tx
      .select({ id: outboxEvent.id, createdAt: sql<string>`${outboxEvent.createdAt}::text` })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.eventType, eventType),
          lt(outboxEvent.createdAt, cutoff),
          eq(outboxEvent.status, 'completed'),
          resumeAfter
            ? sql`(${outboxEvent.createdAt}, ${outboxEvent.id}) > (${resumeAfter.createdAt}::timestamp, ${resumeAfter.id})`
            : undefined
        )
      )
      .orderBy(asc(outboxEvent.createdAt), asc(outboxEvent.id))
      .limit(OUTBOX_PRUNE_BATCH_SIZE)
      .for('update', { skipLocked: true })
    const last = expired.at(-1)
    if (!last) return { deleted: 0, resumeAfter: null }
    const deleted = await tx.delete(outboxEvent).where(
      inArray(
        outboxEvent.id,
        expired.map((row) => row.id)
      )
    )
    return {
      deleted: deleted.count,
      resumeAfter: expired.length === OUTBOX_PRUNE_BATCH_SIZE ? last : null,
    }
  })
}

/**
 * Deletes one oldest-first batch of completed prunable events per type, enqueued before the
 * retention window, through the type/creation index. One bounded batch per run keeps a large
 * backlog from turning into a burst of deletes; overlapping runs skip each other's locked rows.
 * Pending, processing and dead-letter rows are never deleted.
 *
 * Each batch resumes after the last row the previous run's batch deleted, kept in Redis. Starting
 * again from the oldest row would walk every index entry the earlier batches deleted that vacuum
 * has not yet removed, which grows with the backlog being drained. A pass starts over from the
 * oldest row once a batch comes up short of the cutoff or the pass is older than an hour; without
 * Redis every batch starts from the oldest row.
 */
export async function pruneCompletedOutboxEvents(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - COMPLETED_OUTBOX_RETENTION_MS)
  const cursors = await readPruneCursors(now)
  const nextCursors = new Map<string, PruneCursor | null>()
  let pruned = 0
  try {
    for (const eventType of PRUNABLE_OUTBOX_EVENT_TYPES) {
      const cursor = cursors?.get(eventType)
      const batch = await pruneCompletedBatch(eventType, cutoff, cursor)
      pruned += batch.deleted
      nextCursors.set(
        eventType,
        batch.resumeAfter && {
          ...batch.resumeAfter,
          passStartedAt: cursor?.passStartedAt ?? now.getTime(),
        }
      )
    }
  } finally {
    if (cursors) await savePruneCursors(nextCursors)
  }
  if (pruned > 0) logger.info('Pruned completed outbox events', { pruned })
  return pruned
}
