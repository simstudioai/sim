import { Cron } from 'croner'
import { zonedWallClock, zonedWallClockToUtc } from '@/lib/core/utils/timezone'

/**
 * Recurrence cadence the modal exposes. `once` is a one-time launch; `custom`
 * preserves a cron expression the UI did not author (e.g. a task created
 * conversationally) so editing never silently rewrites it.
 */
export type RecurrenceFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'

/**
 * How a monthly recurrence anchors within the month, mirroring a calendar app's
 * monthly sub-options. `day-of-month` repeats on the launch date's day number
 * (e.g. the 15th); `nth-weekday` on the same ordinal weekday (e.g. the third
 * Tuesday, croner `2#3`); `last-weekday` on the final weekday of that kind (e.g.
 * the last Tuesday, croner `2#L`). The weekday and ordinal are read from the
 * launch date at cron-build time — on edit the launch date is an actual
 * occurrence, so the mode round-trips to the same day.
 */
export type MonthlyMode = 'day-of-month' | 'nth-weekday' | 'last-weekday'

/** When a recurrence stops, mirroring the three calendar-app end options. */
export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'on'; date: string }
  | { type: 'after'; count: number }

export interface Recurrence {
  frequency: RecurrenceFrequency
  /** Weekly only: weekdays 0 (Sun) – 6 (Sat). Empty falls back to the launch day's weekday. */
  weekdays: number[]
  /** Monthly only: how it anchors within the month. Defaults to `day-of-month`. */
  monthlyMode?: MonthlyMode
  end: RecurrenceEnd
  /** `custom` only: the raw cron expression, passed through unchanged on save. */
  cron?: string
}

export const DEFAULT_RECURRENCE: Recurrence = {
  frequency: 'once',
  weekdays: [],
  end: { type: 'never' },
}

/** Upper bound on occurrences materialized for one schedule in a single view. */
const MAX_OCCURRENCES_PER_VIEW = 500

/**
 * Builds the cron expression for a recurrence, evaluated in the schedule's
 * timezone against the launch day/time. Returns `null` for a one-time task and
 * the preserved expression for a `custom` recurrence. The weekday/day-of-month
 * are read from the launch date as a zone-independent calendar date (UTC parse),
 * so the cron targets the right day regardless of the device zone.
 */
export function recurrenceToCron(
  recurrence: Recurrence,
  launchDate: string,
  launchTime: string
): string | null {
  if (recurrence.frequency === 'once') return null
  if (recurrence.frequency === 'custom') return recurrence.cron ?? null

  const [hour, minute] = launchTime.split(':').map(Number)
  const launchDay = new Date(`${launchDate}T00:00:00Z`)

  switch (recurrence.frequency) {
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly': {
      const days = recurrence.weekdays.length > 0 ? recurrence.weekdays : [launchDay.getUTCDay()]
      return `${minute} ${hour} * * ${[...new Set(days)].sort((a, b) => a - b).join(',')}`
    }
    case 'monthly': {
      const weekday = launchDay.getUTCDay()
      switch (recurrence.monthlyMode ?? 'day-of-month') {
        case 'nth-weekday': {
          // A 5th occurrence is always the last weekday of the month; emit `#L`
          // rather than `#5` so no month without a 5th occurrence is silently
          // skipped (the picker only offers nth for the 1st–4th, but the launch
          // date can still drift to a 5th via the footer date picker).
          const nth = Math.ceil(launchDay.getUTCDate() / 7)
          return nth >= 5
            ? `${minute} ${hour} * * ${weekday}#L`
            : `${minute} ${hour} * * ${weekday}#${nth}`
        }
        case 'last-weekday':
          return `${minute} ${hour} * * ${weekday}#L`
        default:
          return `${minute} ${hour} ${launchDay.getUTCDate()} * *`
      }
    }
    case 'yearly':
      return `${minute} ${hour} ${launchDay.getUTCDate()} ${launchDay.getUTCMonth() + 1} *`
  }
}

export interface ScheduleFields {
  cronExpression: string | null
  time?: string
  maxRuns?: number
  endsAt?: string
  lifecycle: 'persistent' | 'until_complete'
}

/**
 * Translates a recurrence + launch into the wire fields the schedules API
 * accepts: a one-time `time`, or a `cronExpression` with an optional end
 * boundary (`maxRuns` for "after N", `endsAt` for "on date"). The launch
 * date/time and end date are wall-clock in `timezone`, so they resolve to UTC
 * instants in that zone — matching how the recurring cron is evaluated.
 */
export function recurrenceToScheduleFields(
  recurrence: Recurrence,
  launchDate: string,
  launchTime: string,
  timezone: string
): ScheduleFields {
  const cronExpression = recurrenceToCron(recurrence, launchDate, launchTime)
  if (!cronExpression) {
    return {
      cronExpression: null,
      time: zonedWallClockToUtc(`${launchDate}T${launchTime}`, timezone).toISOString(),
      lifecycle: 'persistent',
    }
  }

  const { end } = recurrence
  return {
    cronExpression,
    maxRuns: end.type === 'after' ? end.count : undefined,
    endsAt:
      end.type === 'on'
        ? zonedWallClockToUtc(`${end.date}T23:59:59`, timezone).toISOString()
        : undefined,
    lifecycle: end.type === 'after' ? 'until_complete' : 'persistent',
  }
}

