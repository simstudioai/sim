'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { cn } from '@/lib/core/utils/cn'
import { CalendarEventChip } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar/components/calendar-event-chip'
import {
  type CalendarDayCell,
  formatHourLabel,
  formatSlotTime,
  TIME_SLOT_HEIGHT,
  timeToOffset,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'
import {
  type CalendarEvent,
  hourKey,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

const GUTTER_WIDTH = 56

/** Re-render cadence for the current-time indicator. */
const TICK_MS = 60_000

interface TimeGridProps {
  /** One column per day: 7 for week scope, 1 for day scope. */
  days: CalendarDayCell[]
  hours: number[]
  onSelectSlot: (date: Date, time: string) => void
  eventsByHour?: Map<string, CalendarEvent[]>
}

/**
 * Live now-line drawn over today's column — a chip-primary dot at the left edge
 * and a hairline across the column, positioned by {@link timeToOffset}. Renders
 * nothing until mounted (keeps SSR output stable, avoiding a hydration mismatch
 * on the time-dependent offset), then ticks once a minute so the line advances.
 * The parent column is `relative`; this is `absolute`.
 */
function CurrentTimeIndicator() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const interval = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  if (!now) return null

  return (
    <div style={{ top: timeToOffset(now) }} className='pointer-events-none absolute inset-x-0 z-10'>
      <div className='-translate-x-1/2 -translate-y-1/2 absolute top-0 left-0 size-[10px] rounded-full bg-[var(--text-primary)] dark:bg-white' />
      <div className='-translate-y-1/2 absolute inset-x-0 top-0 h-[2px] bg-[var(--text-primary)] dark:bg-white' />
    </div>
  )
}

/** One hour cell in a day column. Clicking opens the create modal. */
function TimeSlot({
  date,
  hour,
  events,
  isLastColumn,
  onSelect,
}: {
  date: Date
  hour: number
  events: CalendarEvent[]
  isLastColumn: boolean
  onSelect: (date: Date, time: string) => void
}) {
  return (
    <button
      type='button'
      onClick={() => onSelect(date, formatSlotTime(hour))}
      style={{ height: TIME_SLOT_HEIGHT }}
      className={cn(
        'flex flex-col gap-0.5 overflow-hidden border-[var(--border)] border-r border-b p-0.5 text-left transition-colors hover-hover:bg-[var(--surface-active)]',
        isLastColumn && 'pr-6'
      )}
    >
      {events.map((event) => (
        <CalendarEventChip key={event.id} event={event} />
      ))}
    </button>
  )
}

/**
 * Shared time-based grid for the week (7 columns) and day (1 column) scopes: a
 * sticky day header, a fixed hour gutter, and a stack of hour slots per day.
 * Column widths come from a CSS grid template shared by the header and body so
 * they stay aligned. The sticky header paints chrome on the day cells only —
 * its gutter spacer is transparent and border-free, so the hour labels scroll
 * clear to the top of the viewport. Today's column is `relative` and hosts the
 * {@link CurrentTimeIndicator}. Events flow in via `eventsByHour` — the single
 * injection point the container fills.
 */
export function TimeGrid({ days, hours, onSelectSlot, eventsByHour }: TimeGridProps) {
  const columnsStyle = {
    gridTemplateColumns: `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`,
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div data-time-grid-header style={columnsStyle} className='sticky top-0 z-20 grid'>
        <div className='border-[var(--border)] border-r' />
        {days.map((day, dayIndex) => (
          <div
            key={day.date.toISOString()}
            className={cn(
              'flex items-center justify-center gap-1.5 border-[var(--border)] border-r border-b bg-[var(--bg)] py-2',
              dayIndex === days.length - 1 && 'pr-6'
            )}
          >
            <span className='text-[var(--text-muted)] text-caption'>{format(day.date, 'EEE')}</span>
            <span
              className={cn(
                'flex size-[22px] items-center justify-center rounded-lg text-sm',
                day.isToday
                  ? 'bg-[var(--text-primary)] text-[var(--text-inverse)] dark:bg-white dark:text-[var(--bg)]'
                  : 'text-[var(--text-body)]'
              )}
            >
              {format(day.date, 'd')}
            </span>
          </div>
        ))}
      </div>

      <div style={columnsStyle} className='grid'>
        <div className='flex flex-col'>
          {hours.map((hour) => (
            <div
              key={hour}
              style={{ height: TIME_SLOT_HEIGHT }}
              className='relative border-[var(--border)] border-r'
            >
              <span className='-translate-y-1/2 absolute top-0 right-1.5 text-[var(--text-muted)] text-micro'>
                {formatHourLabel(hour)}
              </span>
            </div>
          ))}
        </div>

        {days.map((day, dayIndex) => (
          <div key={day.date.toISOString()} className='relative flex flex-col'>
            {day.isToday && <CurrentTimeIndicator />}
            {hours.map((hour) => (
              <TimeSlot
                key={hour}
                date={day.date}
                hour={hour}
                events={eventsByHour?.get(hourKey(day.date, hour)) ?? []}
                isLastColumn={dayIndex === days.length - 1}
                onSelect={onSelectSlot}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
