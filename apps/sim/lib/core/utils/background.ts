import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'

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
