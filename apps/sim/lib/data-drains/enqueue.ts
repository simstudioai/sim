import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { getJobQueue, isAsyncJobEnqueueError, shouldExecuteInline } from '@/lib/core/async-jobs'
import { DATA_DRAIN_LIMITS } from '@/lib/data-drains/limits'
import { runDrain } from '@/lib/data-drains/service'
import type { RunTrigger } from '@/lib/data-drains/types'

const INLINE_CONCURRENCY_LIMIT = 2
const MAX_ENQUEUE_ATTEMPTS = 3

/** Runs one bounded export window and schedules a serialized continuation when a backlog remains. */
export async function runQueuedDrain(drainId: string, trigger: RunTrigger, signal: AbortSignal) {
  const result = await runDrain(drainId, trigger, { signal })
  if (result.status === 'success' && result.hasMore) {
    await enqueueDrain(drainId, trigger, signal)
  }
  return result
}

/** Bounds inline exports per app process and uses per-drain serialization on isolated external workers. */
export async function enqueueDrain(
  drainId: string,
  trigger: RunTrigger,
  signal: AbortSignal = new AbortController().signal
): Promise<string> {
  const queue = await getJobQueue()
  const inline = shouldExecuteInline()
  const jobId = generateId()
  for (let attempt = 1; ; attempt++) {
    signal.throwIfAborted()
    try {
      return await queue.enqueue(
        'run-data-drain',
        { drainId, trigger },
        {
          jobId,
          concurrencyKey: inline ? 'data-drains:inline' : `data-drain:${drainId}`,
          concurrencyLimit: inline ? INLINE_CONCURRENCY_LIMIT : 1,
          maxDurationSeconds: DATA_DRAIN_LIMITS.hardDurationMs / 1000,
          runner: async (_payload, signal) => runQueuedDrain(drainId, trigger, signal),
        }
      )
    } catch (error) {
      if (attempt >= MAX_ENQUEUE_ATTEMPTS || !isAsyncJobEnqueueError(error) || !error.retryable) {
        throw error
      }
      await interruptibleSleep(backoffWithJitter(attempt, null), signal)
    }
  }
}
