import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { getInlineJobQueue, getJobQueue } from '@/lib/core/async-jobs'
import {
  continueOutboxHandler,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  processOutboxEventById,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { EXECUTION_REMOVAL_STOP_EVENT } from '@/lib/execution/removal-stop-event'
import {
  type ExecutionStopPayload,
  signalExecutionStops,
} from '@/lib/execution/removal-stop-records'

const logger = createLogger('ExecutionRemovalStops')

/** Queue runs one handler attempt cancels before handing the rest to its next run. */
const SWEEP_MAX_RUNS_PER_ATTEMPT = 1_000
const HANDLER_TIMEOUT_MS = 5 * 60 * 1000
const DELIVERY_CONCURRENCY = 4

function parsePayload(payload: unknown): ExecutionStopPayload {
  if (!isRecordLike(payload) || !Array.isArray(payload.executions)) {
    throw new Error('Execution removal stop payload is malformed')
  }
  let workspaceId: string | undefined
  if (payload.workspaceId !== undefined) {
    if (typeof payload.workspaceId !== 'string' || payload.workspaceId.length === 0) {
      throw new Error('Execution removal stop payload has an invalid workspaceId')
    }
    workspaceId = payload.workspaceId
  }
  const executions = payload.executions.map((entry: unknown) => {
    if (
      !isRecordLike(entry) ||
      typeof entry.executionId !== 'string' ||
      entry.executionId.length === 0 ||
      (entry.executionDeadlineAt !== null && typeof entry.executionDeadlineAt !== 'string')
    ) {
      throw new Error('Execution removal stop payload has an invalid execution')
    }
    return { executionId: entry.executionId, executionDeadlineAt: entry.executionDeadlineAt }
  })
  return { ...(workspaceId ? { workspaceId } : {}), executions }
}

/**
 * Sweeps the primary queue and the database queue that inline webhook runs use even when
 * Trigger.dev is primary. Both are attempted before the first failure is rethrown.
 */
async function sweepWorkspaceJobs(workspaceId: string, signal: AbortSignal) {
  const queues = new Set([await getJobQueue(), await getInlineJobQueue()])
  const results = await Promise.allSettled(
    [...queues].map((queue) =>
      queue.cancelByWorkspace(workspaceId, { maxRuns: SWEEP_MAX_RUNS_PER_ATTEMPT, signal })
    )
  )
  let cancelledJobs = 0
  let complete = true
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason
    cancelledJobs += result.value.cancelledJobs
    complete &&= result.value.complete
  }
  return { cancelledJobs, complete }
}

/**
 * Idempotent, so a retry repeats the whole event: a repeated signal and a repeated cancel of a
 * run that already ended are both no-ops.
 */
const stopRemovedExecutions: OutboxHandler<unknown> = withOutboxHandlerTimeout(
  async (rawPayload, context) => {
    const payload = parsePayload(rawPayload)
    const unrecorded = await signalExecutionStops(
      payload.executions.map(({ executionId, executionDeadlineAt }) => ({
        executionId,
        executionDeadlineAt: executionDeadlineAt ? new Date(executionDeadlineAt) : null,
      })),
      context.signal
    )
    const sweep = payload.workspaceId
      ? await sweepWorkspaceJobs(payload.workspaceId, context.signal)
      : { cancelledJobs: 0, complete: true }
    if (unrecorded > 0) {
      throw new Error(`${unrecorded} execution cancellations were not recorded`)
    }
    if (!sweep.complete) {
      if (sweep.cancelledJobs === 0) throw new Error('Workspace job sweep made no progress')
      return continueOutboxHandler('Workspace job sweep reached its per-attempt cap')
    }
  },
  HANDLER_TIMEOUT_MS
)

export const executionRemovalStopOutboxHandlers = {
  [EXECUTION_REMOVAL_STOP_EVENT]: stopRemovedExecutions,
} satisfies OutboxHandlerRegistry

/**
 * Delivers committed stops now, a few at a time, and never throws: a stop that cannot be
 * delivered stays in the outbox for its worker to retry, so a removal that already committed is
 * never reported as failed.
 */
export async function deliverExecutionStops(
  eventIds: readonly string[],
  logContext: Record<string, unknown>
): Promise<void> {
  await mapWithConcurrency(eventIds, DELIVERY_CONCURRENCY, async (eventId) => {
    try {
      const result = await processOutboxEventById(eventId, executionRemovalStopOutboxHandlers)
      if (result !== 'completed') {
        logger.warn('Execution removal stop left to the outbox worker', {
          ...logContext,
          eventId,
          result,
        })
      }
    } catch (error) {
      logger.warn('Execution removal stop failed inline; the outbox worker retries it', {
        ...logContext,
        eventId,
        error: describeError(error),
      })
    }
  })
}
