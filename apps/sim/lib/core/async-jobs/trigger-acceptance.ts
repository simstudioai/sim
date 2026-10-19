import { createLogger } from '@sim/logger'

/** An operational signal, so it is emitted even where the production default level is ERROR. */
const logger = createLogger('TriggerAcceptance', { logLevel: 'WARN' })

/**
 * Trigger.dev normally accepts a run in well under a second. A wait past this means its intake is
 * stalling, and every enqueue in the process is waiting on it.
 */
const SLOW_TRIGGER_ACCEPTANCE_MS = 10_000

/**
 * Awaits a Trigger.dev run submission and warns when acceptance is slow: once while it is still
 * pending, so a stall shows up as it happens, and again when it settles, with its duration and
 * outcome. It never bounds the wait: a deadline would turn a late acceptance into one whose
 * outcome is unknown.
 */
export async function measureTriggerAcceptance<T>(
  taskId: string,
  submit: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now()
  const pendingWarning = setTimeout(() => {
    logger.warn('Trigger.dev run acceptance still pending', {
      taskId,
      waitedMs: SLOW_TRIGGER_ACCEPTANCE_MS,
    })
  }, SLOW_TRIGGER_ACCEPTANCE_MS)
  let outcome: 'accepted' | 'failed' = 'failed'
  try {
    const result = await submit()
    outcome = 'accepted'
    return result
  } finally {
    clearTimeout(pendingWarning)
    const durationMs = Math.round(performance.now() - startedAt)
    if (durationMs >= SLOW_TRIGGER_ACCEPTANCE_MS) {
      logger.warn('Slow Trigger.dev run acceptance', { taskId, durationMs, outcome })
    }
  }
}
