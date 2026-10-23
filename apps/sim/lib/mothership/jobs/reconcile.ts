import { copilotRuns, db, jobExecutionLogs, workflowSchedule } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { requestRunStop, TERMINAL_RUN_STATUSES } from '@/lib/mothership/async-runs/repository'
import { JOB_RUN_TRIGGER } from '@/lib/mothership/jobs/claim'
import { dispatchJobOccurrence } from '@/lib/mothership/jobs/dispatch'
import { finalizeJobRun } from '@/lib/mothership/jobs/finalize'
import { markJobRunRunning } from '@/lib/mothership/jobs/runs'
import {
  deliverRunStop,
  readStoppedRunWork,
} from '@/lib/mothership/request/application/stop-delivery'

const logger = createLogger('MothershipJobReconciler')

/** A queued occurrence older than this lost its dispatch (a crash after the claim committed). */
export const JOB_DISPATCH_GRACE_MS = 2 * 60_000

/**
 * A job run's wall-clock limit. Turns have no default cutoff; this one is the job's own deadline,
 * an explicit caller limit, after which the run is stopped like a person pressing Stop.
 */
const JOB_RUN_TIME_LIMIT_MS = 6 * 60 * 60_000

const RECONCILE_BATCH_SIZE = 100

type OpenJobRunStatus = 'queued' | 'running'

/** An occurrence's run record that has not ended; `job_execution_logs_open_idx` covers it. */
export const openJobRun = (statuses: OpenJobRunStatus[]) =>
  and(
    inArray(jobExecutionLogs.status, statuses),
    eq(jobExecutionLogs.trigger, JOB_RUN_TRIGGER),
    isNotNull(jobExecutionLogs.occurrenceAt)
  )

function openJobRuns(status: OpenJobRunStatus) {
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
    .where(openJobRun([status]))
    .orderBy(asc(jobExecutionLogs.startedAt))
    .limit(RECONCILE_BATCH_SIZE)
}

/**
 * Drives every open occurrence to an end, so no crash leaves one queued or running forever:
 * a queued record whose dispatch was lost is dispatched again under the same id (the turn is
 * admitted at most once, so a retry of one that did start only finds it); a record whose turn
 * ended is finalized; one past the time limit is stopped and finalized once it settles.
 */
export async function reconcileJobRuns(now: Date): Promise<void> {
  /** Each status reads its own batch, so a backlog of long runs never starves queued ones. */
  const [queued, running] = await Promise.all([openJobRuns('queued'), openJobRuns('running')])
  for (const row of [...queued, ...running]) {
    try {
      if (!row.runStatus) {
        if (
          row.status === 'queued' &&
          now.getTime() - row.startedAt.getTime() >= JOB_DISPATCH_GRACE_MS
        )
          await dispatchJobOccurrence(row.executionId)
        continue
      }
      if (row.status === 'queued') await markJobRunRunning(row.executionId)
      if (TERMINAL_RUN_STATUSES.includes(row.runStatus)) {
        await finalizeJobRun(row.executionId)
      } else if (
        !row.deadlineStopRequestedAt &&
        row.userId &&
        row.workspaceId &&
        row.chatId &&
        now.getTime() - row.startedAt.getTime() >= JOB_RUN_TIME_LIMIT_MS
      ) {
        await stopAtTimeLimit({
          executionId: row.executionId,
          userId: row.userId,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
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

/** Stops a run at its time limit through the same delivery a person's Stop takes. */
async function stopAtTimeLimit(run: {
  executionId: string
  userId: string
  workspaceId: string
  chatId: string
}): Promise<void> {
  await db
    .update(jobExecutionLogs)
    .set({
      executionData: sql`jsonb_set(${jobExecutionLogs.executionData}, '{deadlineStopRequestedAt}', to_jsonb(now()))`,
    })
    .where(eq(jobExecutionLogs.executionId, run.executionId))
  const stopped = await requestRunStop({
    streamId: run.executionId,
    userId: run.userId,
    workspaceId: run.workspaceId,
    chatId: run.chatId,
  })
  /** A run outside the job's scope records no Stop, so nothing is delivered to it. */
  if (!stopped || stopped.workspaceId !== run.workspaceId || stopped.chatId !== run.chatId) return
  await deliverRunStop(
    {
      id: stopped.id,
      streamId: run.executionId,
      userId: run.userId,
      chatId: run.chatId,
      desktopDeviceId: stopped.desktopDeviceId,
    },
    readStoppedRunWork(run.executionId, run.userId)
  )
  logger.info('Stopped a job run at its time limit', { executionId: run.executionId })
}
