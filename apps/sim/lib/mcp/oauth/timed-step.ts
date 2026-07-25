import type { Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'

/** Thrown when a `timedStep`-bounded operation doesn't settle within its budget. */
export class OauthStepTimeoutError extends Error {
  constructor(step: string, ms: number) {
    super(`MCP OAuth step "${step}" did not settle within ${ms}ms`)
    this.name = 'OauthStepTimeoutError'
  }
}

/**
 * Times and bounds one awaited step of an OAuth route so a stalled operation surfaces
 * as a labeled, logged error instead of hanging the request (and the browser popup
 * waiting on it) forever. The losing promise is not cancelled — a wedged DB/socket op
 * can't be — so it settles in the background with its rejection swallowed; the point is
 * that the request stops waiting on it and the logs name the exact step that stalled.
 */
export function makeTimedStep(logger: Logger) {
  return async function timedStep<T>(step: string, ms: number, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    logger.info(`OAuth step start: ${step}`)
    const work = Promise.resolve(fn())
    work.catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const value = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OauthStepTimeoutError(step, ms)), ms)
          timer.unref?.()
        }),
      ])
      logger.info(`OAuth step done: ${step} (${Date.now() - start}ms)`)
      return value
    } catch (error) {
      logger.error(`OAuth step failed: ${step} (${Date.now() - start}ms)`, {
        error: toError(error).message,
      })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
