import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import {
  OUTBOX_PROCESSOR_INTERVAL_MS,
  OUTBOX_PROCESSOR_MAX_DURATION_SECONDS,
} from '@/lib/core/outbox/constants'
import type { OutboxProcessorResult } from '@/lib/core/outbox/processor'
import type { processOutboxTask } from '@/background/process-outbox'

type OutboxProcessorEnqueueResult =
  | { backend: 'trigger-dev'; jobId: string }
  | { backend: 'inline'; output: OutboxProcessorResult }

/** The database owns delivery state; the cron request waits only for durable worker acceptance. */
export async function enqueueOutboxProcessor(): Promise<OutboxProcessorEnqueueResult> {
  if (!isTriggerDevEnabled) {
    const { runOutboxProcessor } = await import('@/lib/core/outbox/processor')
    return { backend: 'inline', output: await runOutboxProcessor() }
  }

  const [{ tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  const scheduleWindow = Math.floor(Date.now() / OUTBOX_PROCESSOR_INTERVAL_MS)
  const handle = await tasks.trigger<typeof processOutboxTask>('process-outbox', undefined, {
    idempotencyKey: `process-outbox:${scheduleWindow}`,
    idempotencyKeyTTL: '5m',
    maxDuration: OUTBOX_PROCESSOR_MAX_DURATION_SECONDS,
    region: await resolveTriggerRegion(),
  })
  return { backend: 'trigger-dev', jobId: handle.id }
}
