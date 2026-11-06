import { copilotRuns, db, jobExecutionLogs } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { requestRunStop, TERMINAL_RUN_STATUSES } from '@/lib/mothership/async-runs/repository'
import { JOB_RUN_TRIGGER } from '@/lib/mothership/jobs/claim'
import { dispatchJobOccurrence } from '@/lib/mothership/jobs/dispatch'
import { finalizeJobRun } from '@/lib/mothership/jobs/finalize'
import {
  endUnstartedJobRun,
  markJobRunRunning,
  recordJobRunBillingRequest,
} from '@/lib/mothership/jobs/runs'
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

/** The billing request a run's first leg was admitted under, as its recovery intent recorded it. */
const admittedBillingRequestId = sql<
  string | null
>`${copilotRuns.requestContext}->'recovery'->'billingAdmission'->>'billingRequestId'`

/**
 * Open records that need this pass, oldest first. Every queued record does; a running one only
 * once its turn ended or its run row is gone, its time limit passed without a Stop, its Stop's
 * delivery never finished, or its spend-cap link is missing, so a backlog of healthy long runs never hides the ones that finished.
 */
function openJobRuns(status: OpenJobRunStatus, now: Date) {
  const needsAction =
    status === 'queued'
      ? undefined
      : or(
          inArray(copilotRuns.status, TERMINAL_RUN_STATUSES),
          isNull(copilotRuns.id),
          and(
            lte(jobExecutionLogs.startedAt, new Date(now.getTime() - JOB_RUN_TIME_LIMIT_MS)),
            sql`${jobExecutionLogs.executionData}->>'deadlineStopRequestedAt' IS NULL`
          ),
          sql`${jobExecutionLogs.executionData}->>'deadlineStopRequestedAt' IS NOT NULL AND ${jobExecutionLogs.executionData}->>'deadlineStopDeliveredAt' IS NULL`,
          and(isNull(jobExecutionLogs.billingRequestId), isNotNull(admittedBillingRequestId))
        )
  return db
    .select({
      executionId: jobExecutionLogs.executionId,
      status: jobExecutionLogs.status,
      startedAt: jobExecutionLogs.startedAt,
      deadlineStopRequestedAt: sql<
        string | null
      >`${jobExecutionLogs.executionData}->>'deadlineStopRequestedAt'`,
      deadlineStopDeliveredAt: sql<
        string | null
      >`${jobExecutionLogs.executionData}->>'deadlineStopDeliveredAt'`,
      billingRequestId: jobExecutionLogs.billingRequestId,
      admittedBillingRequestId,
      scheduleId: jobExecutionLogs.scheduleId,
      runStatus: copilotRuns.status,
      userId: copilotRuns.userId,
      workspaceId: copilotRuns.workspaceId,
      chatId: copilotRuns.chatId,
    })
    .from(jobExecutionLogs)
    .leftJoin(copilotRuns, eq(copilotRuns.streamId, jobExecutionLogs.executionId))
    .where(and(openJobRun([status]), needsAction))
    .orderBy(asc(jobExecutionLogs.startedAt))
    .limit(RECONCILE_BATCH_SIZE)
}

/**
 * Drives every open occurrence to an end, so no crash leaves one queued or running forever:
 * a queued record whose dispatch was lost is dispatched again under the same id (the turn is
 * admitted at most once, so a retry of one that did start only finds it); a record whose turn
 * ended is finalized; one past the time limit is stopped and finalized once it settles, its
 * Stop delivered again first if an earlier pass died delivering it; one whose job was deleted
 * before it started is ended. A run whose spend-cap link was lost (its
 * process died between recording the billing admission and the link) gets it back.
 */
export async function reconcileJobRuns(now: Date): Promise<void> {
  /** Each status reads its own batch, so a backlog of long runs never starves queued ones. */
  const [queued, running] = await Promise.all([
    openJobRuns('queued', now),
    openJobRuns('running', now),
  ])
  for (const row of [...queued, ...running]) {
    try {
      if (!row.runStatus) {
        if (row.status === 'running') {
          await finalizeJobRun(row.executionId)
          continue
        }
        if (!row.scheduleId) {
          await endUnstartedJobRun(
            row.executionId,
            'blocked',
            'The job was deleted before this run.'
          )
        } else if (now.getTime() - row.startedAt.getTime() >= JOB_DISPATCH_GRACE_MS) {
          await dispatchJobOccurrence(row.executionId)
        }
        continue
      }
      if (row.status === 'queued') await markJobRunRunning(row.executionId)
      if (!row.billingRequestId && row.admittedBillingRequestId) {
        await recordJobRunBillingRequest(row.executionId, row.admittedBillingRequestId)
      }
      const ended = TERMINAL_RUN_STATUSES.includes(row.runStatus)
      /** A Stop whose delivery never finished is delivered before the run is finalized. */
      const undelivered =
        row.deadlineStopRequestedAt !== null && row.deadlineStopDeliveredAt === null
      const overdue =
        !ended &&
        !row.deadlineStopRequestedAt &&
        now.getTime() - row.startedAt.getTime() >= JOB_RUN_TIME_LIMIT_MS
      if ((undelivered || overdue) && row.userId && row.workspaceId && row.chatId) {
        await stopAtTimeLimit({
          executionId: row.executionId,
          userId: row.userId,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
        })
      }
      if (ended) await finalizeJobRun(row.executionId)
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
  const stopped = await requestRunStop({
    streamId: run.executionId,
    userId: run.userId,
    workspaceId: run.workspaceId,
    chatId: run.chatId,
  })
  /** A run outside the job's scope records no Stop, so nothing is delivered to it. */
  if (!stopped || stopped.workspaceId !== run.workspaceId || stopped.chatId !== run.chatId) return
  /**
   * Why the run stopped is recorded before delivery, so its summary survives a crash; delivery
   * is marked separately once done, and a pass that finds it unmarked delivers again (requesting
   * and delivering a Stop are idempotent), so the run's client workflows and sandbox work end.
   */
  await markDeadlineStop(run.executionId, 'deadlineStopRequestedAt')
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
  await markDeadlineStop(run.executionId, 'deadlineStopDeliveredAt')
  logger.info('Stopped a job run at its time limit', { executionId: run.executionId })
}

/** Records a step of the time-limit Stop once; a repeated pass keeps the first time. */
async function markDeadlineStop(
  executionId: string,
  step: 'deadlineStopRequestedAt' | 'deadlineStopDeliveredAt'
): Promise<void> {
  await db
    .update(jobExecutionLogs)
    .set({
      executionData: sql`jsonb_set(${jobExecutionLogs.executionData}, ${`{${step}}`}::text[], COALESCE(${jobExecutionLogs.executionData}->${step}, to_jsonb(now())))`,
    })
    .where(eq(jobExecutionLogs.executionId, executionId))
}
