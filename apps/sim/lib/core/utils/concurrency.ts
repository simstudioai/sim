/**
 * A gate that runs at most `limit` of the tasks passed to it at once, starting the rest in call
 * order as slots free. Bounds one phase of otherwise concurrent work, such as the part that holds
 * database connections, without bounding the rest of it.
 */
export function createConcurrencyLimit(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async <R>(task: () => Promise<R>): Promise<R> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

/** Default bound for per-row object-storage materialization fan-out. */
export const MATERIALIZE_CONCURRENCY = 20

/** Cancels only this caller's wait, leaving the shared operation available to other callers. */
export function waitWithAbort<T>(resolution: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return resolution

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    resolution.then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
    if (signal.aborted) onAbort()
  })
}
