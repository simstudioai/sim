import { truncate } from '@sim/utils/string'
import { format } from 'date-fns'
import type { WorkspaceScheduleRow } from '@/lib/api/contracts/schedules'
import { zonedClockDate } from '@/lib/core/utils/timezone'
import { expandOccurrences } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'
import type { ChatContext } from '@/stores/panel'

/**
 * Lifecycle of a scheduled task occurrence: `pending` has not run yet, and
 * `error`/`completed` are terminal outcomes of a past run.
 */
export type ScheduledTaskStatus = 'pending' | 'error' | 'completed'

/**
 * One occurrence of a scheduled task as the calendar renders it. A recurring
 * schedule expands into many of these; one-time tasks produce a single one.
 */
export interface ScheduledTask {
  /** Occurrence-unique key for rendering — not the backend identifier. */
  id: string
  /** The persisted schedule id, used to edit or delete the task. */
  scheduleId: string
  /** The instruction Sim runs. Doubles as the calendar title. */
  prompt: string
  /** Resources the prompt `@`-mentions / skills it `/`-invokes, when any. */
  contexts?: ChatContext[]
  /** When this occurrence runs (`pending`) or ran (`completed`/`error`). */
  runAt: Date
  /** IANA timezone the launch time was captured in. */
  timezone: string
  status: ScheduledTaskStatus
  /** Whether the task repeats — drives edit seeding and the delete dialog. */
  recurring: boolean
  /**
   * Whether the parent schedule is paused. A paused recurring task still shows
   * its upcoming occurrences (rendered dimmed) so it can be found and resumed;
   * it will not run until resumed. Always `false` for past runs and one-time tasks.
   */
  disabled: boolean
}

/**
 * A scheduled task positioned on the calendar. Derived from a
 * {@link ScheduledTask} via {@link taskToCalendarEvent}; keeps the full `task`
 * for the click-through details modal.
 */
export interface CalendarEvent {
  id: string
  /**
   * The occurrence's wall-clock position in the task's own timezone, as a
   * device-local {@link zonedClockDate} — a layout coordinate, not the real
   * instant. Keeps the calendar showing each task at the local time it was
   * scheduled for, matching the modal. The true instant lives in `task.runAt`.
   */
  start: Date
  title: string
  task: ScheduledTask
}

/** Bucket key for a day cell (`yyyy-MM-dd`). */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** The most recent terminal run of a schedule, or `null` if it has never run. */
function lastRunMarker(
  row: WorkspaceScheduleRow
): { at: Date; status: ScheduledTaskStatus } | null {
  const ranAt = row.lastRanAt ? new Date(row.lastRanAt) : null
  const failedAt = row.lastFailedAt ? new Date(row.lastFailedAt) : null
  if (failedAt && (!ranAt || failedAt.getTime() >= ranAt.getTime())) {
    return { at: failedAt, status: 'error' }
  }
  if (ranAt) return { at: ranAt, status: 'completed' }
  return null
}

function withinRange(date: Date, rangeStart: Date, rangeEnd: Date): boolean {
  return date.getTime() >= rangeStart.getTime() && date.getTime() <= rangeEnd.getTime()
}

/**
 * Maps a persisted job schedule into the occurrences visible in `[rangeStart,
 * rangeEnd]`: upcoming runs (`pending`, expanded from the recurrence) plus the
 * schedule's most recent terminal run. `now` separates upcoming from past. A
 * paused (`disabled`) recurring schedule still expands its upcoming occurrences
 * — flagged `disabled` so the calendar can render them dimmed and offer Resume —
 * since the cadence is intact and only suspended. `completed` schedules expand
 * no future runs.
 */
export function scheduleToTasks(
  row: WorkspaceScheduleRow,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date
): ScheduledTask[] {
  const recurring = Boolean(row.cronExpression)
  const paused = row.status === 'disabled'
  // double-cast-allowed: contexts persist as open kind/label objects; the calendar consumes them as ChatContext
  const contexts = (row.contexts ?? undefined) as unknown as ChatContext[] | undefined
  const base = {
    scheduleId: row.id,
    prompt: row.prompt ?? '',
    contexts,
    timezone: row.timezone,
    recurring,
    disabled: false,
  }
  const tasks: ScheduledTask[] = []

  if (!recurring) {
    if (row.status === 'active' && row.nextRunAt) {
      const runAt = new Date(row.nextRunAt)
      if (withinRange(runAt, rangeStart, rangeEnd)) {
        tasks.push({ ...base, id: row.id, runAt, status: 'pending' })
      }
    } else {
      const marker = lastRunMarker(row)
      if (marker && withinRange(marker.at, rangeStart, rangeEnd)) {
        tasks.push({ ...base, id: row.id, runAt: marker.at, status: marker.status })
      }
    }
    return tasks
  }

  if ((row.status === 'active' || paused) && row.cronExpression) {
    const occurrences = expandOccurrences({
      cronExpression: row.cronExpression,
      timezone: row.timezone,
      rangeStart,
      rangeEnd,
      from: now,
      excludedDates: row.excludedDates,
      endsAt: row.endsAt ? new Date(row.endsAt) : null,
    })
    for (const runAt of occurrences) {
      tasks.push({
        ...base,
        id: `${row.id}:${runAt.toISOString()}`,
        runAt,
        status: 'pending',
        disabled: paused,
      })
    }
  }

  const marker = lastRunMarker(row)
  if (marker && withinRange(marker.at, rangeStart, rangeEnd)) {
    tasks.push({ ...base, id: `${row.id}:last`, runAt: marker.at, status: marker.status })
  }

  return tasks
}

/**
 * Adapts a task occurrence into a positioned calendar event, placing it at its
 * wall-clock time in the task's own timezone (see {@link CalendarEvent.start}).
 * Every occurrence renders identically regardless of status; the details modal
 * carries the state.
 */
export function taskToCalendarEvent(task: ScheduledTask): CalendarEvent {
  const prompt = task.prompt.trim()
  return {
    id: task.id,
    start: zonedClockDate(task.runAt, task.timezone),
    title: prompt ? truncate(prompt, 60) : 'Scheduled task',
    task,
  }
}

/** Groups events by calendar day for both the month grid and the time grid. */
export function bucketEventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const key = dayKey(event.start)
    const bucket = map.get(key)
    if (bucket) bucket.push(event)
    else map.set(key, [event])
  }
  return map
}
