import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'
import { runDrain } from '@/lib/data-drains/service'
import type { RunTrigger } from '@/lib/data-drains/types'

const INLINE_CONCURRENCY_LIMIT = 2

/** Runs one bounded export window and schedules a serialized continuation when a backlog remains. */
export async function runQueuedDrain(drainId: string, trigger: RunTrigger, signal: AbortSignal) {
  const result = await runDrain(drainId, trigger, { signal })
  if (result.status === 'success' && result.hasMore) {
    await enqueueDrain(drainId, trigger)
  }
  return result
}

/** Bounds inline exports per app process and uses per-drain serialization on isolated external workers. */
export async function enqueueDrain(drainId: string, trigger: RunTrigger): Promise<string> {
  const queue = await getJobQueue()
  const inline = shouldExecuteInline()
  return queue.enqueue(
    'run-data-drain',
    { drainId, trigger },
    {
      concurrencyKey: inline ? 'data-drains:inline' : `data-drain:${drainId}`,
      concurrencyLimit: inline ? INLINE_CONCURRENCY_LIMIT : 1,
      maxDurationSeconds: DATA_DRAIN_LIMITS.hardDurationMs / 1000,
      runner: async (_payload, signal) => runQueuedDrain(drainId, trigger, signal),
    }
  )
}
