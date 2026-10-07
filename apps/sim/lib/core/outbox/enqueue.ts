import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import {
  OUTBOX_MAINTENANCE_EVERY_INTERVALS,
  OUTBOX_PROCESSOR_INTERVAL_MS,
  OUTBOX_PROCESSOR_MAX_DURATION_SECONDS,
} from '@/lib/core/outbox/constants'
import type { OutboxProcessorResult } from '@/lib/core/outbox/processor'
import { hasDueOutboxWork } from '@/lib/core/outbox/service'
import type { processOutboxTask } from '@/background/process-outbox'

const logger = createLogger('OutboxProcessorEnqueue')

type OutboxProcessorEnqueueResult =
  | { backend: 'trigger-dev'; jobId: string }
  | { backend: 'inline'; output: OutboxProcessorResult }
  | { backend: null; triggered: false }

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

/** The database owns delivery state; the cron request waits only for durable worker acceptance. */
export async function enqueueOutboxProcessor(): Promise<OutboxProcessorEnqueueResult> {
  const now = new Date()
  const scheduleWindow = Math.floor(now.getTime() / OUTBOX_PROCESSOR_INTERVAL_MS)
  if (!(await shouldRunOutboxProcessor(now, scheduleWindow))) {
    return { backend: null, triggered: false }
  }

  if (!isTriggerDevEnabled) {
    const { runOutboxProcessor } = await import('@/lib/core/outbox/processor')
    return { backend: 'inline', output: await runOutboxProcessor() }
  }

  const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  const handle = await tasks.trigger<typeof processOutboxTask>('process-outbox', undefined, {
    idempotencyKey: `process-outbox:${scheduleWindow}`,
    idempotencyKeyTTL: '5m',
    maxDuration: OUTBOX_PROCESSOR_MAX_DURATION_SECONDS,
    region: await resolveTriggerRegion(),
  })
  return { backend: 'trigger-dev', jobId: handle.id }
}
