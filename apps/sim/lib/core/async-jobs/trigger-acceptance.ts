import { createLogger } from '@sim/logger'

const logger = createLogger('TriggerAcceptance')

/**
 * Trigger.dev normally accepts a run in well under a second. A wait past this means its intake is
 * stalling, and every enqueue in the process is waiting on it.
 */
const SLOW_TRIGGER_ACCEPTANCE_MS = 10_000

/**
 * Awaits a Trigger.dev run submission and warns when acceptance was slow, whether it then
 * succeeded or failed. It never bounds the wait: a deadline would turn a late acceptance into one
 * whose outcome is unknown.
 */
export async function measureTriggerAcceptance<T>(
  taskId: string,
  submit: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now()
  let outcome: 'accepted' | 'failed' = 'failed'
  try {
    const result = await submit()
    outcome = 'accepted'
    return result
  } finally {
    const durationMs = Math.round(performance.now() - startedAt)
    if (durationMs >= SLOW_TRIGGER_ACCEPTANCE_MS) {
      logger.warn('Slow Trigger.dev run acceptance', { taskId, durationMs, outcome })
    }
  }
}