const CRON_FIELD_COUNT = 5

/**
 * Recovers the modal's recurrence + launch fields from a stored schedule so
 * editing reflects what is persisted, read back in the schedule's `timezone`.
 * A recurring task's launch clock comes from its cron; a one-time task's comes
 * from the stored instant (`anchor`). A cron the UI did not author maps to
 * `custom` and round-trips untouched.
 */
export function cronToRecurrence(params: {
  cronExpression: string | null
  maxRuns: number | null
  endsAt: string | null
  anchor: Date
  timezone: string
}): { recurrence: Recurrence; launchTime: string } {
  const { cronExpression, maxRuns, endsAt, anchor, timezone } = params

  const end: RecurrenceEnd = endsAt
    ? { type: 'on', date: zonedWallClock(new Date(endsAt), timezone).slice(0, 10) }
    : maxRuns
      ? { type: 'after', count: maxRuns }
      : { type: 'never' }
  const anchorTime = zonedWallClock(anchor, timezone).slice(11, 16)

  if (!cronExpression) {
    return {
      recurrence: { frequency: 'once', weekdays: [], end },
      launchTime: anchorTime,
    }
  }

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== CRON_FIELD_COUNT) {
    return {
      recurrence: { frequency: 'custom', weekdays: [], end, cron: cronExpression },
      launchTime: anchorTime,
    }
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const launchTime = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  const isNumeric = (value: string) => /^\d+$/.test(value)
  const numbersAreValid = isNumeric(minute) && isNumeric(hour)

  if (numbersAreValid && month === '*') {
    if (dayOfMonth === '*' && dayOfWeek === '*') {
      return { recurrence: { frequency: 'daily', weekdays: [], end }, launchTime }
    }
    if (dayOfMonth === '*' && /^[0-6](,[0-6])*$/.test(dayOfWeek)) {
      const weekdays = dayOfWeek.split(',').map(Number)
      return { recurrence: { frequency: 'weekly', weekdays, end }, launchTime }
    }
    // Accept croner's alternate Sunday digit (`7`) so externally-authored
    // `7#…` crons round-trip; the picker canonicalizes them to `0#…` on save.
    // A 5th occurrence (`#5`) is intentionally NOT matched — it falls through to
    // `custom` so its month-skipping behavior is preserved verbatim rather than
    // silently rewritten to `#L`.
    if (dayOfMonth === '*' && /^[0-7]#[1-4]$/.test(dayOfWeek)) {
      return {
        recurrence: { frequency: 'monthly', weekdays: [], monthlyMode: 'nth-weekday', end },
        launchTime,
      }
    }
    if (dayOfMonth === '*' && /^[0-7]#L$/.test(dayOfWeek)) {
      return {
        recurrence: { frequency: 'monthly', weekdays: [], monthlyMode: 'last-weekday', end },
        launchTime,
      }
    }
    if (isNumeric(dayOfMonth) && dayOfWeek === '*') {
      return {
        recurrence: { frequency: 'monthly', weekdays: [], monthlyMode: 'day-of-month', end },
        launchTime,
      }
    }
  }

  if (numbersAreValid && isNumeric(dayOfMonth) && isNumeric(month) && dayOfWeek === '*') {
    return { recurrence: { frequency: 'yearly', weekdays: [], end }, launchTime }
  }

  return {
    recurrence: { frequency: 'custom', weekdays: [], end, cron: cronExpression },
    launchTime,
  }
}

/**
 * Materializes a recurring schedule's run instants inside `[rangeStart, rangeEnd]`
 * that are still upcoming (after `from`), skipping individually deleted
 * occurrences and stopping at the recurrence end. Pure given its inputs.
 *
 * The lower bound is inclusive: croner's `nextRun(date)` returns the first
 * occurrence strictly after `date`, so the search starts one millisecond before
 * the bound to admit an occurrence landing exactly on it.
 */
export function expandOccurrences(params: {
  cronExpression: string
  timezone: string
  rangeStart: Date
  rangeEnd: Date
  from: Date
  excludedDates?: string[] | null
  endsAt?: Date | null
}): Date[] {
  const { cronExpression, timezone, rangeStart, rangeEnd, from, excludedDates, endsAt } = params

  let cron: Cron
  try {
    cron = new Cron(cronExpression, timezone ? { timezone } : undefined)
  } catch {
    return []
  }

  const excluded = new Set(
    (excludedDates ?? []).map((iso) => new Date(iso).getTime()).filter((ms) => !Number.isNaN(ms))
  )
  const lowerBound = rangeStart.getTime() > from.getTime() ? rangeStart : from

  const occurrences: Date[] = []
  let cursor = new Date(lowerBound.getTime() - 1)
  for (let i = 0; i < MAX_OCCURRENCES_PER_VIEW; i++) {
    const next = cron.nextRun(cursor)
    if (!next || next.getTime() > rangeEnd.getTime()) break
    if (endsAt && next.getTime() > endsAt.getTime()) break
    if (!excluded.has(next.getTime())) occurrences.push(next)
    cursor = next
  }
  return occurrences
}
