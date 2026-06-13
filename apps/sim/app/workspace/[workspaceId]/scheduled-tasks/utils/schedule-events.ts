import { truncate } from '@sim/utils/string'
import { format, getHours } from 'date-fns'
import type { WorkspaceScheduleRow } from '@/lib/api/contracts/schedules'
import { expandOccurrences } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'
import type { ChatContext } from '@/stores/panel'

/**
 * Lifecycle of a scheduled task occurrence: `pending` has not run yet, `running`
 * is executing now, and `error`/`completed` are terminal outcomes of a past run.
 */
export type ScheduledTaskStatus = 'pending' | 'running' | 'error' | 'completed'

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
}

/**
 * A scheduled task positioned on the calendar. Derived from a
 * {@link ScheduledTask} via {@link taskToCalendarEvent}; keeps the full `task`
 * for the click-through details modal.
 */
export interface CalendarEvent {
  id: string
  start: Date
  title: string
  task: ScheduledTask
}

/** Bucket key for a day cell (`yyyy-MM-dd`). */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Bucket key for an hour slot (`yyyy-MM-dd-HH`). */
export function hourKey(date: Date, hour: number): string {
  return `${dayKey(date)}-${hour.toString().padStart(2, '0')}`
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
 * schedule's most recent terminal run. `now` separates upcoming from past.
 */
export function scheduleToTasks(
  row: WorkspaceScheduleRow,
  rangeStart: Date,
  rangeEnd: Date,
  now: Date
): ScheduledTask[] {
  const recurring = Boolean(row.cronExpression)
  // double-cast-allowed: contexts persist as open kind/label objects; the calendar consumes them as ChatContext
  const contexts = (row.contexts ?? undefined) as unknown as ChatContext[] | undefined
  const base = {
    scheduleId: row.id,
    prompt: row.prompt ?? '',
    contexts,
    timezone: row.timezone,
    recurring,
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

  if (row.status === 'active' && row.cronExpression) {
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
      tasks.push({ ...base, id: `${row.id}:${runAt.toISOString()}`, runAt, status: 'pending' })
    }
  }

  const marker = lastRunMarker(row)
  if (marker && withinRange(marker.at, rangeStart, rangeEnd)) {
    tasks.push({ ...base, id: `${row.id}:last`, runAt: marker.at, status: marker.status })
  }

  return tasks
}

/**
 * Adapts a task occurrence into a positioned calendar event. Every occurrence
 * renders identically regardless of status; the details modal carries the state.
 */
export function taskToCalendarEvent(task: ScheduledTask): CalendarEvent {
  const prompt = task.prompt.trim()
  return {
    id: task.id,
    start: task.runAt,
    title: prompt ? truncate(prompt, 60) : 'Scheduled task',
    task,
  }
}

function bucketBy(
  events: CalendarEvent[],
  keyOf: (event: CalendarEvent) => string
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const key = keyOf(event)
    const bucket = map.get(key)
    if (bucket) bucket.push(event)
    else map.set(key, [event])
  }
  return map
}

/** Groups events by calendar day for month-view cell lookup. */
export function bucketEventsByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  return bucketBy(events, (event) => dayKey(event.start))
}

/** Groups events by hour slot for week/day-view slot lookup. */
export function bucketEventsByHour(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  return bucketBy(events, (event) => hourKey(event.start, getHours(event.start)))
}
