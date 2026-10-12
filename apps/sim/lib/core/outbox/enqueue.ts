import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type ScheduledPassResult,
  triggerScheduledPass,
} from '@/lib/core/async-jobs/scheduled-pass'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import {
  OUTBOX_MAINTENANCE_EVERY_INTERVALS,
  OUTBOX_PROCESSOR_INTERVAL_MS,
  OUTBOX_PROCESSOR_MAX_DURATION_SECONDS,
} from '@/lib/core/outbox/constants'
import type { OutboxProcessorResult } from '@/lib/core/outbox/processor'
import { hasDueOutboxWork } from '@/lib/core/outbox/service'

const logger = createLogger('OutboxProcessorEnqueue')

/** A self-hosted inline run finishes before the cron request returns, so it carries its output. */
type OutboxProcessorEnqueueResult =
  | Exclude<ScheduledPassResult, { backend: 'inline' }>
  | { triggered: true; backend: 'inline'; jobId: null; output: OutboxProcessorResult }

/**
 * Every tick in the maintenance window runs, so document recovery, background-work reaping and
 * pruning keep their cadence on an idle queue. Other ticks run only when events are due or a lease
 * is stale; a gate that cannot answer runs anyway, since billing, seat sync, invitations and
 * document dispatch all ride the outbox.
 */
async function shouldRunOutboxProcessor(now: Date, scheduleWindow: number): Promise<boolean> {
  if (scheduleWindow % OUTBOX_MAINTENANCE_EVERY_INTERVALS === 0) return true
  try {
    return await hasDueOutboxWork(now)
  } catch (error) {
    logger.warn('Outbox work check failed; running the processor anyway', {
      error: getErrorMessage(error),
    })
    return true
  }
}

/**
 * The database owns delivery state; the cron request waits only for durable worker acceptance.
 * The self-hosted branch processes synchronously and returns the output the route reports, which
 * is why it stays here instead of in the scheduled pass's detached inline start.
 */
export async function enqueueOutboxProcessor(): Promise<OutboxProcessorEnqueueResult> {
  const now = new Date()
  const scheduleWindow = Math.floor(now.getTime() / OUTBOX_PROCESSOR_INTERVAL_MS)
  if (!(await shouldRunOutboxProcessor(now, scheduleWindow))) {
    return { triggered: false, backend: null, jobId: null }
  }

  if (!isTriggerDevEnabled) {
    const { runOutboxProcessor } = await import('@/lib/core/outbox/processor')
    return { triggered: true, backend: 'inline', jobId: null, output: await runOutboxProcessor() }
  }

  const jobId = await triggerScheduledPass({
    taskId: 'process-outbox',
    intervalMs: OUTBOX_PROCESSOR_INTERVAL_MS,
    at: now,
    options: { maxDuration: OUTBOX_PROCESSOR_MAX_DURATION_SECONDS },
  })
  return { triggered: true, backend: 'trigger-dev', jobId }
}
