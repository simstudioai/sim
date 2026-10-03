import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { isInsideTriggerRun } from '@/lib/core/config/trigger-runtime'

const logger = createLogger('TriggerAvailability')

let triggerAvailabilityLogged = false

/**
 * Whether background work may be dispatched to Trigger.dev rather than run
 * in-process.
 *
 * Inside a Trigger.dev run the answer is unconditionally yes: the platform is
 * what is executing this process, so no environment guess can be more reliable
 * than the run marker. Outside a run the deployment must both enable
 * Trigger.dev and hold the secret key the SDK authenticates with.
 *
 * Resolving `true` inside a run is safe even if the run process turns out not
 * to expose `TRIGGER_SECRET_KEY`: the SDK would then reject the trigger and a
 * caller that falls back to in-process work lands exactly where a `false`
 * predicate lands anyway.
 *
 * The first evaluation in a process logs the resolved inputs. That is once per
 * worker process rather than once per dispatch, and it is the signal that makes
 * an app-vs-worker asymmetry visible without reading a crashed run's spans.
 */
export function isTriggerAvailable(): boolean {
  const insideRun = isInsideTriggerRun()
  const hasSecretKey = Boolean(env.TRIGGER_SECRET_KEY)
  const available = insideRun || (hasSecretKey && isTriggerDevEnabled)

  if (!triggerAvailabilityLogged) {
    triggerAvailabilityLogged = true
    logger.info('Resolved Trigger.dev dispatch availability', {
      available,
      insideTriggerRun: insideRun,
      triggerDevEnabled: isTriggerDevEnabled,
      hasSecretKey,
    })
  }

  return available
}
