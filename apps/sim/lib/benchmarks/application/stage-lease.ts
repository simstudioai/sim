import { type BenchmarkAttempt, renewBenchmarkStage } from '@/lib/benchmarks/repository'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** This is crash detection, not a deadline: the current owner continually extends its lease. */
export const BENCHMARK_LEASE_MS = 2 * 60_000
const HEARTBEAT_MS = 30_000

export async function withBenchmarkStageLease<T>(
  attempt: BenchmarkAttempt & { leaseExpiresAt: Date },
  callerSignal: AbortSignal | undefined,
  execute: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const ownership = new AbortController()
  const signal = callerSignal ? AbortSignal.any([callerSignal, ownership.signal]) : ownership.signal
  let pending: Promise<void> | undefined
  let finished = false
  const loseOwnership = () =>
    ownership.abort(
      new OrchestrationError('conflict', 'This step lost its run ownership. Refresh and retry it.')
    )
  let expiry = setTimeout(loseOwnership, Math.max(0, attempt.leaseExpiresAt.getTime() - Date.now()))
  expiry.unref?.()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const heartbeat = setInterval(() => {
    if (pending || signal.aborted) return
    const leaseExpiresAt = new Date(Date.now() + BENCHMARK_LEASE_MS)
    pending = renewBenchmarkStage({
      ...attempt,
      leaseExpiresAt,
    })
      .then((renewed) => {
        if (!renewed) loseOwnership()
        else if (!signal.aborted && !finished) {
          clearTimeout(expiry)
          expiry = setTimeout(loseOwnership, Math.max(0, leaseExpiresAt.getTime() - Date.now()))
          expiry.unref?.()
        }
      })
      .catch(() => {
        // A transport failure does not revoke the last acknowledged lease; expiry still fences it.
      })
      .finally(() => {
        pending = undefined
      })
  }, HEARTBEAT_MS)
  heartbeat.unref?.()
  try {
    signal.throwIfAborted()
    const result = await Promise.race([execute(signal), aborted])
    await Promise.race([pending, aborted])
    signal.throwIfAborted()
    return result
  } finally {
    finished = true
    clearInterval(heartbeat)
    clearTimeout(expiry)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
