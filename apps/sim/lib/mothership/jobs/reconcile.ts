import { copilotRuns, db, jobExecutionLogs, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { requestRunStop } from '@/lib/mothership/async-runs/repository'
import { JOB_RUN_TRIGGER } from '@/lib/mothership/jobs/claim'
import { dispatchJobOccurrence } from '@/lib/mothership/jobs/dispatch'
import { finalizeJobRun } from '@/lib/mothership/jobs/finalize'
import { markJobRunRunning } from '@/lib/mothership/jobs/runs'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'

const logger = createLogger('MothershipJobReconciler')

/** A queued occurrence older than this lost its dispatch (a crash after the claim committed). */
export const JOB_DISPATCH_GRACE_MS = 2 * 60_000

/**
 * A job run's wall-clock limit. Turns have no default cutoff; this one is the job's own deadline,
 * an explicit caller limit, after which the run is stopped like a person pressing Stop.
 */
const JOB_RUN_TIME_LIMIT_MS = 6 * 60 * 60_000

const RECONCILE_BATCH_SIZE = 100

function openJobRuns(status: 'queued' | 'running') {
  return db
    .select({
      executionId: jobExecutionLogs.executionId,
      status: jobExecutionLogs.status,
      startedAt: jobExecutionLogs.startedAt,
      deadlineStopRequestedAt: sql<
        string | null
      >`${jobExecutionLogs.executionData}->>'deadlineStopRequestedAt'`,
      runStatus: copilotRuns.status,
      userId: workflowSchedule.sourceUserId,
      workspaceId: workflowSchedule.sourceWorkspaceId,
      chatId: copilotRuns.chatId,
    })
    .from(jobExecutionLogs)
    .innerJoin(workflowSchedule, eq(workflowSchedule.id, jobExecutionLogs.scheduleId))
    .leftJoin(copilotRuns, eq(copilotRuns.streamId, jobExecutionLogs.executionId))
    .where(
      and(
        eq(jobExecutionLogs.status, status),
        eq(jobExecutionLogs.trigger, JOB_RUN_TRIGGER),
        isNotNull(jobExecutionLogs.occurrenceAt)
      )
    )
    .orderBy(asc(jobExecutionLogs.startedAt))
    .limit(RECONCILE_BATCH_SIZE)
}

/**
 * Drives every open occurrence to an end, so no crash leaves one queued or running forever:
 * a queued record whose dispatch was lost is dispatched again under the same id (the turn is
 * admitted at most once, so a retry of one that did start only finds it); a running record whose
 * turn ended is finalized; one past the time limit is stopped and finalized once it settles.
 */
export async function reconcileJobRuns(now: Date): Promise<void> {
  /** Each status reads its own batch, so a backlog of long runs never starves queued ones. */
  const open = [...(await openJobRuns('queued')), ...(await openJobRuns('running'))]
  for (const row of open) {
    try {
      if (row.status === 'queued') {
        if (row.runStatus) await markJobRunRunning(row.executionId)
        else if (now.getTime() - row.startedAt.getTime() >= JOB_DISPATCH_GRACE_MS)
          await dispatchJobOccurrence(row.executionId)
        if (!row.runStatus) continue
      }
      if (await finalizeJobRun(row.executionId)) continue
      if (
        row.runStatus &&
        !row.deadlineStopRequestedAt &&
        row.userId &&
        row.workspaceId &&
        now.getTime() - row.startedAt.getTime() >= JOB_RUN_TIME_LIMIT_MS
      ) {
        await stopAtTimeLimit({
          executionId: row.executionId,
          userId: row.userId,
          workspaceId: row.workspaceId,
          chatId: row.chatId ?? undefined,
        })
      }
    } catch (error) {
      logger.warn('Job run could not be reconciled; the next pass retries', {
        executionId: row.executionId,
        error: getErrorMessage(error),
      })
    }
  }
}

async function stopAtTimeLimit(run: {
  executionId: string
  userId: string
  workspaceId: string
  chatId?: string
}): Promise<void> {
  await db
    .update(jobExecutionLogs)
    .set({
      executionData: sql`jsonb_set(${jobExecutionLogs.executionData}, '{deadlineStopRequestedAt}', to_jsonb(now()))`,
    })
    .where(eq(jobExecutionLogs.executionId, run.executionId))
  await requestRunStop({
    streamId: run.executionId,
    userId: run.userId,
    workspaceId: run.workspaceId,
    ...(run.chatId ? { chatId: run.chatId } : {}),
  })
  await requestExplicitStreamAbort({
    streamId: run.executionId,
    userId: run.userId,
    ...(run.chatId ? { chatId: run.chatId } : {}),
  })
  logger.info('Stopped a job run at its time limit', { executionId: run.executionId })
}
