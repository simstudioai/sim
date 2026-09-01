import { Agent, type Dispatcher } from 'undici'

/**
 * Keeps the transport deadline from undercutting the application deadline.
 *
 * Both runtimes this code executes under ship a five-minute transport default
 * that is not raised by an `AbortSignal`, so it acts as an absolute deadline
 * for the peer to begin answering. Any request whose peer legitimately works
 * before it replies dies at five minutes no matter what deadline the caller
 * computed for it:
 *
 * - Bun's HTTP client arms an idle timer defaulting to 300s. It does not
 *   re-arm while awaiting response headers. `timeout: false` disarms it.
 * - Node's fetch is undici, whose default dispatcher arms `headersTimeout`
 *   and `bodyTimeout`, both defaulting to 300e3. An expiry surfaces as
 *   `TypeError: fetch failed` with cause `HeadersTimeoutError`
 *   (`UND_ERR_HEADERS_TIMEOUT`). A request-scoped `dispatcher` that arms
 *   neither timer disarms it.
 *
 * This bit production twice, once per runtime. Workflow function blocks are
 * bounded by a plan deadline (50 minutes on enterprise, 7 days async), but the
 * executor's call into the internal function route inherited the transport
 * default instead, so every sandbox run longer than five minutes failed with a
 * bare `fetch failed` that read as user-code failure rather than a transport
 * cap. The first fix (`timeout: false`) covered the app server, which runs
 * Bun; async executions run in Trigger.dev workers (`runtime: 'node-24'` in
 * `trigger.config.ts`), where that option is silently ignored and the same
 * five-minute death reappeared as
 * `Transport failure calling function_execute after 300401ms`.
 *
 * The timers are therefore disarmed rather than re-negotiated: callers on this
 * path already own an in-process deadline (an `AbortController` armed with the
 * plan timeout), and a second, shorter, invisible deadline underneath it is
 * exactly the bug. Disarming leaves one enforcement point instead of two that
 * disagree.
 *
 * Bun accepts only the boolean/zero form of `timeout`. Measured on Bun 1.3.14
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
 * Measured on Node 23.11 (built-in fetch, bundled undici 6.21.2) driving an
 * npm `undici@7.29.0` `Agent` — a wider version split than the node-24 workers
 * run, so the cross-copy `dispatcher` handoff is proven, not assumed:
 *
 *   timeout: false only                  -> THREW 300996ms (fetch failed,
 *                                           HeadersTimeoutError)  <- ignored
 *   dispatcher armed at 200ms            -> THREW 1011ms          <- honored
 *   dispatcher with 0/0 vs a 310s server -> RESOLVED 310016ms     <- disarmed
 *
 * `bun-types@1.3.14` does not declare `timeout` on `BunFetchRequestInit`, and
 * the DOM lib does not declare undici's `dispatcher`, even though each runtime
 * honors its respective option — the types lag the runtimes, which is why the
 * interface below is declared locally rather than imported.
 */

/**
 * `RequestInit` plus each runtime's transport-timer control, which the DOM lib
 * does not declare. Bun reads `timeout` (`false` disarms its idle timer) and
 * ignores `dispatcher`; Node's undici fetch reads `dispatcher` and ignores
 * `timeout`.
 */
export interface DeadlineRequestInit extends RequestInit {
  timeout?: number | boolean
  dispatcher?: Dispatcher
}

let callerOwnedDeadlineDispatcher: Dispatcher | undefined

/**
 * The shared dispatcher whose header/body timers are disarmed, for runtimes
 * whose fetch is undici. Constructed lazily so Bun — where `dispatcher` is
 * ignored and `timeout: false` does the disarming — never pays for it, and
 * shared so repeated internal-route calls reuse its keep-alive connections.
 */
function getCallerOwnedDeadlineDispatcher(): Dispatcher | undefined {
  if (typeof process !== 'undefined' && process.versions?.bun) {
    return undefined
  }
  callerOwnedDeadlineDispatcher ??= new Agent({ headersTimeout: 0, bodyTimeout: 0 })
  return callerOwnedDeadlineDispatcher
}

/**
 * Disarms the transport timers so the caller's own deadline is the only one
 * in force.
 *
 * Only use this where the caller genuinely enforces a deadline in-process —
 * an `AbortSignal` wired to a timer or an execution budget. Without one, a
 * request to a peer that never answers would hang until the socket dies.
 */
export function withCallerOwnedDeadline(init: RequestInit): DeadlineRequestInit {
  const dispatcher = getCallerOwnedDeadlineDispatcher()
  return { ...init, timeout: false, ...(dispatcher ? { dispatcher } : {}) }
}

/**
 * Whether a caught error is the transport giving up rather than the request
 * being cancelled or the peer erroring.
 *
 * Bun reports both an unanswered request and a truncated body as
 * `TimeoutError: The operation timed out.`, and surfaces a severed connection
 * as a bare `fetch failed`. Node's undici reports its expired header/body
 * timers and severed connections alike as `TypeError: fetch failed`, with the
 * distinguishing `HeadersTimeoutError`/`BodyTimeoutError` only on `cause` —
 * none of which name the hop, the elapsed time, or the fact that a cap was
 * hit. Callers use this to annotate before rethrowing so a transport cap
 * cannot masquerade as a failure of the work itself.
 */
export function isTransportTimeoutError(error: unknown): error is Error {
  if (!(error instanceof Error)) return false
  if (error.name === 'TimeoutError') return true
  return error.name === 'TypeError' && error.message === 'fetch failed'
}
