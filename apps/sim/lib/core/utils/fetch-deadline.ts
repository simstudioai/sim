/**
 * Keeps the transport deadline from undercutting the application deadline.
 *
 * Bun's HTTP client arms an idle timer defaulting to 300s. It is not raised by
 * an `AbortSignal`, and it does not re-arm while awaiting response headers, so
 * it acts as an absolute deadline for the peer to begin answering. Any request
 * whose peer legitimately works before it replies dies at five minutes no
 * matter what deadline the caller computed for it.
 *
 * This bit production. Workflow function blocks are bounded by a plan deadline
 * (50 minutes on enterprise), but the executor's call into the internal
 * function route inherited Bun's default instead, so every sandbox run longer
 * than five minutes failed with a bare `fetch failed` that read as user-code
 * failure rather than a transport cap.
 *
 * The timer is therefore disarmed rather than re-negotiated: callers on this
 * path already own an in-process deadline (an `AbortController` armed with the
 * plan timeout), and a second, shorter, invisible deadline underneath it is
 * exactly the bug. Disarming leaves one enforcement point instead of two that
 * disagree.
 *
 * The pinned runtime accepts only the boolean/zero form. Measured on Bun 1.3.14
 * against a server that withholds response headers, so the numbers below are
 * the real deadline rather than an inferred one:
 *
 *   no option      -> THREW 300028ms (TimeoutError)   <- the 300s default
 *   timeout: false -> RESOLVED 310031ms               <- disarmed
 *   timeout: 1000  -> RESOLVED 3008ms on a 3s request <- numeric ignored
 *
 * So a positive numeric `timeout` silently changes nothing on this version; the
 * numeric idle-deadline form and `BUN_CONFIG_HTTP_IDLE_TIMEOUT` both exist only
 * on Bun's `main`. Do not "improve" this into a numeric pass-through until the
 * pinned version supports it, and re-measure with the probe above if you do.
 *
 * `bun-types@1.3.14` does not declare `timeout` on `BunFetchRequestInit` even
 * though the runtime honors the boolean form — the types lag the runtime, which
 * is why the interface below is declared locally rather than imported.
 *
 * Node's undici has no equivalent default and ignores the option, so this is
 * safe on both runtimes.
 */

/**
 * `RequestInit` plus Bun's idle-timeout control, which the DOM lib does not
 * declare. `false` disarms the timer; `true` or omitted keeps the default.
 */
export interface DeadlineRequestInit extends RequestInit {
  timeout?: number | boolean
}

/**
 * Disarms the transport idle timer so the caller's own deadline is the only one
 * in force.
 *
 * Only use this where the caller genuinely enforces a deadline in-process —
 * an `AbortSignal` wired to a timer or an execution budget. Without one, a
 * request to a peer that never answers would hang until the socket dies.
 */
export function withCallerOwnedDeadline(init: RequestInit): DeadlineRequestInit {
  return { ...init, timeout: false }
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
