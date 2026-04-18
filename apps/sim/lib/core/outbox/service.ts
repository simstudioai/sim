import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { generateId } from '@/lib/core/utils/uuid'

const logger = createLogger('OutboxService')

const DEFAULT_MAX_ATTEMPTS = 10
const STUCK_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes
const MAX_BACKOFF_MS = 60 * 60 * 1000 // 1 hour
const BASE_BACKOFF_MS = 1000 // 1 second, doubled per attempt
// Kept below the serverless route `maxDuration` (120s) so our in-process
// timeout fires before the platform kills the invocation and leaves the
// row stranded in `processing` for the 10-minute reaper window. Also well
// under `STUCK_PROCESSING_THRESHOLD_MS` so the reaper cannot steal a row
// a worker is still actively processing.
const DEFAULT_HANDLER_TIMEOUT_MS = 90 * 1000 // 90 seconds

/**
 * Context passed to every outbox handler. Use `eventId` as the Stripe
 * (or any external service) idempotency key so that handler retries
 * collapse on the external side: a second execution of the same event
 * lands on the same Stripe invoice id / charge id rather than creating
 * a duplicate. The outbox lease CAS handles our DB side.
 */
export interface OutboxEventContext {
  eventId: string
  eventType: string
  /** How many times this event has been attempted (zero on first run). */
  attempts: number
}

/**
 * A handler invoked by the outbox worker for events of a given type.
 * Throwing bumps `attempts` and schedules a retry via exponential
 * backoff; a successful return transitions the event to `completed`.
 */
export type OutboxHandler<T = unknown> = (payload: T, context: OutboxEventContext) => Promise<void>

/**
 * Map of `eventType` → handler. Register all handlers in one place
 * and pass them to `processOutboxEvents`.
 */
export type OutboxHandlerRegistry = Record<string, OutboxHandler>

export interface EnqueueOptions {
  /** Total attempts before the event moves to `dead_letter`. Default 10. */
  maxAttempts?: number
  /** Earliest time a worker may pick up this event. Default now. */
  availableAt?: Date
}

export interface ProcessOutboxResult {
  processed: number
  retried: number
  deadLettered: number
  leaseLost: number
  reaped: number
}

/**
 * Transactional outbox for reliable "DB write + external system" flows.
 *
 * Callers enqueue an event *inside* a `db.transaction` alongside the
 * primary write; the event row commits or rolls back with the business
 * data. A polling worker (invoked via the cron endpoint) claims pending
 * rows with `SELECT ... FOR UPDATE SKIP LOCKED`, marks them as
 * `processing`, runs the registered handler outside the transaction,
 * and transitions the event to `completed` / `pending` (retry) /
 * `dead_letter` (max attempts exceeded).
 *
 * Two-phase claim-then-process keeps external API calls out of DB
 * transactions. A reaper at the top of each run reclaims `processing`
 * rows whose worker died mid-operation (stale `lockedAt`).
 *
 * Enqueue must be called with a `tx` from `db.transaction` so atomicity
 * with the primary write is preserved. `db` itself is also accepted but
 * then the caller must guarantee the enqueue and the primary write share
 * a transaction some other way (or none at all).
 */
export async function enqueueOutboxEvent<T>(
  executor: Pick<typeof db, 'insert'>,
  eventType: string,
  payload: T,
  options: EnqueueOptions = {}
): Promise<string> {
  const id = generateId()
  await executor.insert(outboxEvent).values({
    id,
    eventType,
    payload: payload as never,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    availableAt: options.availableAt ?? new Date(),
  })
  logger.info('Enqueued outbox event', { id, eventType })
  return id
}

/**
 * Process one batch of outbox events. Safe to call concurrently from
 * multiple workers — `SELECT FOR UPDATE SKIP LOCKED` serializes claims.
 */
