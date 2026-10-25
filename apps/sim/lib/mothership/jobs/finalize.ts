import { copilotMessages, copilotRuns, db, jobExecutionLogs, workflowSchedule } from '@sim/db'
import { toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { TERMINAL_RUN_STATUSES } from '@/lib/mothership/async-runs/repository'
import {
  endedRunStatus,
  endUnstartedJobRun,
  type JobRunOutcome,
  MAX_CONSECUTIVE_JOB_FAILURES,
  REPORTED_JOB_OUTCOMES,
} from '@/lib/mothership/jobs/runs'
import { notifyScheduleAutoDisabled } from '@/lib/workflows/schedules/disable-notifications'

const SUMMARY_CHARS = 2_000

/**
 * Applies one finished run's outcome to its job: a run that reached a verdict (met or not)
 * clears the failure streak, a failed or interrupted one extends it, and the third in a row
 * turns the job off. A met `until_complete` job completes. Returns whether the job was turned
 * off, so the caller can tell its people.
 */
async function settleJobSchedule(
  tx: DbOrTx,
  scheduleId: string,
  outcome: JobRunOutcome
): Promise<boolean> {
  if (outcome === 'met' || outcome === 'not_met') {
    await tx
      .update(workflowSchedule)
      .set({
        failedCount: 0,
        ...(outcome === 'met'
          ? {
              status: sql`CASE WHEN ${workflowSchedule.lifecycle} = 'until_complete' AND ${workflowSchedule.status} = 'active' THEN 'completed' ELSE ${workflowSchedule.status} END`,
              nextRunAt: sql`CASE WHEN ${workflowSchedule.lifecycle} = 'until_complete' THEN NULL ELSE ${workflowSchedule.nextRunAt} END`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(workflowSchedule.id, scheduleId))
    return false
  }
  if (outcome !== 'failed' && outcome !== 'interrupted') return false
  const [schedule] = await tx
    .update(workflowSchedule)
    .set({
      failedCount: sql`${workflowSchedule.failedCount} + 1`,
      lastFailedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workflowSchedule.id, scheduleId))
    .returning({ failedCount: workflowSchedule.failedCount })
  if (!schedule || schedule.failedCount < MAX_CONSECUTIVE_JOB_FAILURES) return false
  /** Only a job still on is turned off here; one a person already turned off is not reported. */
  const disabled = await tx
    .update(workflowSchedule)
    .set({ status: 'disabled', updatedAt: new Date() })
    .where(and(eq(workflowSchedule.id, scheduleId), eq(workflowSchedule.status, 'active')))
    .returning({ id: workflowSchedule.id })
  return disabled.length > 0
}

/** The turn's last assistant text, as the summary of a run that reported no outcome. */
async function lastAssistantText(tx: DbOrTx, chatId: string, streamId: string): Promise<string> {
  const [message] = await tx
    .select({ content: copilotMessages.content })
    .from(copilotMessages)
    .where(
      and(
        eq(copilotMessages.chatId, chatId),
        eq(copilotMessages.streamId, streamId),
        eq(copilotMessages.role, 'assistant')
      )
    )
    .orderBy(desc(copilotMessages.seq))
    .limit(1)
  const content = message ? toRecord(message.content).content : undefined
  return typeof content === 'string' ? truncate(content, SUMMARY_CHARS) : ''
}

/**
 * Settles a running occurrence once its turn has ended. The record moves out of `running`
 * under a row lock, so the turn's own end and a reconciler pass settle it exactly once: one
 * outcome, one change to the job's failure streak. An outcome the agent reported is kept; a
 * turn that ended well without one is `not_met`, summarized by its last reply, and is not a
 * failure. A run whose row is gone (its chat was deleted) ends `interrupted`. Returns false while
 * the turn is still live.
 */
export async function finalizeJobRun(executionId: string): Promise<boolean> {
  let disabledScheduleId: string | null = null
  const settled = await db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        scheduleId: jobExecutionLogs.scheduleId,
        outcome: jobExecutionLogs.outcome,
        summary: jobExecutionLogs.summary,
        startedAt: jobExecutionLogs.startedAt,
        executionData: jobExecutionLogs.executionData,
      })
      .from(jobExecutionLogs)
      .where(
        and(eq(jobExecutionLogs.executionId, executionId), eq(jobExecutionLogs.status, 'running'))
      )
      .for('update')
    if (!record) return false
    const [run] = await tx
      .select({
        status: copilotRuns.status,
        error: copilotRuns.error,
        chatId: copilotRuns.chatId,
        completedAt: copilotRuns.completedAt,
      })
      .from(copilotRuns)
      .where(eq(copilotRuns.streamId, executionId))
      .limit(1)
    if (run && !TERMINAL_RUN_STATUSES.includes(run.status)) return false

    const reported = REPORTED_JOB_OUTCOMES.find((outcome) => outcome === record.outcome)
    const deadlineStopped = toRecord(record.executionData).deadlineStopRequestedAt !== undefined
    let outcome: JobRunOutcome
    let summary: string
    if (!run) {
      /** A started run's row is gone (its chat was deleted): nothing will ever end it otherwise. */
      outcome = 'interrupted'
      summary = 'The run was removed before it finished.'
    } else if (run.status === 'complete' && reported) {
      outcome = reported
      summary = record.summary ?? ''
    } else if (run.status === 'complete') {
      outcome = 'not_met'
      summary = await lastAssistantText(tx, run.chatId, executionId)
    } else if (run.status === 'cancelled') {
      outcome = 'interrupted'
      summary = deadlineStopped ? 'Stopped at the run time limit.' : 'The run was stopped.'
    } else {
      outcome = 'failed'
      summary = run.error ?? 'The run failed.'
    }
    const endedAt = run?.completedAt ?? new Date()
    await tx
      .update(jobExecutionLogs)
      .set({
        ...endedRunStatus(outcome),
        outcome,
        summary,
        endedAt,
        totalDurationMs: Math.max(0, endedAt.getTime() - record.startedAt.getTime()),
      })
      .where(eq(jobExecutionLogs.executionId, executionId))
    /** A record whose job was deleted mid-run still ends; there is no streak left to count. */
    if (record.scheduleId && (await settleJobSchedule(tx, record.scheduleId, outcome))) {
      disabledScheduleId = record.scheduleId
    }
    return true
  })
  if (disabledScheduleId) {
    await notifyScheduleAutoDisabled({
      scheduleId: disabledScheduleId,
      reason: 'consecutive_failures',
    })
  }
  return settled
}

/**
 * Ends an occurrence that could never be started as failed, counting it toward the job's failure
 * streak in the same transaction, so a crash cannot close the record without the count.
 */
export async function failUnstartedJobRun(
  executionId: string,
  scheduleId: string,
  summary: string
): Promise<void> {
  const disabled = await db.transaction(async (tx) => {
    if (!(await endUnstartedJobRun(executionId, 'failed', summary, tx))) return false
    return settleJobSchedule(tx, scheduleId, 'failed')
  })
  if (disabled) await notifyScheduleAutoDisabled({ scheduleId, reason: 'consecutive_failures' })
}
