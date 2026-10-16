import type { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike } from '@sim/utils/object'
import {
  enqueueOutboxEvents,
  MAX_BULK_ENQUEUE_EVENTS,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { markExecutionCancelled } from '@/lib/execution/cancellation'
import { EXECUTION_STOP_OUTBOX_EVENT } from '@/lib/execution/stop-event'

const logger = createLogger('ExecutionStopOutbox')

/**
 * Stops for workflow runs whose canonical records a transaction is about to
 * erase. Once the run's log row is gone the ordinary cancel path cannot find
 * it, so the stop is written in that same transaction and the outbox retries
 * it until the cancellation flag the executor watches is durably recorded.
 */
interface ExecutionStopPayload {
  executionId: string
  /** ISO timestamp; keeps the flag alive at least as long as the run may execute. */
  executionDeadlineAt: string | null
}

export interface ExecutionToStop {
  executionId: string
  executionDeadlineAt: Date | null
}

function parsePayload(payload: unknown): ExecutionStopPayload {
  if (!isRecordLike(payload)) throw new Error('Execution stop payload must be an object')
  const { executionId, executionDeadlineAt } = payload
  if (typeof executionId !== 'string' || executionId.length === 0) {
    throw new Error('Execution stop payload is missing executionId')
  }
  if (executionDeadlineAt !== null && typeof executionDeadlineAt !== 'string') {
    throw new Error('Execution stop payload has an invalid executionDeadlineAt')
  }
  return { executionId, executionDeadlineAt }
}

/**
 * Without Redis the flag is process-local by design and no retry can make it
 * durable, so that outcome completes; a failed Redis write throws and retries.
 */
const stopExecution: OutboxHandler<unknown> = async (rawPayload, context) => {
  const payload = parsePayload(rawPayload)
  context.signal.throwIfAborted()
  const result = await markExecutionCancelled(payload.executionId, {
    executionDeadlineAt: payload.executionDeadlineAt ? new Date(payload.executionDeadlineAt) : null,
  })
  if (!result.durablyRecorded && result.reason !== 'redis_unavailable') {
    throw new Error(`Execution cancellation was not recorded (${result.reason})`)
  }
}

export const executionStopOutboxHandlers = {
  [EXECUTION_STOP_OUTBOX_EVENT]: stopExecution,
} satisfies OutboxHandlerRegistry

/** Enqueues stops inside the transaction that erases the runs' records. */
export async function enqueueExecutionStops(
  executor: Pick<typeof db, 'insert'>,
  executions: readonly ExecutionToStop[]
): Promise<string[]> {
  const eventIds: string[] = []
  for (const chunk of chunkArray([...executions], MAX_BULK_ENQUEUE_EVENTS)) {
    eventIds.push(
      ...(await enqueueOutboxEvents(
        executor,
        EXECUTION_STOP_OUTBOX_EVENT,
        chunk.map(
          ({ executionId, executionDeadlineAt }): ExecutionStopPayload => ({
            executionId,
            executionDeadlineAt: executionDeadlineAt?.toISOString() ?? null,
          })
        )
      ))
    )
  }
  return eventIds
}

/**
 * Delivers newly committed stops immediately and never throws: a stop that
 * cannot be recorded now stays in the outbox, whose worker retries it, so the
 * caller's committed write is never failed.
 */
export async function processExecutionStopsNow(
  eventIds: readonly string[],
  logContext: Record<string, unknown>
): Promise<void> {
  for (const eventId of eventIds) {
    try {
      const result = await processOutboxEventById(eventId, executionStopOutboxHandlers)
      if (result !== 'completed') {
        logger.warn('Execution stop deferred to outbox retry', { ...logContext, eventId, result })
      }
    } catch (error) {
      logger.warn('Execution stop deferred after inline processing error', {
        ...logContext,
        eventId,
        error: describeError(error),
      })
    }
  }
}
