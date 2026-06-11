import { truncate } from '@sim/utils/string'
import { format, getHours } from 'date-fns'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'

/**
 * A scheduled task positioned on the calendar. Derived from a
 * {@link WorkspaceScheduleData} row via {@link toCalendarEvent}; keeps the raw
 * `source` row for click-through once schedule interaction is wired.
 */
export interface CalendarEvent {
  id: string
  start: Date
  title: string
  isRecurring: boolean
  source: WorkspaceScheduleData
}

/** Bucket key for a day cell (`yyyy-MM-dd`). */
export function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/** Bucket key for an hour slot (`yyyy-MM-dd-HH`). */
export function hourKey(date: Date, hour: number): string {
  return `${dayKey(date)}-${hour.toString().padStart(2, '0')}`
}

/**
 * Adapts a schedule row into a positioned calendar event. Returns `null` when
 * the row has no parseable `nextRunAt` so callers can `.filter(Boolean)` it out.
 * This is the single coupling point between the schedule data model and the
 * calendar view.
 */
export function toCalendarEvent(schedule: WorkspaceScheduleData): CalendarEvent | null {
  if (!schedule.nextRunAt) return null
  const start = new Date(schedule.nextRunAt)
  if (Number.isNaN(start.getTime())) return null
  const title =
    schedule.jobTitle?.trim() ||
    (schedule.prompt ? truncate(schedule.prompt, 60) : '') ||
    'Scheduled task'
  return {
    id: schedule.id,
    start,
    title,
    isRecurring: schedule.cronExpression != null,
    source: schedule,
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
