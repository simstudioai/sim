import { db, jobExecutionLogs, workflowSchedule } from '@sim/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'

/** What a job run record says about how its occurrence ended. */
export type JobRunOutcome =
  | 'met'
  | 'not_met'
  | 'blocked'
  | 'failed'
  | 'skipped_busy'
  | 'skipped_budget'
  | 'interrupted'

/** Outcomes the agent reports itself; finalize keeps them rather than inferring one. */
export const REPORTED_JOB_OUTCOMES: readonly JobRunOutcome[] = ['met', 'not_met', 'blocked']

/** How an ended run reads in the logs: a failed run is an error, every other outcome is not. */
export function endedRunStatus(outcome: JobRunOutcome) {
  return outcome === 'failed'
    ? ({ status: 'error', level: 'error' } as const)
    : ({ status: 'complete', level: 'info' } as const)
}

/** A job is turned off after this many failed or interrupted runs in a row. */
export const MAX_CONSECUTIVE_JOB_FAILURES = 3

/** The occurrence's run record, with what dispatching it reads from its schedule. */
export async function loadJobRun(executionId: string) {
  const [row] = await db
    .select({
      executionId: jobExecutionLogs.executionId,
      status: jobExecutionLogs.status,
      occurrenceAt: jobExecutionLogs.occurrenceAt,
      scheduleId: workflowSchedule.id,
      scheduleStatus: workflowSchedule.status,
      archivedAt: workflowSchedule.archivedAt,
      jobTitle: workflowSchedule.jobTitle,
      prompt: workflowSchedule.prompt,
      successCondition: workflowSchedule.successCondition,
      lifecycle: workflowSchedule.lifecycle,
      maxRuns: workflowSchedule.maxRuns,
      /** Records claimed before the run number was stored fall back to the schedule's count. */
      runNumber: sql<number>`COALESCE((${jobExecutionLogs.executionData}->>'runNumber')::int, ${workflowSchedule.runCount})`,
      runBudgetUsd: workflowSchedule.runBudgetUsd,
      userId: workflowSchedule.sourceUserId,
      workspaceId: workflowSchedule.sourceWorkspaceId,
      chatId: workflowSchedule.sourceChatId,
      secretScope: workflowSchedule.secretScope,
      mountedSecrets: workflowSchedule.mountedSecrets,
    })
    .from(jobExecutionLogs)
    .innerJoin(workflowSchedule, eq(workflowSchedule.id, jobExecutionLogs.scheduleId))
    .where(
      and(eq(jobExecutionLogs.executionId, executionId), eq(workflowSchedule.sourceType, 'job'))
    )
    .limit(1)
  return row ?? null
}

export type JobRun = NonNullable<Awaited<ReturnType<typeof loadJobRun>>>

/** Moves a queued record to running; false when another attempt already moved it. */
export async function markJobRunRunning(executionId: string): Promise<boolean> {
  const rows = await db
    .update(jobExecutionLogs)
    .set({ status: 'running' })
    .where(
      and(eq(jobExecutionLogs.executionId, executionId), eq(jobExecutionLogs.status, 'queued'))
    )
    .returning({ id: jobExecutionLogs.id })
  return rows.length > 0
}

/**
 * Ends an occurrence that never became a turn (skipped, or refused before admission). Only a
 * queued record ends this way, so it never overwrites a run that started.
 */
export async function endUnstartedJobRun(
  executionId: string,
  outcome: JobRunOutcome,
  summary: string,
  tx: DbOrTx = db
): Promise<boolean> {
  const rows = await tx
    .update(jobExecutionLogs)
    .set({
      ...endedRunStatus(outcome),
      outcome,
      summary,
      endedAt: new Date(),
      totalDurationMs: 0,
    })
    .where(
      and(eq(jobExecutionLogs.executionId, executionId), eq(jobExecutionLogs.status, 'queued'))
    )
    .returning({ id: jobExecutionLogs.id })
  return rows.length > 0
}

/** Records the billing request a run's charges settle under, once, for its spend cap. */
export async function recordJobRunBillingRequest(
  executionId: string,
  billingRequestId: string
): Promise<void> {
  await db
    .update(jobExecutionLogs)
    .set({ billingRequestId })
    .where(
      and(eq(jobExecutionLogs.executionId, executionId), isNull(jobExecutionLogs.billingRequestId))
    )
}

/** Counts a failed dispatch attempt on a queued record and returns the attempts so far. */
export async function countJobDispatchFailure(executionId: string): Promise<number> {
  const [row] = await db
    .update(jobExecutionLogs)
    .set({
      executionData: sql`jsonb_set(${jobExecutionLogs.executionData}, '{dispatchFailures}', to_jsonb(COALESCE((${jobExecutionLogs.executionData}->>'dispatchFailures')::int, 0) + 1))`,
    })
    .where(
      and(eq(jobExecutionLogs.executionId, executionId), eq(jobExecutionLogs.status, 'queued'))
    )
    .returning({
      failures: sql<number>`(${jobExecutionLogs.executionData}->>'dispatchFailures')::int`,
    })
  return row?.failures ?? 0
}

/** Turns a job off; the caller tells its people why. */
export async function disableJob(scheduleId: string): Promise<boolean> {
  const rows = await db
    .update(workflowSchedule)
    .set({ status: 'disabled', nextRunAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(workflowSchedule.id, scheduleId),
        eq(workflowSchedule.sourceType, 'job'),
        eq(workflowSchedule.status, 'active')
      )
    )
    .returning({ id: workflowSchedule.id })
  return rows.length > 0
}
