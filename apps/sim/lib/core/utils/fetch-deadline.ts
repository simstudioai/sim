/**
 * Keeps the transport deadline from undercutting the application deadline.
 *
 * Bun's HTTP client arms an idle timer defaulting to 300s. It re-arms on writes
 * and body-phase reads, but *not* on response-header reads — so it is an
 * absolute deadline for the peer to begin answering. An `AbortSignal` cannot
 * raise it, which makes it invisible to every caller that believes it owns the
 * deadline: a request whose peer legitimately works before it replies dies at
 * five minutes no matter what timeout was computed for it.
 *
 * This bit production. Workflow function blocks are bounded by a plan deadline
 * (50 minutes on enterprise), but the executor's call into the internal
 * function route inherited Bun's default instead, so every sandbox run longer
 * than five minutes failed with a bare `fetch failed` that read as user-code
 * failure rather than a transport cap.
 *
 * Node's undici has no equivalent default and ignores the option, so this is
 * safe on both runtimes.
 */

/**
 * `RequestInit` plus Bun's idle-timeout control, which the DOM lib does not
 * declare. `false` disables the timer entirely; a positive number is the idle
 * deadline in milliseconds.
 */
export interface DeadlineRequestInit extends RequestInit {
  timeout?: number | boolean
}

/**
 * Applies `deadlineMs` as the transport idle deadline alongside whatever
 * `AbortSignal` the caller already set, so both layers express one number.
 *
 * Pass the same deadline the caller enforces in-process. A non-finite or
 * non-positive deadline means "no application bound", which disables the
 * transport timer rather than silently falling back to Bun's 300s default —
 * falling back is what produced the bug this exists to prevent.
 */
export function withFetchDeadline(
  init: RequestInit,
  deadlineMs: number | undefined
): DeadlineRequestInit {
  if (deadlineMs === undefined || !Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return { ...init, timeout: false }
  }
  return { ...init, timeout: Math.ceil(deadlineMs) }
}

/**
 * Whether a caught error is the transport giving up rather than the request
 * being cancelled or the peer erroring.
 *
 * Bun reports both an unanswered request and a truncated body as
 * `TimeoutError: The operation timed out.`, and surfaces a severed connection
 * as a bare `fetch failed` — none of which name the hop, the elapsed time, or
 * the fact that a cap was hit. Callers use this to annotate before rethrowing
 * so a transport cap cannot masquerade as a failure of the work itself.
 */
export function isTransportTimeoutError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  if (error.name === 'TimeoutError') return true
  return error.name === 'TypeError' && error.message === 'fetch failed'
}
