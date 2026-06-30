'use client'

import { useEffect, useState } from 'react'
import { chipPrimaryFillTokens, cn } from '@sim/emcn'
import { format } from 'date-fns'
import { zonedClockDate } from '@/lib/core/utils/timezone'
import { CalendarEventChip } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar/components/calendar-event-chip'
import {
  type CalendarDayCell,
  EVENT_CHIP_HEIGHT,
  formatHourLabel,
  formatSlotTime,
  layoutColumn,
  TIME_SLOT_HEIGHT,
  timeToOffset,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'
import {
  type CalendarEvent,
  dayKey,
  type ScheduledTask,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

const GUTTER_WIDTH = 56

/** Re-render cadence for the current-time indicator. */
const TICK_MS = 60_000

interface TimeGridProps {
  /** One column per day: 7 for week scope, 1 for day scope. */
  days: CalendarDayCell[]
  hours: number[]
  /** The viewer's effective timezone — positions the now-line. */
  timezone: string
  onSelectSlot: (date: Date, time: string) => void
  onSelectTask: (task: ScheduledTask) => void
  /** A task pill was right-clicked — open its context menu at the cursor. */
  onTaskContextMenu: (task: ScheduledTask, e: React.MouseEvent) => void
  eventsByDay?: Map<string, CalendarEvent[]>
}

/**
 * Live now-line drawn over today's column — a chip-primary dot at the left edge
 * and a hairline across the column, positioned by {@link timeToOffset}. Renders
 * nothing until mounted (keeps SSR output stable, avoiding a hydration mismatch
 * on the time-dependent offset), then ticks once a minute so the line advances.
 * Positioned in `timezone` so it tracks the same zone the day columns render in.
 * The parent column is `relative`; this is `absolute`.
 */
function CurrentTimeIndicator({ timezone }: { timezone: string }) {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const interval = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(interval)
  }, [])

  if (!now) return null

  return (
    <div
      style={{ top: timeToOffset(zonedClockDate(now, timezone)) }}
      className='pointer-events-none absolute inset-x-0 z-20'
    >
      <div className='-translate-x-1/2 -translate-y-1/2 absolute top-0 left-0 size-[10px] rounded-full bg-[var(--text-primary)] dark:bg-white' />
      <div className='-translate-y-1/2 absolute inset-x-0 top-0 h-[2px] bg-[var(--text-primary)] dark:bg-white' />
    </div>
  )
}

/**
 * One hour cell in a day column: a click target that opens the create modal
 * seeded to this hour, plus the hour's gridlines. Tasks are not rendered here —
 * they live in the day's {@link DayEvents} overlay so each sits at its exact
 * minute rather than snapping to the top of the hour.
 */
function HourCell({
  date,
  hour,
  isLastColumn,
  onSelect,
}: {
  date: Date
  hour: number
  isLastColumn: boolean
  onSelect: (date: Date, time: string) => void
}) {
  return (
    <div
      onClick={() => onSelect(date, formatSlotTime(hour))}
      style={{ height: TIME_SLOT_HEIGHT }}
      className={cn(
        'cursor-pointer border-[var(--border)] border-r border-b transition-colors hover-hover:bg-[var(--surface-active)]',
        isLastColumn && 'pr-6'
      )}
    />
  )
}

/**
 * A day column's task pills, each absolutely positioned at its exact start time
 * via {@link timeToOffset}. The layer is non-interactive so empty space falls
 * through to the hour cells beneath (click-to-create); the pills re-enable
 * pointer events. The layer clips to the day's bounds so a late-night pill never
 * spills past the final hour row. Coincident tasks overlap by design.
 */
function DayEvents({
  events,
  isLastColumn,
  onSelectTask,
  onTaskContextMenu,
}: {
  events: CalendarEvent[]
  isLastColumn: boolean
  onSelectTask: (task: ScheduledTask) => void
  onTaskContextMenu: (task: ScheduledTask, e: React.MouseEvent) => void
}) {
  const placed = layoutColumn(events, EVENT_CHIP_HEIGHT)
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-y-0 left-0.5 z-10 overflow-hidden',
        isLastColumn ? 'right-6' : 'right-0.5'
      )}
    >
      {placed.map(({ item: event, topPx, lane, lanes }) => (
        <div
          key={event.id}
          style={{
            top: topPx,
            height: EVENT_CHIP_HEIGHT,
            left: `${(lane / lanes) * 100}%`,
            width: `${(1 / lanes) * 100}%`,
          }}
          className='pointer-events-auto absolute pr-0.5'
        >
          <CalendarEventChip
            event={event}
            onSelect={onSelectTask}
            onContextMenu={onTaskContextMenu}
            className='h-full w-full'
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Shared time-based grid for the week (7 columns) and day (1 column) scopes: a
 * sticky day header, a fixed hour gutter, and a stack of hour slots per day.
 * Column widths come from a CSS grid template shared by the header and body so
 * they stay aligned. The sticky header paints chrome on the day cells only —
 * its gutter spacer is transparent and border-free, so the hour labels scroll
 * clear to the top of the viewport. Today's column is `relative` and hosts the
 * {@link CurrentTimeIndicator}. Events flow in via `eventsByDay` — the single
 * injection point the container fills.
 */
export function TimeGrid({
  days,
  hours,
  timezone,
  onSelectSlot,
  onSelectTask,
  onTaskContextMenu,
  eventsByDay,
}: TimeGridProps) {
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
                'flex size-[26px] items-center justify-center rounded-lg text-caption',
                day.isToday ? chipPrimaryFillTokens : 'text-[var(--text-body)]'
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
            {day.isToday && <CurrentTimeIndicator timezone={timezone} />}
            {hours.map((hour) => (
              <HourCell
                key={hour}
                date={day.date}
                hour={hour}
                isLastColumn={dayIndex === days.length - 1}
                onSelect={onSelectSlot}
              />
            ))}
            <DayEvents
              events={eventsByDay?.get(dayKey(day.date)) ?? []}
              isLastColumn={dayIndex === days.length - 1}
              onSelectTask={onSelectTask}
              onTaskContextMenu={onTaskContextMenu}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
