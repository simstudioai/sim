/** Cancels the caller's wait even when a storage client's connection or command queue stalls. */
export async function withinDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineAt: number,
  signal?: AbortSignal
): Promise<T> {
  signal?.throwIfAborted()
  const remainingMs = deadlineAt - Date.now()
  if (remainingMs <= 0) throw new Error('Operation deadline expired')
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let rejectWait: (reason: unknown) => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectWait = reject
  })
  const rejectAborted = () => rejectWait(controller.signal.reason)
  controller.signal.addEventListener('abort', rejectAborted, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new Error('Operation deadline expired'))
  }, remainingMs)
  try {
    return await Promise.race([operation(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', rejectAborted)
  }
}
