/**
 * Process-local registry of `AbortController`s for jobs running inline
 * (i.e. on the same Node process that enqueued them — the database-backed
 * queue path). The trigger.dev backend does not use this: cancellation there
 * is handled by `runs.cancel(jobId)` which interrupts the worker.
 *
 * Wiring:
 * - `runWorkflowColumn` registers a controller after enqueue (keyed by the
 *   returned `jobId`) and passes its `signal` into the inline task body.
 * - `DatabaseJobQueue.cancelJob` looks up the controller and aborts it so
 *   the running workflow execution can observe the signal mid-flight.
 * - The IIFE that owns the controller unregisters in `finally`.
 */
const inlineAbortControllers = new Map<string, AbortController>()

export function registerInlineAbort(jobId: string, controller: AbortController): void {
  inlineAbortControllers.set(jobId, controller)
}

export function unregisterInlineAbort(jobId: string): void {
  inlineAbortControllers.delete(jobId)
}

/**
 * Aborts the in-process controller for `jobId` if one is registered. Safe to
 * call from `cancelJob` regardless of whether the job ran inline. Returns
 * true if a controller was found and aborted.
 */
export function abortInlineJob(jobId: string, reason = 'Cancelled'): boolean {
  const controller = inlineAbortControllers.get(jobId)
  if (!controller) return false
  controller.abort(reason)
  inlineAbortControllers.delete(jobId)
  return true
}
