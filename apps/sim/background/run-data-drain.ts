import { task } from '@trigger.dev/sdk'
import { runQueuedDrain } from '@/lib/data-drains/enqueue'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'
import type { RunTrigger } from '@/lib/data-drains/types'

interface RunDataDrainPayload {
  drainId: string
  trigger: RunTrigger
}

export const runDataDrainTask = task({
  id: 'run-data-drain',
  queue: { concurrencyLimit: 1 },
  maxDuration: DATA_DRAIN_LIMITS.hardDurationMs / 1000,
  retry: { maxAttempts: 3 },
  run: async ({ drainId, trigger }: RunDataDrainPayload, { signal }) =>
    runQueuedDrain(drainId, trigger, signal),
})
