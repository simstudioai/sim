/**
 * Returns a promise that resolves after the specified duration.
 * Replaces the common `new Promise(resolve => setTimeout(resolve, ms))` pattern.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Sleep for `ms`, resolving early if `signal` aborts. Cleans up its own timer and listener
 * so neither leaks. Callers don't need to distinguish an early (aborted) return from a normal
 * one — the surrounding wait loop re-checks its budget or the signal immediately after and
 * bails when it has fired. Falls back to a plain sleep when no signal is provided.
 */
export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms)
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
    // Catch an abort that fired between the guard above and addEventListener.
    if (signal.aborted) onAbort()
  })
}

/** No-operation function for use as default callback. */
export const noop = () => {}

/** Splits an array into deterministic, non-empty chunks of at most `size`. */
export function chunkArray<T>(values: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('Chunk size must be a positive integer')
  }
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}
