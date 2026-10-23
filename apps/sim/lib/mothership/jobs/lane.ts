import { db, jobExecutionLogs, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { exists, sql } from 'drizzle-orm'
import { env } from '@/lib/core/config/env'
import { claimDueJobOccurrences, dueJob } from '@/lib/mothership/jobs/claim'
import { dispatchJobOccurrence } from '@/lib/mothership/jobs/dispatch'
import { openJobRun, reconcileJobRuns } from '@/lib/mothership/jobs/reconcile'

const logger = createLogger('MothershipJobLane')

/** Occurrences one tick claims; the rest wait for the next tick. */
const JOB_CLAIM_LIMIT = 50

/**
 * One row: `due`, whether a job's occurrence is due to be claimed, and `open`, whether an
 * occurrence is still queued or running. Each leg probes its own partial index, so a deployment
 * with no live jobs pays one index lookup per tick and nothing else.
 */
export function jobLaneWorkQuery(now: Date) {
  const due = db.select({ id: workflowSchedule.id }).from(workflowSchedule).where(dueJob(now))
  const open = db
    .select({ id: jobExecutionLogs.id })
    .from(jobExecutionLogs)
    .where(openJobRun(['queued', 'running']))
  return sql`SELECT ${exists(due.limit(1))} AS due, ${exists(open.limit(1))} AS open`
}

/**
 * The schedule tick's job lane: drives every open occurrence (including ones a crashed tick
 * left) towards its end, then claims due occurrences and starts each as a durable turn. Settling
 * first means a run that met its condition, or a third failure that turned its job off, stops
 * the job before its next occurrence is claimed.
 *
 * Jobs run only where their turns are durable: the worker is configured, and Redis holds the
 * chat locks that let Sim take a turn over after its process dies. Elsewhere the lane does
 * nothing, not even a query.
 */
export async function runJobLane(now: Date = new Date()): Promise<{ claimed: number }> {
  if (!env.COPILOT_API_KEY || !env.REDIS_URL) return { claimed: 0 }
  const [work] = await db.execute<{ due: boolean; open: boolean }>(jobLaneWorkQuery(now))
  if (work?.open) await reconcileJobRuns(now)
  const claimed = work?.due ? await claimDueJobOccurrences(now, JOB_CLAIM_LIMIT) : []
  for (const occurrence of claimed) {
    await dispatchJobOccurrence(occurrence.executionId).catch((error) =>
      logger.warn('Job occurrence dispatch failed; the reconciler retries it', {
        executionId: occurrence.executionId,
        error: getErrorMessage(error),
      })
    )
  }
  return { claimed: claimed.length }
}
