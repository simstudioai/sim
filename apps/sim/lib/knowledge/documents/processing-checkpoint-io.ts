/** Bounds storage/pool waits even when the underlying driver cannot cancel a request. */
export async function checkpointIo<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal
): Promise<T> {
  callerSignal?.throwIfAborted()
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error('Processing checkpoint storage operation timed out'))
  }, 15_000)
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      operation(signal),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export function isMissingCheckpointObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  return (
    ('code' in error && (error.code === 'ENOENT' || error.code === 'NoSuchKey')) ||
    ('name' in error && error.name === 'NoSuchKey') ||
    ('statusCode' in error && error.statusCode === 404)
  )
}
