import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'

const logger = createLogger('BackgroundTask')

/**
 * Runs work detached from the HTTP response so a caller (e.g. a cron job with a
 * short request timeout) receives an immediate response while processing
 * continues on the long-lived server process.
 *
 * `withRouteHandler` only wraps awaited work in its try/catch, so a detached
 * promise must catch its own rejection or it surfaces as an `unhandledRejection`.
 * The request-scoped AsyncLocalStorage context (request ID) is captured when the
 * work is scheduled and preserved across the detached continuation, so loggers
 * inside `work` keep the originating request ID.
 *
 * @param label - Identifier used in the failure log line.
 * @param work - The async work to run in the background.
 */
export function runDetached(label: string, work: () => Promise<unknown>): void {
  void Promise.resolve()
    .then(work)
    .catch((error) => {
      logger.error(`Background task failed: ${label}`, toError(error))
    })
}

interface DetachedTouchOptions {
  /** Identifier used in the failure log line. */
  label: string
  /** The write itself, usually a guarded single-row timestamp update. */
  write: (key: string) => Promise<unknown>
  /**
   * Skip a key written by this process within `intervalMs`, remembering at most `maxKeys`. Only
   * for a value nothing reads as fresh: the process-local window adds to whatever staleness the
   * write's own guard allows.
   */
  debounce?: { intervalMs: number; maxKeys: number }
}

/**
 * A best-effort per-key write (a last-used or last-seen timestamp) that the caller never waits
 * on, and that never starts while the same key's previous write is still pending: a commit
 * stalled on the database would otherwise hold every caller that touches the row, and each repeat
 * would queue behind its row lock holding a pool connection. In-flight keys are tracked apart
 * from the optional debounce cache, so neither expiry nor eviction can start an overlapping write.
 */
export function createDetachedTouch({
  label,
  write,
  debounce,
}: DetachedTouchOptions): (key: string) => void {
  const recent = debounce
    ? new LRUCache<string, true>({ max: debounce.maxKeys, ttl: debounce.intervalMs })
    : null
  const inFlight = new Set<string>()
  return (key) => {
    if (inFlight.has(key) || recent?.has(key)) return
    recent?.set(key, true)
    inFlight.add(key)
    runDetached(label, () => write(key).finally(() => inFlight.delete(key)))
  }
}