export async function processOutboxEvents(
  handlers: OutboxHandlerRegistry,
  options: { batchSize?: number } = {}
): Promise<ProcessOutboxResult> {
  const batchSize = options.batchSize ?? 10

  const reaped = await reapStuckProcessingRows()

  const claimed = await claimBatch(batchSize)
  if (claimed.length === 0) {
    return { processed: 0, retried: 0, deadLettered: 0, leaseLost: 0, reaped }
  }

  let processed = 0
  let retried = 0
  let deadLettered = 0
  let leaseLost = 0

  for (const event of claimed) {
    const result = await runHandler(event, handlers)
    if (result === 'completed') processed++
    else if (result === 'dead_letter') deadLettered++
    else if (result === 'lease_lost') leaseLost++
    else retried++
  }

  return { processed, retried, deadLettered, leaseLost, reaped }
}

/**
 * Reaper: move `processing` rows whose worker died (stale `lockedAt`)
 * back to `pending` so another worker can pick them up. Without this,
 * a SIGKILL between claim and result-write would permanently strand
 * the row in `processing`.
 */
async function reapStuckProcessingRows(): Promise<number> {
  const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS)
  const result = await db
    .update(outboxEvent)
    .set({ status: 'pending', lockedAt: null })
    .where(and(eq(outboxEvent.status, 'processing'), lte(outboxEvent.lockedAt, stuckBefore)))
    .returning({ id: outboxEvent.id })

  if (result.length > 0) {
    logger.warn('Reaped stuck outbox processing rows', {
      count: result.length,
      thresholdMs: STUCK_PROCESSING_THRESHOLD_MS,
    })
  }
  return result.length
}

/**
 * Phase 1: claim a batch of due pending events.
 *
 * `SELECT ... FOR UPDATE SKIP LOCKED` atomically picks rows that no
 * other worker is currently looking at. We then flip those rows to
 * `processing` inside the same tx so the claim survives the lock
 * release — the status change becomes the out-of-band mutual exclusion.
 */
async function claimBatch(batchSize: number): Promise<(typeof outboxEvent.$inferSelect)[]> {
  const now = new Date()
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.status, 'pending'), lte(outboxEvent.availableAt, now)))
      .orderBy(asc(outboxEvent.createdAt))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    if (rows.length === 0) return []

    await tx
      .update(outboxEvent)
      .set({ status: 'processing', lockedAt: now })
      .where(
        inArray(
          outboxEvent.id,
          rows.map((r) => r.id)
        )
      )

    // Return rows with the claim state we just committed. `lockedAt`
    // on this object is the authoritative lease timestamp used by the
    // terminal-update lease CAS (see `runHandler`).
    return rows.map((row) => ({
      ...row,
      status: 'processing' as const,
      lockedAt: now,
    }))
  })
}

/**
 * Phase 2: invoke the handler for a claimed event, outside any DB
 * transaction, then transition the row to its terminal or retry state.
 *
 * Every terminal UPDATE is guarded by a lease CAS (`WHERE status =
 * 'processing' AND locked_at = event.lockedAt`). This defends against
 * the "slow handler + reaper" race: if our handler takes longer than
 * `STUCK_PROCESSING_THRESHOLD_MS`, the reaper will have reset the row
 * to `pending` and another worker may have reclaimed it with a fresh
 * `locked_at`. Our stale terminal write's WHERE clause won't match —
 * rowCount is 0 — and we log+skip instead of clobbering the new lease.
 */
