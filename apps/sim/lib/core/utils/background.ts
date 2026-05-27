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

interface SingleFlightOptions {
  /**
   * How long a run may hold the slot before it is treated as stale. A later
   * `run` call past this window takes over and starts a fresh run, so a hung
   * task (one whose promise never settles) cannot wedge the slot permanently.
   * This is the in-process equivalent of a distributed lock's TTL.
   */
  staleAfterMs: number
}

/**
 * A per-process single-flight guard. Prevents a long-running detached task from
 * piling up when it is invoked again before the previous run finishes.
 *
 * This guards a single Node process only — cross-replica deduplication must be
 * handled by the underlying work (e.g. database row claiming or a distributed
 * lock).
 *
 * A held slot is released when its run settles, or — if the run hangs and never
 * settles — taken over by the next `run` call after `staleAfterMs`. Ownership is
 * tracked by token so a stale run that settles late cannot clear a newer run's
 * slot.
 */
export function createSingleFlight({ staleAfterMs }: SingleFlightOptions) {
  let activeToken: symbol | null = null
  let activeSince = 0

  return {
    /** Whether a run currently holds the slot in this process. */
    isActive: (): boolean => activeToken !== null,

    /**
     * Starts `work` detached unless a non-stale run already holds the slot.
     *
     * @returns `true` if a new run started, `false` if a run was already in flight.
     */
    run(label: string, work: () => Promise<unknown>): boolean {
      const now = Date.now()
      if (activeToken !== null) {
        if (now - activeSince < staleAfterMs) return false
        logger.warn(
          `Single-flight "${label}" held for ${now - activeSince}ms (> ${staleAfterMs}ms); starting a new run`
        )
      }

      const token = Symbol(label)
      activeToken = token
      activeSince = now
      runDetached(label, () =>
        Promise.resolve()
          .then(work)
          .finally(() => {
            if (activeToken === token) {
              activeToken = null
            }
          })
      )
      return true
    },
  }
}
