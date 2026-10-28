import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import {
  checkAttributedUsageLimits,
  resolveBillingAttribution,
} from '@/lib/billing/core/attribution'
import { isHosted } from '@/lib/core/config/env-flags'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { buildJobBrief } from '@/lib/mothership/jobs/brief'
import { jobRunBudgetUsd } from '@/lib/mothership/jobs/budget'
import { failUnstartedJobRun } from '@/lib/mothership/jobs/finalize'
import {
  countJobDispatchFailure,
  disableJob,
  endUnstartedJobRun,
  type JobRun,
  loadJobRun,
  markJobRunRunning,
  recordJobRunBillingRequest,
} from '@/lib/mothership/jobs/runs'
import { startUnattendedTurn } from '@/lib/mothership/request/lifecycle/unattended'
import type { TurnSecretAuthority } from '@/lib/mothership/secret-mount-policy'
import { notifyScheduleAutoDisabled } from '@/lib/workflows/schedules/disable-notifications'

const logger = createLogger('MothershipJobDispatch')

/** A queued occurrence whose start failed this many times ends as failed instead of retrying. */
const MAX_JOB_DISPATCH_ATTEMPTS = 5
/** Outlasts one dispatch (its reads and the turn's admission), so an attempt never overlaps another. */
const JOB_DISPATCH_LOCK_SECONDS = 120

type JobDispatchOutcome =
  | 'started'
  | 'already_started'
  | 'skipped_busy'
  | 'skipped_budget'
  | 'blocked'
  | 'retry'
  | 'failed'
  | 'not_queued'

/**
 * An unattended run mounts only the secrets a person named for the job: a job whose policy
 * says `all` (the column's default for workflow schedules) mounts none.
 */
function jobSecretAuthority(run: JobRun, userId: string): TurnSecretAuthority {
  return {
    secretMountPolicy: {
      secretScope: 'selected',
      mountedSecrets: run.secretScope === 'selected' ? run.mountedSecrets : [],
    },
    secretActorUserId: userId,
  }
}

async function block(run: JobRun, summary: string): Promise<JobDispatchOutcome> {
  await endUnstartedJobRun(run.executionId, 'blocked', summary)
  if (await disableJob(run.scheduleId)) {
    await notifyScheduleAutoDisabled({ scheduleId: run.scheduleId, reason: 'authorization_error' })
  }
  return 'blocked'
}

/**
 * Starts a queued occurrence as a durable turn in its job's chat, at most once: the occurrence id
 * is the turn's id, so a retry after a crash (or a second tick) finds the turn it already
 * admitted instead of starting another. The owner's access is re-checked at admission; losing it
 * turns the job off. An occurrence whose chat is busy, or whose payer is over its plan limit, is
 * skipped rather than queued behind it.
 */
export async function dispatchJobOccurrence(executionId: string): Promise<JobDispatchOutcome> {
  /**
   * One attempt at a time per occurrence (a tick's and the reconciler's can meet): a skip or
   * block decided while another attempt admits the turn would close the record of a live run.
   */
  const lock = `mothership:job-dispatch:${executionId}`
  const holder = generateShortId()
  if (!(await acquireLock(lock, holder, JOB_DISPATCH_LOCK_SECONDS, { reclaimOnFailure: true })))
    return 'already_started'
  try {
    return await dispatchQueuedOccurrence(executionId)
  } finally {
    await releaseLock(lock, holder).catch((error) =>
      logger.warn('Job dispatch lock release failed; it expires', {
        executionId,
        error: toError(error).message,
      })
    )
  }
}

async function dispatchQueuedOccurrence(executionId: string): Promise<JobDispatchOutcome> {
  const run = await loadJobRun(executionId)
  if (!run || run.status !== 'queued' || !run.occurrenceAt) return 'not_queued'
  const { userId, workspaceId, chatId } = run
  if (!userId || !workspaceId || !chatId) return block(run, 'The job has no owner or chat.')
  if (run.archivedAt || run.scheduleStatus === 'disabled') {
    await endUnstartedJobRun(executionId, 'blocked', 'The job was turned off before this run.')
    return 'blocked'
  }

  try {
    const billingAttribution = await resolveBillingAttribution({ actorUserId: userId, workspaceId })
    if (isHosted) {
      const usage = await checkAttributedUsageLimits(billingAttribution)
      if (usage.isExceeded) {
        // An outage, not a verdict.
        if (usage.reason === 'usage_unavailable') return retryDispatch(run, usage.message)
        await endUnstartedJobRun(
          executionId,
          'skipped_budget',
          usage.message ?? 'The usage limit was reached.'
        )
        return 'skipped_budget'
      }
    }
    /** The run's spend cap is enforced through hosted billing callbacks, so only there is it stated. */
    const runBudgetUsd = isHosted ? jobRunBudgetUsd(run.runBudgetUsd) : null
    const message = await buildJobBrief(run, run.occurrenceAt, runBudgetUsd)
    const start = await startUnattendedTurn({
      userId,
      workspaceId,
      chatId,
      messageId: executionId,
      message,
      origin: 'job',
      billingAttribution,
      secretAuthority: jobSecretAuthority(run, userId),
      onBillingAdmission: (admission) =>
        recordJobRunBillingRequest(executionId, admission.billingRequestId),
    })
    if (start === 'busy') {
      await endUnstartedJobRun(executionId, 'skipped_busy', 'Another turn was running in the chat.')
      return 'skipped_busy'
    }
    /** Another attempt admitted (or is admitting) this turn; the reconciler marks it once its run exists. */
    if (start === 'duplicate') return 'already_started'
    await markJobRunRunning(executionId)
    return 'started'
  } catch (error) {
    const code = asOrchestrationError(error)?.code
    if (code === 'forbidden' || code === 'not_found') {
      return block(run, 'The job owner can no longer run it in this workspace.')
    }
    return retryDispatch(run, getErrorMessage(error))
  }
}

/** Counts a failed attempt; the reconciler retries it, and the last allowed one ends the run as failed. */
async function retryDispatch(run: JobRun, reason?: string): Promise<JobDispatchOutcome> {
  const failures = await countJobDispatchFailure(run.executionId)
  logger.warn('Job occurrence could not start; the reconciler retries it', {
    executionId: run.executionId,
    failures,
    error: reason,
  })
  if (failures < MAX_JOB_DISPATCH_ATTEMPTS) return 'retry'
  await failUnstartedJobRun(run.executionId, run.scheduleId, 'The run could not be started.')
  return 'failed'
}
