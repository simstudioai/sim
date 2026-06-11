'use client'

import { format } from 'date-fns'
import { cn } from '@/lib/core/utils/cn'
import { CalendarEventChip } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar/components/calendar-event-chip'
import {
  type CalendarDayCell,
  type MonthGrid as MonthGridData,
  WEEKDAY_LABELS,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'
import {
  type CalendarEvent,
  dayKey,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface MonthGridProps {
  grid: MonthGridData
  onSelectDay: (date: Date) => void
  eventsByDay?: Map<string, CalendarEvent[]>
}

/** One day in the month grid. Clicking anywhere opens the create modal. */
function DayCell({
  cell,
  events,
  colIndex,
  onSelect,
}: {
  cell: CalendarDayCell
  events: CalendarEvent[]
  colIndex: number
  onSelect: (date: Date) => void
}) {
  return (
    <button
      type='button'
      onClick={() => onSelect(cell.date)}
      className={cn(
        'flex min-h-0 min-w-0 flex-col items-start gap-1 overflow-hidden border-[var(--border)] border-r border-b p-1.5 text-left transition-colors hover-hover:bg-[var(--surface-active)]',
        colIndex === 0 && 'pl-6',
        colIndex === 6 && 'pr-6'
      )}
    >
      <span
        className={cn(
          'flex h-[22px] flex-shrink-0 items-center rounded-lg text-sm',
          cell.isToday
            ? 'w-[22px] justify-center bg-[var(--text-primary)] text-[var(--text-inverse)] dark:bg-white dark:text-[var(--bg)]'
            : cell.isCurrentMonth
              ? 'text-[var(--text-body)]'
              : 'text-[var(--text-muted)]'
        )}
      >
        {format(cell.date, 'd')}
      </span>
      <div className='flex w-full min-w-0 flex-col gap-0.5'>
        {events.map((event) => (
          <CalendarEventChip key={event.id} event={event} />
        ))}
      </div>
    </button>
  )
}

/**
 * Month scope: a sticky weekday header over a 7-column grid of day cells that
 * fills the body height. All seven tracks are equal, so the border-to-border
 * column rhythm is even; the edge cells span clear to the panel edges (the page
 * gutter stays hoverable and clickable) and inset their own content via
 * `pl-6`/`pr-6`. Events flow in via `eventsByDay` — the single injection point
 * the container fills once schedule injection is wired.
 */
export function MonthGrid({ grid, onSelectDay, eventsByDay }: MonthGridProps) {
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='sticky top-0 z-10 grid grid-cols-7 border-[var(--border)] border-b bg-[var(--bg)]'>
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              'p-1.5 text-[var(--text-muted)] text-caption',
              index === 0 && 'pl-6',
              index === WEEKDAY_LABELS.length - 1 && 'pr-6'
            )}
          >
            {label}
          </div>
        ))}
      </div>
      <div
        className='grid min-h-0 flex-1 grid-cols-7'
        style={{ gridTemplateRows: `repeat(${grid.weeks.length}, minmax(0, 1fr))` }}
      >
        {grid.weeks.map((week) =>
          week.map((cell, colIndex) => (
            <DayCell
              key={cell.date.toISOString()}
              cell={cell}
              colIndex={colIndex}
              events={eventsByDay?.get(dayKey(cell.date)) ?? []}
              onSelect={onSelectDay}
            />
          ))
        )}
      </div>
    </div>
  )
}
