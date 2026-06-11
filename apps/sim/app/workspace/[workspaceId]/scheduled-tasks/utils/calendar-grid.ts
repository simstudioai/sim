import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

/** The granularity the calendar is currently rendering. */
export type CalendarScope = 'day' | 'week' | 'month'

/** A single day rendered in any view (month cell, week/day column header). */
export interface CalendarDayCell {
  date: Date
  isToday: boolean
  /** `false` for leading/trailing spillover days outside the focused month. */
  isCurrentMonth: boolean
}

export interface MonthGrid {
  kind: 'month'
  /** Calendar rows (4–6) of 7 day cells each, including spillover days. */
  weeks: CalendarDayCell[][]
}

export interface WeekGrid {
  kind: 'week'
  days: CalendarDayCell[]
  hours: number[]
}

export interface DayGrid {
  kind: 'day'
  day: CalendarDayCell
  hours: number[]
}

export type CalendarGrid = MonthGrid | WeekGrid | DayGrid

/** Sunday-first, matching the emcn `Calendar` picker. */
export const WEEK_STARTS_ON = 0 as const

/** Hours of the day rendered as rows in the week/day time grid. */
export const HOURS: number[] = Array.from({ length: 24 }, (_, hour) => hour)

/** Fixed pixel height of one hour row in the time grid. */
export const TIME_SLOT_HEIGHT = 48

const BASE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Weekday header labels rotated to honor {@link WEEK_STARTS_ON}. */
export const WEEKDAY_LABELS: string[] = [
  ...BASE_WEEKDAYS.slice(WEEK_STARTS_ON),
  ...BASE_WEEKDAYS.slice(0, WEEK_STARTS_ON),
]

function toCell(date: Date, today: Date, anchor?: Date): CalendarDayCell {
  return {
    date,
    isToday: isSameDay(date, today),
    isCurrentMonth: anchor ? isSameMonth(date, anchor) : true,
  }
}

/** Move the anchor date forward (`delta > 0`) or back by one unit of `scope`. */
export function advanceAnchor(anchor: Date, scope: CalendarScope, delta: number): Date {
  switch (scope) {
    case 'month':
      return addMonths(anchor, delta)
    case 'week':
      return addWeeks(anchor, delta)
    case 'day':
      return addDays(anchor, delta)
  }
}

function buildMonthGrid(anchor: Date, today: Date): MonthGrid {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON })
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON })
  const days = eachDayOfInterval({ start, end })
  const weeks: CalendarDayCell[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7).map((date) => toCell(date, today, anchor)))
  }
  return { kind: 'month', weeks }
}

function buildWeekGrid(anchor: Date, today: Date): WeekGrid {
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
  const end = endOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
  const days = eachDayOfInterval({ start, end }).map((date) => toCell(date, today))
  return { kind: 'week', days, hours: HOURS }
}

function buildDayGrid(anchor: Date, today: Date): DayGrid {
  return { kind: 'day', day: toCell(anchor, today), hours: HOURS }
}

/**
 * Pure, React-free derivation of the renderable grid for a given scope and
 * anchor. `today` is passed in (never read from the clock here) so the result
 * is fully deterministic and unit-testable.
 */
export function buildCalendarGrid(scope: CalendarScope, anchor: Date, today: Date): CalendarGrid {
  switch (scope) {
    case 'month':
      return buildMonthGrid(anchor, today)
    case 'week':
      return buildWeekGrid(anchor, today)
    case 'day':
      return buildDayGrid(anchor, today)
  }
}

/** Toolbar period label, e.g. `June 2026`, `Jun 7 – 13, 2026`, `Wednesday, June 10, 2026`. */
export function formatScopeLabel(scope: CalendarScope, anchor: Date): string {
  if (scope === 'month') return format(anchor, 'MMMM yyyy')
  if (scope === 'day') return format(anchor, 'EEEE, MMMM d, yyyy')
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
  const end = endOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
  if (isSameMonth(start, end)) return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
}

/** Display label for an hour-of-day gutter row, e.g. `7 AM`, `12 PM`. */
export function formatHourLabel(hour: number): string {
  return format(new Date(2000, 0, 1, hour), 'h a')
}

/**
 * Vertical pixel offset of a moment within the day, measured from the top of the
 * time grid's slot stack (the `00:00` row). Positions the current-time
 * indicator. Pure and clock-free — `date` is passed in so callers control "now".
 */
export function timeToOffset(date: Date): number {
  return (date.getHours() + date.getMinutes() / 60) * TIME_SLOT_HEIGHT
}

/** Wire-format time string for an hour slot, e.g. `07:00`. */
export function formatSlotTime(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`
}
