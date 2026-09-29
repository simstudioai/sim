import { type BenchmarkAttempt, renewBenchmarkStage } from '@/lib/benchmarks/repository'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** This is crash detection, not a deadline: the current owner continually extends its lease. */
export const BENCHMARK_LEASE_MS = 2 * 60_000
const HEARTBEAT_MS = 30_000

export async function withBenchmarkStageLease<T>(
  attempt: BenchmarkAttempt,
  callerSignal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const ownership = new AbortController()
  const signal = callerSignal ? AbortSignal.any([callerSignal, ownership.signal]) : ownership.signal
  let pending: Promise<void> | undefined
  const heartbeat = setInterval(() => {
    if (pending || signal.aborted) return
    pending = renewBenchmarkStage({
      ...attempt,
      leaseExpiresAt: new Date(Date.now() + BENCHMARK_LEASE_MS),
    })
      .then((renewed) => {
        if (!renewed) throw new Error('Benchmark lease lost')
      })
      .catch(() => {
        ownership.abort(
          new OrchestrationError(
            'conflict',
            'This step lost its run ownership. Refresh and retry it.'
          )
        )
      })
      .finally(() => {
        pending = undefined
      })
  }, HEARTBEAT_MS)
  heartbeat.unref?.()
  try {
    signal.throwIfAborted()
    const result = await execute(signal)
    await pending
    signal.throwIfAborted()
    return result
  } finally {
    clearInterval(heartbeat)
    await pending
  }
}
