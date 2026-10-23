import { Cron } from 'croner'
import { uuidV5 } from '@/lib/core/utils/uuid-v5'

/** RFC 4122 namespace for scheduled job occurrences; fixed forever, since ids derive from it. */
const JOB_OCCURRENCE_NAMESPACE = '1c1b6a5e-7f3d-5a8e-9b7c-4d2e8f6a0b31'

/** A job runs at most this often, however its cron reads. */
export const MIN_JOB_CADENCE_MS = 15 * 60_000

/** How late a tick may claim an on-time occurrence; the floor forgives it so a 15-minute cron keeps its slots. */
const CLAIM_SLACK_MS = 60_000

/**
 * The id of one occurrence of one schedule: a UUIDv5 of the schedule id and the occurrence's
 * instant. It names the occurrence's run record, and the job turn runs under it as its message,
 * stream and run id, so every attempt to start the same occurrence (two ticks, a reconciler
 * retry) carries the same id and the worker and Sim each admit it at most once.
 */
export function jobOccurrenceId(scheduleId: string, occurrenceAt: Date): string {
  return uuidV5(`${scheduleId}@${occurrenceAt.toISOString()}`, JOB_OCCURRENCE_NAMESPACE)
}

interface JobCadence {
  cronExpression: string | null
  timezone: string
  excludedDates: readonly string[] | null
  endsAt: Date | null
}

/**
 * When a schedule runs next after an occurrence it claimed at `now`, or null when it never runs
 * again. A one-shot job (no cron) runs once. Missed occurrences collapse: the next one is
 * counted from `now`, never backfilled. It is never sooner than {@link MIN_JOB_CADENCE_MS} after
 * the claimed occurrence, nor after the claim itself (less a tick's slack), so an occurrence
 * claimed late does not run again moments later. It skips deleted occurrences and ends at `endsAt`.
 */
export function nextJobOccurrence(cadence: JobCadence, occurrenceAt: Date, now: Date): Date | null {
  if (!cadence.cronExpression) return null
  const cron = new Cron(cadence.cronExpression, { timezone: cadence.timezone || 'UTC' })
  const excluded = new Set(cadence.excludedDates ?? [])
  const earliest = new Date(
    Math.max(
      occurrenceAt.getTime() + MIN_JOB_CADENCE_MS - 1,
      now.getTime() + MIN_JOB_CADENCE_MS - CLAIM_SLACK_MS
    )
  )
  let next = cron.nextRun(earliest)
  /** Each step consumes one excluded instant, so this ends. */
  while (next && excluded.has(next.toISOString())) next = cron.nextRun(next)
  if (!next) return null
  if (cadence.endsAt && next.getTime() > cadence.endsAt.getTime()) return null
  return next
}