async function runHandler(
  event: typeof outboxEvent.$inferSelect,
  handlers: OutboxHandlerRegistry
): Promise<'completed' | 'pending' | 'dead_letter' | 'lease_lost'> {
  const handler = handlers[event.eventType]

  if (!handler) {
    logger.error('No handler registered for outbox event type', {
      eventId: event.id,
      eventType: event.eventType,
    })
    await updateIfLeaseHeld(event, {
      status: 'dead_letter',
      lastError: `No handler registered for event type '${event.eventType}'`,
      processedAt: new Date(),
      lockedAt: null,
    })
    return 'dead_letter'
  }

  try {
    await runHandlerWithTimeout(handler, event)
    const updated = await updateIfLeaseHeld(event, {
      status: 'completed',
      processedAt: new Date(),
      lockedAt: null,
    })
    if (!updated) {
      logger.warn('Outbox event completion skipped — lease lost (reaped + reclaimed)', {
        eventId: event.id,
        eventType: event.eventType,
      })
      return 'lease_lost'
    }
    logger.info('Outbox event processed', {
      eventId: event.id,
      eventType: event.eventType,
      attempts: event.attempts + 1,
    })
    return 'completed'
  } catch (error) {
    const nextAttempts = event.attempts + 1
    const isDead = nextAttempts >= event.maxAttempts
    const errMsg = error instanceof Error ? error.message : String(error)

    if (isDead) {
      const updated = await updateIfLeaseHeld(event, {
        attempts: nextAttempts,
        status: 'dead_letter',
        lastError: errMsg,
        processedAt: new Date(),
        lockedAt: null,
      })
      if (!updated) {
        logger.warn('Outbox event dead-letter skipped — lease lost', {
          eventId: event.id,
          eventType: event.eventType,
        })
        return 'lease_lost'
      }
      logger.error('Outbox event dead-lettered after max attempts', {
        eventId: event.id,
        eventType: event.eventType,
        attempts: nextAttempts,
        error: errMsg,
      })
      return 'dead_letter'
    }

    // Exponential backoff, capped at MAX_BACKOFF_MS.
    const backoffMs = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** nextAttempts)
    const nextAvailableAt = new Date(Date.now() + backoffMs)
    const updated = await updateIfLeaseHeld(event, {
      attempts: nextAttempts,
      status: 'pending',
      lastError: errMsg,
      availableAt: nextAvailableAt,
      lockedAt: null,
    })
    if (!updated) {
      logger.warn('Outbox event retry-schedule skipped — lease lost', {
        eventId: event.id,
        eventType: event.eventType,
      })
      return 'lease_lost'
    }
    logger.warn('Outbox event failed, scheduled retry', {
      eventId: event.id,
      eventType: event.eventType,
      attempts: nextAttempts,
      backoffMs,
      nextAvailableAt: nextAvailableAt.toISOString(),
      error: errMsg,
    })
    return 'pending'
  }
}

function runHandlerWithTimeout(
  handler: OutboxHandler,
  event: typeof outboxEvent.$inferSelect,
  timeoutMs: number = DEFAULT_HANDLER_TIMEOUT_MS
): Promise<void> {
  const context: OutboxEventContext = {
    eventId: event.id,
    eventType: event.eventType,
    attempts: event.attempts,
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Outbox handler timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    handler(event.payload, context)
      .then((value) => {
        clearTimeout(timeout)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timeout)
        reject(err)
      })
  })
}

/**
 * Conditional terminal update scoped to the lease acquired at claim
 * time. Returns true if the UPDATE affected a row, false if the row's
 * lease was revoked (reaped, reclaimed by another worker). Callers
 * treat `false` as a "lease lost" signal and skip without retrying —
 * the newer owner is responsible for the row now.
 */
async function updateIfLeaseHeld(
  event: typeof outboxEvent.$inferSelect,
  patch: {
    status: 'completed' | 'pending' | 'dead_letter'
    attempts?: number
    lastError?: string | null
    availableAt?: Date
    lockedAt: Date | null
    processedAt?: Date | null
  }
): Promise<boolean> {
  const whereClauses = [eq(outboxEvent.id, event.id), eq(outboxEvent.status, 'processing')]
  if (event.lockedAt) {
    whereClauses.push(eq(outboxEvent.lockedAt, event.lockedAt))
  }

  const result = await db
    .update(outboxEvent)
    .set(patch)
    .where(and(...whereClauses))
    .returning({ id: outboxEvent.id })

  return result.length > 0
}
