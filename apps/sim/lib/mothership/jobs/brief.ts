import { db, jobExecutionLogs } from '@sim/db'
import { truncate } from '@sim/utils/string'
import { and, desc, eq, isNotNull, lt } from 'drizzle-orm'
import type { JobRun } from '@/lib/mothership/jobs/runs'

/** How many earlier runs' outcomes a brief carries. */
const BRIEF_RECENT_RUNS = 5
const BRIEF_SUMMARY_CHARS = 400

type JobBriefSchedule = Pick<
  JobRun,
  'scheduleId' | 'jobTitle' | 'prompt' | 'successCondition' | 'lifecycle' | 'maxRuns' | 'runNumber'
>

/**
 * The user message of one occurrence's turn: what the job is, how far along it is, and how its
 * recent runs ended, read from the run records rather than from anything the model wrote. The
 * worker frames it as an automated turn (origin `job`), so nothing here poses as the user.
 */
export async function buildJobBrief(
  schedule: JobBriefSchedule,
  occurrenceAt: Date,
  runBudgetUsd: number | null
): Promise<string> {
  const recent = await db
    .select({
      occurrenceAt: jobExecutionLogs.occurrenceAt,
      outcome: jobExecutionLogs.outcome,
      summary: jobExecutionLogs.summary,
    })
    .from(jobExecutionLogs)
    .where(
      and(
        eq(jobExecutionLogs.scheduleId, schedule.scheduleId),
        isNotNull(jobExecutionLogs.outcome),
        lt(jobExecutionLogs.occurrenceAt, occurrenceAt)
      )
    )
    .orderBy(desc(jobExecutionLogs.occurrenceAt))
    .limit(BRIEF_RECENT_RUNS)

  const run = schedule.maxRuns
    ? `Run ${schedule.runNumber} of ${schedule.maxRuns}`
    : `Run ${schedule.runNumber}`
  return [
    `Job: ${schedule.jobTitle ?? 'Untitled job'} (${run}, scheduled for ${occurrenceAt.toISOString()})`,
    `Task:\n${schedule.prompt ?? ''}`,
    schedule.successCondition ? `Success condition: ${schedule.successCondition}` : '',
    schedule.lifecycle === 'until_complete'
      ? 'The job stops running once its success condition is met.'
      : 'The job keeps running on its schedule.',
    recent.length > 0
      ? `Recent runs, newest first:\n${recent
          .map(
            (entry) =>
              `- ${entry.occurrenceAt?.toISOString() ?? '?'}: ${entry.outcome}${
                entry.summary ? ` — ${truncate(entry.summary, BRIEF_SUMMARY_CHARS)}` : ''
              }`
          )
          .join('\n')}`
      : 'This is the first run.',
    runBudgetUsd === null ? '' : `This run may spend up to $${runBudgetUsd.toFixed(2)}.`,
  ]
    .filter((part) => part.length > 0)
    .join('\n\n')
}
