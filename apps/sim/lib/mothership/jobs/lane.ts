import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { isMothershipJobsEnabled } from '@/lib/core/config/env-flags'
import { claimDueJobOccurrences } from '@/lib/mothership/jobs/claim'
import { dispatchJobOccurrence } from '@/lib/mothership/jobs/dispatch'
import { reconcileJobRuns } from '@/lib/mothership/jobs/reconcile'

const logger = createLogger('MothershipJobLane')

/** Occurrences one tick claims; the rest wait for the next tick. */
const JOB_CLAIM_LIMIT = 50

/**
 * Jobs run only where their turns are durable: the flag is on, the worker is configured, and
 * Redis holds the chat locks that let Sim take a turn over after its process dies.
 */
export function isJobLaneEnabled(): boolean {
  return isMothershipJobsEnabled && Boolean(env.COPILOT_API_KEY) && Boolean(env.REDIS_URL)
}

/**
 * The schedule tick's job lane: claims due occurrences, starts each as a durable turn, then
 * drives every open occurrence (including ones a crashed tick left) towards its end.
 */
export async function runJobLane(now: Date = new Date()): Promise<{ claimed: number }> {
  const claimed = await claimDueJobOccurrences(now, JOB_CLAIM_LIMIT)
  for (const occurrence of claimed) {
    await dispatchJobOccurrence(occurrence.executionId).catch((error) =>
      logger.warn('Job occurrence dispatch failed; the reconciler retries it', {
        executionId: occurrence.executionId,
        error: getErrorMessage(error),
      })
    )
  }
  await reconcileJobRuns(now)
  return { claimed: claimed.length }
}
