import { truncate } from '@sim/utils/string'
import { format, getHours } from 'date-fns'
import type { ChatContext } from '@/stores/panel'

/**
 * Lifecycle of a scheduled task: `pending` has not run yet, `running` is
 * executing now, and `error`/`completed` are terminal outcomes of a past run.
 */
export type ScheduledTaskStatus = 'pending' | 'running' | 'error' | 'completed'

/**
 * A scheduled task as the calendar renders it. Held in local state this phase
 * (`useScheduledTasks`); persistence swaps in behind the same shape later.
 */
export interface ScheduledTask {
  id: string
  /** The instruction Sim runs. Doubles as the calendar title. */
  prompt: string
  /** Resources the prompt `@`-mentions / skills it `/`-invokes, when any. */
  contexts?: ChatContext[]
  /** When the task runs (`pending`/`running`) or ran (`completed`/`error`). */
  runAt: Date
  /** IANA timezone the launch time was captured in. */
  timezone: string
  status: ScheduledTaskStatus
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

/**
 * Adapts a task into a positioned calendar event. This is the single coupling
 * point between the task model and the calendar view — every task renders
 * identically regardless of status; the details modal carries the state.
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
