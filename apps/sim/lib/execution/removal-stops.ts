import { db } from '@sim/db'
import { z } from 'zod'
import { getInlineJobQueue, getJobQueue } from '@/lib/core/async-jobs'
import type { JobQueueBackend } from '@/lib/core/async-jobs/types'
import {
  continueOutboxHandler,
  type OutboxHandler,
  type OutboxHandlerRegistry,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'
import { EXECUTION_REMOVAL_STOP_EVENT } from '@/lib/execution/removal-stop-event'
import { collectExecutionStops, signalExecutionStops } from '@/lib/execution/removal-stop-records'

/** Queue runs one handler attempt cancels before handing the rest to its next run. */
const SWEEP_MAX_RUNS_PER_ATTEMPT = 1_000
const HANDLER_TIMEOUT_MS = 5 * 60 * 1000

const payloadSchema = z.object({
  workspaceId: z.string().min(1).optional(),
  executions: z.array(
    z.object({
      executionId: z.string().min(1),
      executionDeadlineAt: z
        .string()
        .nullable()
        .transform((deadline) => (deadline ? new Date(deadline) : null)),
    })
  ),
})

/**
 * Sweeps the primary queue and the database queue that inline webhook runs use even when
 * Trigger.dev is primary. Each queue that loads is swept, even when the other fails to load or
 * to sweep, before the first failure is rethrown for the outbox to retry.
 */
async function sweepWorkspaceJobs(workspaceId: string, signal: AbortSignal) {
  const resolved = await Promise.allSettled([getJobQueue(), getInlineJobQueue()])
  const queues = new Set<JobQueueBackend>()
  const failures: unknown[] = []
  for (const result of resolved) {
    if (result.status === 'fulfilled') queues.add(result.value)
    else failures.push(result.reason)
  }
  const results = await Promise.allSettled(
    [...queues].map((queue) =>
      queue.cancelByWorkspace(workspaceId, { maxRuns: SWEEP_MAX_RUNS_PER_ATTEMPT, signal })
    )
  )
  let cancelledJobs = 0
  let complete = true
  for (const result of results) {
    if (result.status === 'rejected') failures.push(result.reason)
    else {
      cancelledJobs += result.value.cancelledJobs
      complete &&= result.value.complete
    }
  }
  if (failures.length > 0) throw failures[0]
  return { cancelledJobs, complete }
}

/**
 * Idempotent, so a retry repeats the whole event: a repeated signal and a repeated cancel of a
 * run that already ended are both no-ops.
 */
const stopRemovedExecutions: OutboxHandler<unknown> = withOutboxHandlerTimeout(
  async (rawPayload, context) => {
    const payload = payloadSchema.parse(rawPayload)
    const executions = new Map(
      payload.executions.map((execution) => [execution.executionId, execution])
    )
    /**
     * An archived workspace keeps its rows, so a run that passed admission before the archive
     * but logged after the stop was recorded is found here. An erased workspace has none left.
     */
    if (payload.workspaceId) {
      const { executions: live } = await collectExecutionStops(db, {
        workspaceIds: [payload.workspaceId],
      })
      for (const execution of live) executions.set(execution.executionId, execution)
    }
    const [unrecorded, sweep] = await Promise.all([
      signalExecutionStops([...executions.values()], context.signal),
      payload.workspaceId
        ? sweepWorkspaceJobs(payload.workspaceId, context.signal)
        : { cancelledJobs: 0, complete: true },
    ])
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
