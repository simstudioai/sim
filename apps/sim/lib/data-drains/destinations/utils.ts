/**
 * Sleep for `ms` milliseconds, resolving early if `signal` aborts. Used by
 * destination retry/poll loops so cancelled drain runs do not hang waiting on
 * a `setTimeout` that ignores the abort signal.
 */
export function sleepUntilAborted(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timeoutId)
      resolve()
    }
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
