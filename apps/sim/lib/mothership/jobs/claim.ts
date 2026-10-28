import { db, jobExecutionLogs, workflowSchedule } from '@sim/db'
import { and, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { jobOccurrenceId, nextJobOccurrence } from '@/lib/mothership/jobs/occurrence'

/** The trigger every job run record carries; the logs surface lists runs under it. */
export const JOB_RUN_TRIGGER = 'mothership'

/** A live job whose next occurrence is due; `workflow_schedule_due_job_idx` covers it. */
export const dueJob = (now: Date) =>
  and(
    eq(workflowSchedule.sourceType, 'job'),
    isNull(workflowSchedule.archivedAt),
    sql`${workflowSchedule.status} NOT IN ('disabled', 'completed')`,
    isNotNull(workflowSchedule.nextRunAt),
    lte(workflowSchedule.nextRunAt, now),
    isNotNull(workflowSchedule.sourceUserId),
    isNotNull(workflowSchedule.sourceWorkspaceId),
    isNotNull(workflowSchedule.sourceChatId)
  )

interface ClaimedOccurrence {
  executionId: string
  scheduleId: string
  occurrenceAt: Date
}

/**
 * Claims each due job's occurrence in one transaction: its run record is written (status
 * `queued`) and the schedule advances past it, together. The claim never waits for the run,
 * so a process that dies after committing leaves a queued record for the reconciler, never a
 * schedule stuck on a stale claim. Two ticks racing for a row skip each other's locks, and a
 * record that already exists for the occurrence is kept, so each occurrence is recorded once.
 *
 * A schedule whose `max_runs` is spent completes without a run; one that will not run again (a
 * one-shot job, a recurrence past its end) completes once this occurrence is claimed.
 */
export async function claimDueJobOccurrences(
  now: Date,
  limit: number
): Promise<ClaimedOccurrence[]> {
  if (limit <= 0) return []
  return db.transaction(async (tx) => {
    const due = await tx
      .select({
        id: workflowSchedule.id,
        nextRunAt: workflowSchedule.nextRunAt,
        cronExpression: workflowSchedule.cronExpression,
        timezone: workflowSchedule.timezone,
        excludedDates: workflowSchedule.excludedDates,
        endsAt: workflowSchedule.endsAt,
        maxRuns: workflowSchedule.maxRuns,
        runCount: workflowSchedule.runCount,
        sourceWorkspaceId: workflowSchedule.sourceWorkspaceId,
      })
      .from(workflowSchedule)
      .where(dueJob(now))
      .orderBy(workflowSchedule.nextRunAt)
      .limit(limit)
      .for('update', { skipLocked: true })

    const claimed: ClaimedOccurrence[] = []
    const exhausted: string[] = []
    for (const schedule of due) {
      const occurrenceAt = schedule.nextRunAt
      if (!occurrenceAt || !schedule.sourceWorkspaceId) continue
      if (schedule.maxRuns !== null && schedule.runCount >= schedule.maxRuns) {
        exhausted.push(schedule.id)
        continue
      }
      const executionId = jobOccurrenceId(schedule.id, occurrenceAt)
      const nextRunAt = nextJobOccurrence(schedule, occurrenceAt, now)
      const runCount = schedule.runCount + 1
      const finished =
        nextRunAt === null || (schedule.maxRuns !== null && runCount >= schedule.maxRuns)
      await tx
        .insert(jobExecutionLogs)
        .values({
          id: executionId,
          executionId,
          scheduleId: schedule.id,
          workspaceId: schedule.sourceWorkspaceId,
          occurrenceAt,
          level: 'info',
          status: 'queued',
          trigger: JOB_RUN_TRIGGER,
          startedAt: now,
          /** Fixed at claim: the schedule's count moves on as later occurrences are claimed. */
          executionData: { runNumber: runCount },
        })
        .onConflictDoNothing()
      await tx
        .update(workflowSchedule)
        .set({
          nextRunAt: finished ? null : nextRunAt,
          lastQueuedAt: now,
          runCount,
          ...(finished ? { status: 'completed' } : {}),
          updatedAt: now,
        })
        .where(eq(workflowSchedule.id, schedule.id))
      claimed.push({ executionId, scheduleId: schedule.id, occurrenceAt })
    }
    if (exhausted.length > 0) {
      await tx
        .update(workflowSchedule)
        .set({ status: 'completed', nextRunAt: null, updatedAt: now })
        .where(inArray(workflowSchedule.id, exhausted))
    }
    return claimed
  })
}
